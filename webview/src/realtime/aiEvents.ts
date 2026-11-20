import type { Centrifuge, ServerPublicationContext } from 'centrifuge';

import {
  isToolLineCall,
  looksLikeToolFailure,
  readTodos,
  statusFromResult,
  WRITE_TODOS_TOOL,
} from '@/chat/toolCalls';
import type { MessagePart, TextPart, TodoItem, ToolCallRecord } from '@/chat/types';
import { t } from '@/i18n';
import { logger } from '@/lib/logger';

import { onRealtimeTeardown } from './centrifugo';

const log = logger.child('ai.events');

/**
 * AI assistant realtime events, published to `ai:user-<id>` (see the API guide,
 * §3). Every publication is a single **envelope** discriminated by `event_type`,
 * with the event-specific payload nested under `data`:
 *
 *   { event_type, conversation_uuid, run_uuid, seq, data }
 *
 * - **`event_type`** — the discriminator (switch on it).
 * - **`run_uuid`** — the demux key: several runs (tabs/devices) share one
 *   channel, so a consumer keeps only the events for its own run.
 * - **`seq`** — a per-run, strictly increasing counter; a hole means an event was
 *   missed (reconcile via REST — see the guide, §7).
 *
 * A single run streams as:
 *   ai.run.started → (ai.token | ai.tool_call | ai.tool_result | ai.artifact.generated)*
 *                  → <terminal>
 *
 * **A paused run resumes as a new segment, not as a new run.** When a gated tool
 * needs human sign-off the run emits `ai.action.pending` and stops streaming;
 * after the decision it continues on the **same `run_uuid`**, beginning with
 * `ai.run.resumed` — and `seq` **restarts at 1**. So one run legitimately produces
 * a non-monotonic `seq` and more than one terminal event over its lifetime, and
 * only `ai.run.completed` / `.error` / `.cancelled` mean it will not speak again.
 * A second `ai.action.pending` inside the resumed segment is allowed too.
 *
 * There is no `[DONE]` sentinel: the stream ends on exactly one terminal event
 * (`ai.run.completed` / `ai.run.error` / `ai.run.cancelled`). `ai.action.pending` is
 * **not** terminal: it pauses the run for approval, and the same run resumes after it.
 *
 * **A terminal event ends its own `run_uuid`, never the conversation.** One
 * conversation can carry several runs at once (subagent fan-out, or a voice session
 * sharing it), so "is the assistant working?" is a question about the *set* of live
 * run uuids, not a single flag. This generator is per-run and demuxes on
 * `run_uuid`; `run.ts` keeps the set (see `activeRuns` there).
 */
export interface AiEventBase {
  conversation_uuid: string;
  run_uuid: string;
  seq: number;
}

export type AiRunEvent =
  | (AiEventBase & { event_type: 'ai.run.started'; data: { model?: string } })
  /** Streamed text delta (batched ~0.15s / 120 chars server-side). */
  | (AiEventBase & { event_type: 'ai.token'; data: { delta: string } })
  /**
   * The model called a tool. `args` is the model's **complete** arguments and
   * `tool_call_id` pairs this call with its `ai.tool_result` — both were dead on
   * the wire until 2026-09-05 (`args` was always `null`, and there was no id at
   * all), so both are still optional: a call whose argument stream was truncated
   * fires with `args: null` rather than not firing.
   */
  | (AiEventBase & {
      event_type: 'ai.tool_call';
      data: { tool: string; tool_call_id?: string; args?: unknown };
    })
  | (AiEventBase & {
      event_type: 'ai.tool_result';
      data: { tool: string; tool_call_id?: string; content: string };
    })
  /**
   * The model drew a component itself (`render_ui`) rather than describing the data
   * in prose. `data.code` is the **JSX itself** and `language` is `'jsx'` once the
   * backend has unwrapped it; older payloads put JSON wrapping `{ jsx, title }`
   * there instead, which {@link parseArtifactPayload} still reads. Not terminal: a
   * run may emit several and keep going.
   */
  | (AiEventBase & {
      event_type: 'ai.artifact.generated';
      data: { title?: string; code?: string; language?: string; source_tool?: string };
    })
  /**
   * Pauses the run for human approval (HITL) — **not** terminal. `allow_options`
   * names, per tool, the standing approvals the card may also offer — read it
   * through `readAllowOptions`, the contract leaves the items untyped.
   */
  | (AiEventBase & {
      event_type: 'ai.action.pending';
      data: { pending_uuid: string; actions: unknown; allow_options?: unknown };
    })
  /**
   * A gated call that ran without a card, because the person allowed the tool
   * earlier ("Always allow" / "Allow for this session"). `tool_call_id` names the
   * `ai.tool_call` it belongs to. On voice `run_uuid` is `null` — not ours.
   */
  | (AiEventBase & {
      event_type: 'ai.action.auto_approved';
      data: { tool?: string; summary?: string; tool_call_id?: string | null };
    })
  /** Terminal — run finished; `content` is the authoritative full final text. */
  | (AiEventBase & {
      event_type: 'ai.run.completed';
      data: { message_uuid: string; content: string };
    })
  /** Terminal — run cancelled; `chars` is how much text had been generated. */
  | (AiEventBase & { event_type: 'ai.run.cancelled'; data: { chars?: number } })
  /** Terminal — run failed. */
  | (AiEventBase & { event_type: 'ai.run.error'; data: { message: string } })
  | (AiEventBase & { event_type: 'ai.run.resumed'; data: { decision: string } })
  | (AiEventBase & { event_type: 'ai.conversation.titled'; data: { title: string } })
  /**
   * The model's "thinking", batched exactly like `ai.token` and streamed on its
   * own channel **before** the first `ai.token` — never interleaved once text has
   * started, and absent entirely on a turn (or a model) that does not think.
   *
   * **Live-only.** It is not part of the saved reply: `ai.run.completed.content`
   * never includes it and no endpoint returns it afterwards, so it is carried
   * beside the parts (see {@link AiRunChunk.reasoning}) rather than inside them —
   * a reasoning *part* would be persisted-looking content that a reopened thread
   * could never reproduce.
   */
  | (AiEventBase & { event_type: 'ai.reasoning'; data: { delta: string } })
  /**
   * The agent's plan for a multi-step reply, the **whole** list every time —
   * each event replaces the one before. Part of the run's `seq`.
   */
  | (AiEventBase & { event_type: 'ai.todos'; data: { todos?: unknown } })
  /** Reserved — node progress (not yet emitted). */
  | (AiEventBase & { event_type: 'ai.step'; data: { node: string; status: string } });

/**
 * Reserved tool name for the human-in-the-loop (HITL) approval card. An
 * `ai.action.pending` event doesn't come from a backend `ai.tool_call`, but we
 * surface it through the very same tool-call rendering path (a `tool-call` part →
 * the generative-UI registry) so it appears inline in the assistant turn, in
 * arrival order, with no extra message primitive. The registry special-cases this
 * name to render the approve/reject card instead of a generative-UI block.
 */
export const HITL_PENDING_TOOL_NAME = '__hitl_pending__';

/**
 * Reserved tool name for a model-generated UI artifact (`ai.artifact.generated`).
 * Like the HITL card it is not a backend `ai.tool_call`, but it renders through the
 * same tool-call path so it lands inline, in arrival order, with no new primitive.
 */
export const AI_ARTIFACT_TOOL_NAME = '__ai_artifact__';

/** Props the artifact part carries (as the tool-call part's `args`). */
export interface AiArtifactArgs {
  /** The artifact's title, from the envelope or the parsed payload. */
  title: string;
  /**
   * The JSX source the model wrote, or `null` when `data.code` was absent or not
   * parseable. Nothing evaluates it: rendering it means matching it against a
   * hand-built component whitelist we own, which this app does not have yet.
   */
  jsx: string | null;
  /** Which tool produced it (`render_ui` today). */
  sourceTool?: string;
}

/**
 * Reserved tool name for a delegation card — the model handing work to a
 * subagent. Like the two above it is rendered through the tool-call path so it
 * lands inline in the turn, in arrival order.
 */
export const AI_DELEGATION_TOOL_NAME = '__ai_delegation__';

/**
 * The tool a delegation arrives as.
 *
 * The model does not "spawn a subagent" on the wire — it calls a tool literally
 * named `task`, whose args are `{ subagent_type, description }`. Everything the
 * subagent then does (running code, reading and writing files) is opaque to this
 * stream **by design**: the call and its matching `ai.tool_result` are the whole
 * lifecycle, so the card is a single pending → resolved state, never a progress
 * list waiting for steps that will not come.
 */
export const DELEGATION_TOOL = 'task';

/** Where a delegation has got to. There is no third event, so there is no third state. */
export type DelegationStatus = 'running' | 'done' | 'failed';

/** Props the delegation card part carries (as the tool-call part's `args`). */
export interface AiDelegationArgs {
  /** Which subagent the work went to (`code-runner`, …); `''` when absent. */
  subagentType: string;
  /** What it was asked to do, in the model's words; `''` when absent. */
  description: string;
  /** `running` until the matching `ai.tool_result` arrives. */
  status: DelegationStatus;
}

/**
 * Read `task`'s arguments defensively.
 *
 * Two shapes reach this: the live event's already-decoded object, and the JSON
 * *string* a stored `tool_calls` entry carries. Both are model output, so every
 * field is optional and a missing one becomes `''` — the card names what it can
 * and says the rest plainly rather than throwing inside a transcript.
 */
export function parseDelegationArgs(args: unknown): {
  subagentType: string;
  description: string;
} {
  let value = args;
  if (typeof value === 'string') value = tryJson(value);
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const read = (key: string): string => (typeof record[key] === 'string' ? record[key] : '');
  return { subagentType: read('subagent_type'), description: read('description') };
}

/** Props the HITL card part carries (as the tool-call part's `args`). */
export interface HitlPendingArgs {
  /** The paused action's id — echoed back on resume for logging/traceability. */
  pendingUuid: string;
  /** The conversation to resume (the resume endpoint is keyed by conversation). */
  conversationUuid: string;
  /** The action(s) awaiting approval; shape is backend-defined, rendered defensively. */
  actions: unknown;
  /**
   * The raw `allow_options` — which standing approvals the card may offer. Raw on
   * purpose: the part's args are untyped on the way to the registry, and the card
   * narrows it with `readAllowOptions` at the one place it is read.
   */
  allowOptions?: unknown;
  /**
   * The row's state when the card was restored from `GET …/pending`. `resolving`
   * means a decision was already accepted and its resume task died — answering
   * again does nothing, and only a release frees it. Absent on a live card.
   */
  status?: string;
}

/**
 * Reserved tool name for the "Ran automatically" chip (`ai.action.auto_approved`).
 * Live-only, like the thinking: history keeps the call itself, not the fact that
 * nobody was asked.
 */
export const AI_AUTO_APPROVED_TOOL_NAME = '__ai_auto_approved__';

/** Props the auto-approved chip part carries. */
export interface AiAutoApprovedArgs {
  tool: string;
  /** The backend's one-line description of what ran. */
  summary: string;
}

/**
 * How {@link streamAiRun} joins a run it did not start — a reopened conversation
 * whose reply is still being written, or which is waiting on an approval.
 */
export interface StreamJoinOptions {
  /**
   * Required when the run uuid is unknown (`runUuid: null`): a paused run is not
   * in `GET …/runs`, only its pending action is, so the stream **adopts** whichever
   * run of this conversation speaks next — after the decision, that is the
   * `ai.run.resumed` of the very run being waited on.
   */
  conversationUuid?: string;
  /**
   * Start suspended, with the idle watchdog off: the run is waiting on a person,
   * and the watchdog would otherwise end it in an error while they read the card.
   */
  startPaused?: boolean;
  /** Parts already on screen when the stream joins — the restored approval card. */
  seedParts?: MessagePart[];
}

/**
 * A chunk emitted by {@link streamAiRun}: the cumulative assistant turn so far, as
 * an ordered list of parts (text interleaved with tool-call components). Each
 * yield is cumulative and **replaces** the message content — the consumer never
 * appends chunks to each other.
 */
export interface AiRunChunk {
  /** Cumulative ordered parts — text segments and tool-call (component) parts. */
  parts: MessagePart[];
  /** Convenience: all text so far, concatenated. */
  text: string;
  /**
   * The server uuid of the assistant message this run produced, from the terminal
   * `ai.run.completed`. It is the only place a live turn learns its own uuid, and
   * without it the reply cannot be regenerated or branched until the thread is
   * reloaded — `regenerate` is keyed by the assistant message.
   */
  messageUuid?: string;
  /**
   * Set on the final chunk when the run went silent past the watchdog window
   * rather than ending on a terminal event. Whatever streamed so far is real and
   * stays on screen; the caller marks the turn as interrupted rather than done.
   */
  timedOut?: boolean;
  /**
   * The run called at least one tool. The caller uses it to decide whether it is
   * worth asking history for files this turn delivered — a plain question cannot
   * have produced one, and the check costs a request.
   */
  calledTools?: boolean;
  /**
   * The model's thinking so far (`ai.reasoning`), or `undefined` on a turn that
   * never thought.
   *
   * Deliberately **not** a part: it is live-only (see the event's doc), so it
   * belongs to the run rather than to the stored reply. The screen shows it while
   * the turn has no text yet and drops it the moment the first token lands —
   * which is also why it is never written into `text`.
   */
  reasoning?: string;
  /** Every tool call so far, for the reply's "Used N tools" line. */
  toolCalls?: ToolCallRecord[];
  /** The latest task list, when the agent wrote one. */
  todos?: TodoItem[];
  /**
   * The run this stream is following. Only interesting on a joined stream that
   * started with `runUuid: null` — it is how the caller learns which run to name
   * when the user presses stop.
   */
  runUuid?: string;
}

/**
 * Watchdog window: how long an in-flight run may stay completely silent — no
 * token, no tool event, and no terminal event — before {@link streamAiRun} gives
 * up and ends the stream. Without this a dropped socket, a missed terminal
 * publication (see the `seq` gap warning), or a stalled worker leaves the run
 * `running` forever, so the composer's stop button never clears.
 * Any run event resets the timer, so a slow first token or a long tool call is
 * never cut off. Configurable via env; defaults to 60s.
 */
const AI_RUN_IDLE_TIMEOUT_MS =
  Number(import.meta.env.VITE_AI_RUN_IDLE_TIMEOUT_MS as string | undefined) || 60000;

/** How much of a raw payload a log line may carry. See {@link parseArtifactPayload}. */
const LOG_HEAD_CHARS = 240;

/** The first {@link LOG_HEAD_CHARS} of a value, marked when it was cut. */
function head(value: string): string {
  return value.length > LOG_HEAD_CHARS ? `${value.slice(0, LOG_HEAD_CHARS)}…` : value;
}

/** Where a payload was read from, and whatever the envelope already decoded. */
export interface ArtifactSource {
  /** Names the reader: the live event, or a tool result replayed from history. */
  where: string;
  /** The envelope's title. Wins over one found inside the payload. */
  title?: string;
  /** `'jsx'` once the backend has unwrapped the payload for us. Logged, not trusted. */
  language?: string;
  /** Which tool produced it (`render_ui`). */
  sourceTool?: string;
  /** Anything that ties a log line back to its message or run. */
  context?: Record<string, unknown>;
}

/** `JSON.parse`, or `undefined` when the string simply is not JSON. */
function tryJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * Read a `render_ui` payload into the args an artifact part carries.
 *
 * **The payload comes in two shapes, and both are live at once.** The event now
 * carries the JSX bare, with the title lifted onto the envelope; the *stored*
 * tool result — what history replays — is still the tool's own return value,
 * which is JSON wrapping `{ jsx, title }`. So the shape is detected rather than
 * assumed: if the string parses as JSON with a `jsx` inside, that is the wrapped
 * form; otherwise it is the JSX itself.
 *
 * Sniffing rather than branching on `data.language` is deliberate. A rollout puts
 * an app built for one shape in front of a backend serving the other — in both
 * directions, since an installed app outlives a deploy — and a hard branch turns
 * that window into every generated view failing. Detection costs one `JSON.parse`
 * attempt on a string we already hold.
 *
 * **Every way this ends up empty is logged, with the reason.** "The assistant
 * drew something and I saw nothing" has several distinct causes and on screen
 * they are indistinguishable. Only a *head* of the raw value goes into the line:
 * these cross the bridge into the native log file and Sentry breadcrumbs, and the
 * JSX is model output that runs to kilobytes.
 */
export function parseArtifactPayload(code: unknown, source: ArtifactSource): AiArtifactArgs {
  const context = { where: source.where, language: source.language, ...source.context };
  let jsx: string | null = null;
  let title = typeof source.title === 'string' ? source.title : '';

  if (typeof code !== 'string' || code.length === 0) {
    log.warn('a generated view carried no payload — nothing to render', {
      ...context,
      payloadType: code === null ? 'null' : typeof code,
    });
  } else {
    const parsed = tryJson(code);

    if (parsed === undefined) {
      // Not JSON, so it is the JSX itself — the shape the artifact event uses now.
      jsx = code;
    } else if (parsed && typeof parsed === 'object') {
      const payload = parsed as { jsx?: unknown; title?: unknown };
      if (typeof payload.jsx === 'string') {
        jsx = payload.jsx;
        if (!title && typeof payload.title === 'string') title = payload.title;
      } else {
        log.warn('a generated view is JSON but carries no jsx — nothing to render', {
          ...context,
          keys: Object.keys(payload),
          codeHead: head(code),
        });
      }
    } else {
      log.warn('a generated view parsed to a non-object — nothing to render', {
        ...context,
        parsedType: parsed === null ? 'null' : typeof parsed,
        codeHead: head(code),
      });
    }
  }

  return {
    title: title || t('artifact.untitled'),
    jsx,
    ...(typeof source.sourceTool === 'string' ? { sourceTool: source.sourceTool } : {}),
  };
}

/**
 * Did a tool call fail? Lives in `chat/toolCalls.ts` beside the rest of the tool
 * line's rules; re-exported here because history reads it from this module.
 */
export { looksLikeToolFailure };

/**
 * The tool whose *payload* arrives as its own event.
 *
 * `render_ui` announces itself with an ordinary `ai.tool_call` — the JSX it drew is
 * published separately as `ai.artifact.generated` (§4), and that event stays the
 * source of the view. Turning the announcement into a part would commit a second
 * block directly above the artifact it is announcing.
 *
 * Its `args` used to be `null` as well; since 2026-09-05 they are populated like
 * every other call's, so the announcement is no longer empty — it is simply not
 * the copy we draw. Reading the JSX from here instead would go behind the
 * unwrapping the artifact event does for us.
 */
export const ARTIFACT_ANNOUNCEMENT_TOOL = 'render_ui';

/**
 * The tools an approval card is about: the names on its action rows and the keys
 * of its `allow_options`. Both, because neither is reliable alone — a
 * connected-app row names the inner action, and a card with no standing options
 * has no keys at all.
 */
function gatedTools(actions: unknown, allowOptions: unknown): Set<string> {
  const names = new Set<string>();
  const rows = Array.isArray(actions) ? actions : [actions];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    for (const key of ['tool', 'name', 'tool_name']) {
      if (typeof record[key] === 'string') names.add(record[key]);
    }
  }
  if (allowOptions && typeof allowOptions === 'object' && !Array.isArray(allowOptions)) {
    for (const key of Object.keys(allowOptions)) names.add(key);
  }
  return names;
}

export function isTerminal(eventType: string): boolean {
  return (
    eventType === 'ai.run.completed' ||
    eventType === 'ai.run.cancelled' ||
    eventType === 'ai.run.error'
  );
}

/**
 * Bridge the AI channel's publications into an async iterator of cumulative-text
 * chunks for a single AI run.
 *
 * The AI channel (`ai:user-<id>`) is a **server-side** subscription baked into the
 * connection token — there is no client `subscribe()`. Its publications therefore
 * arrive on the client-level `publication` event (like `chat:` / `notifications:`)
 * and are routed by `ctx.channel`, not delivered on a per-channel `Subscription`.
 *
 * Consumes `ai:user-<id>` publications for `channel`, keeps only this run's events
 * (matched on `run_uuid`, since one channel can interleave several runs),
 * accumulates `ai.token` deltas, and completes on the terminal event — yielding
 * the authoritative `content` from `ai.run.completed`. `ai.run.error` rejects;
 * `ai.run.cancelled` ends quietly. Aborting the passed signal stops iteration (the
 * caller is responsible for POSTing the cancel to the backend).
 *
 * `ai.action.pending` is **not** terminal: the run pauses awaiting human approval,
 * so we emit a HITL card part (see {@link HITL_PENDING_TOOL_NAME}), keep the stream
 * open, and suspend the idle watchdog (a human may take minutes). The card POSTs the
 * resume decision; the backend then continues the same run on this channel
 * (`ai.run.resumed` → more `ai.token` → a real terminal), which un-suspends the
 * watchdog and flows straight back through this generator.
 *
 * Yields the *cumulative* parts each time, so the consumer can assign each chunk
 * straight onto the assistant message rather than merging it.
 */
export async function* streamAiRun(
  client: Centrifuge,
  channel: string,
  initialRunUuid: string | null,
  abortSignal: AbortSignal,
  options: StreamJoinOptions = {},
): AsyncGenerator<AiRunChunk> {
  /**
   * The run being followed. `null` only on a joined stream for a paused run whose
   * uuid nobody told us — see {@link StreamJoinOptions.conversationUuid}; the
   * first event of that conversation fixes it.
   */
  let runUuid: string | null = initialRunUuid;
  if (runUuid === null && !options.conversationUuid) {
    throw new Error('streamAiRun needs a run uuid or a conversation to adopt one from');
  }
  // Committed, ordered parts (finalized text segments + tool-call components) and
  // the currently-open text buffer that trailing `ai.token` deltas append to. A
  // `ai.tool_call` closes the open text and appends a tool part, so components
  // render in true arrival order relative to the surrounding text.
  const committed: MessagePart[] = [...(options.seedParts ?? [])];
  let currentText = '';
  let toolCount = committed.length;
  /** Live-only thinking text — see `AiRunChunk.reasoning`. Never becomes a part. */
  let reasoning = '';
  /**
   * Open delegations, by `tool_call_id`, pointing at their part in `committed`.
   *
   * Keyed by id rather than by tool name because more than one `task` can be in
   * flight at once — that is the whole reason the backend started sending
   * `tool_call_id`. `pending` keeps the ids in arrival order so a result that
   * arrives *without* an id (a truncated call, or an older backend) can still
   * resolve the oldest open one instead of leaving a card spinning forever.
   */
  const delegations = new Map<string, number>();
  const pendingDelegations: string[] = [];
  let dirty = false;
  let done = false;
  let timedOut = false;
  let error: Error | null = null;
  /** Set by the terminal `ai.run.completed`; see AiRunChunk.messageUuid. */
  let messageUuid: string | undefined;
  /** Any `ai.tool_call` at all — see AiRunChunk.calledTools. */
  let calledTools = false;
  /**
   * The reply's tool line. Replaced, never mutated: the consumer assigns it
   * straight onto the message, and an array edited in place would not re-render.
   */
  let toolCalls: ToolCallRecord[] = [];
  /** The latest task list, or `null` while the agent has written none. */
  let todos: TodoItem[] | null = null;

  /** Rewrite the calls `match` picks. */
  const updateCalls = (
    match: (call: ToolCallRecord) => boolean,
    patch: Partial<ToolCallRecord>,
  ): void => {
    toolCalls = toolCalls.map((call) => (match(call) ? { ...call, ...patch } : call));
  };

  /** Cumulative parts: committed parts plus the open text buffer, if any. */
  const buildParts = (): MessagePart[] =>
    currentText ? [...committed, { type: 'text', text: currentText }] : [...committed];
  /** All text so far, for logging / the empty-run check. */
  const allText = (): string =>
    committed
      .filter((p): p is TextPart => p.type === 'text')
      .map((p) => p.text)
      .join('') + currentText;
  const hasOutput = (): boolean => committed.length > 0 || currentText.length > 0;
  /** The thinking so far, omitted entirely on a turn that never emitted any. */
  const thinking = (): { reasoning?: string } => (reasoning ? { reasoning } : {});
  // Track `seq` to detect a gap (a missed publication). We don't hard-recover
  // inline — the documented fix is a REST reconcile (guide §7) — but a gap is
  // worth surfacing so a truncated reply is diagnosable.
  let lastSeq = -1;
  // A one-shot resolver used to wake the loop when new data/terminal arrives.
  let wake: (() => void) | null = null;
  // Watchdog: fires if the run goes silent (no event) past the idle window, so a
  // dropped socket / missed terminal event can't hang the run — and the stop
  // button — forever. Re-armed on every event for this run (see `armIdle`).
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  // Suspended while the run is paused on an `ai.action.pending` awaiting human
  // approval — a person may take minutes, which is not the run stalling, so the
  // watchdog must not fire. Any later run event clears this (see the handler).
  // A stream that joins a run already waiting on a card starts here.
  let paused = options.startPaused === true;

  /** One cumulative chunk — every yield below is this plus, at most, a flag. */
  const snapshot = (): AiRunChunk => ({
    parts: buildParts(),
    text: allText(),
    messageUuid,
    calledTools,
    ...thinking(),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(todos ? { todos } : {}),
    ...(runUuid ? { runUuid } : {}),
  });

  const bump = () => {
    dirty = true;
    const w = wake;
    wake = null;
    w?.();
  };

  const armIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    // Don't run the watchdog while paused for human approval.
    if (paused) {
      idleTimer = null;
      return;
    }
    idleTimer = setTimeout(() => {
      timedOut = true;
      done = true;
      bump();
    }, AI_RUN_IDLE_TIMEOUT_MS);
  };

  const handler = (ctx: ServerPublicationContext) => {
    // Client-level publications carry every server-side channel — route to this
    // run's AI channel and drop everything else (chat:, notifications:, …).
    if (ctx.channel !== channel) return;
    const evt = ctx.data as AiRunEvent;
    if (runUuid === null) {
      // Joined a paused run with no uuid: the first event of this conversation
      // that belongs to a run is the run waking up. A title has no run to adopt,
      // and a voice event carries `run_uuid: null`.
      if (evt.conversation_uuid !== options.conversationUuid || !evt.run_uuid) return;
      if (evt.event_type === 'ai.conversation.titled') return;
      runUuid = evt.run_uuid;
      log.info('adopted the run a restored approval was waiting on', {
        runUuid,
        eventType: evt.event_type,
      });
    }
    // One `ai:user-<id>` channel can interleave several runs — keep only ours.
    if (evt.run_uuid !== runUuid) return;

    // While paused for human approval, stay suspended until the run actually
    // resumes producing output. Only these events mean it's live again; ignore
    // incidental ones (e.g. a late `ai.conversation.titled`) so a stray publication
    // during the human wait can't re-arm the watchdog and time the paused run out.
    if (paused) {
      const resumesRun =
        evt.event_type === 'ai.run.resumed' ||
        evt.event_type === 'ai.token' ||
        evt.event_type === 'ai.reasoning' ||
        evt.event_type === 'ai.tool_call' ||
        evt.event_type === 'ai.tool_result' ||
        evt.event_type === 'ai.artifact.generated' ||
        evt.event_type === 'ai.action.auto_approved' ||
        evt.event_type === 'ai.todos' ||
        evt.event_type === 'ai.run.completed' ||
        evt.event_type === 'ai.run.cancelled' ||
        evt.event_type === 'ai.run.error';
      if (resumesRun) paused = false;
    }

    // Reset the watchdog on any event for our run (no-op while still paused for
    // approval — see armIdle).
    armIdle();

    // A resumed run starts a new **segment**, and `seq` restarts at 1 inside it.
    // Without this reset the counter would still hold the pre-pause high-water
    // mark, so every event of the second segment reads as "already seen" and a
    // genuine hole in it would go unreported for the rest of the run.
    if (evt.event_type === 'ai.run.resumed') lastSeq = -1;

    if (typeof evt.seq === 'number') {
      if (lastSeq >= 0 && evt.seq > lastSeq + 1) {
        log.warn('seq gap — a publication was missed', {
          runUuid,
          expected: lastSeq + 1,
          got: evt.seq,
        });
      }
      lastSeq = Math.max(lastSeq, evt.seq);
    }

    switch (evt.event_type) {
      case 'ai.token':
        currentText += evt.data?.delta ?? '';
        bump();
        break;
      case 'ai.reasoning':
        // The model is thinking out loud before it answers. Accumulated beside
        // the parts, never into them: it is live-only and the stored reply does
        // not contain it, so writing it into the turn would show a reopened
        // thread something it can never show again.
        reasoning += evt.data?.delta ?? '';
        bump();
        break;
      case 'ai.tool_call': {
        // Recorded even for the tools that draw nothing: a file is delivered by a
        // tool, so this is what says "worth looking for one".
        calledTools = true;
        // The backend wants a component drawn. Close any open text, append a
        // tool-call part (the registry maps `tool` → component), and log it —
        // every tool that arrives from the backend is logged to the console.
        if (currentText) {
          committed.push({ type: 'text', text: currentText });
          currentText = '';
        }
        const toolName = evt.data?.tool ?? 'unknown';
        // Announced here, delivered by `ai.artifact.generated` — see the constant.
        if (toolName === ARTIFACT_ANNOUNCEMENT_TOOL) break;
        // The plan, written as a tool call. `ai.todos` normally carries the same
        // list; reading the args too covers a backend that only sends the call.
        if (toolName === WRITE_TODOS_TOOL) {
          const fromArgs = readTodos(evt.data?.args);
          if (fromArgs) todos = fromArgs;
          bump();
          break;
        }
        // Everything else that is not its own block is a card in the tool line.
        //
        // **A resumed run announces the gated call again.** After an approval
        // the backend re-runs the paused tool node, which publishes a second
        // `ai.tool_call` for the very same call (seen on a device, 2026-10-23:
        // `create_trigger` before the pause and again, `args: null`, after it —
        // history holds one). A second card for it never gets a result and sits
        // at "Pending" under a finished reply, so a repeat joins the card it
        // repeats: by `tool_call_id`, or — without one — the open call of the
        // same tool when the repeat carries no arguments.
        if (isToolLineCall(toolName)) {
          const callId = evt.data?.tool_call_id;
          const repeatOf =
            (callId ? toolCalls.find((call) => call.id === callId) : undefined) ??
            (evt.data?.args == null
              ? [...toolCalls]
                  .reverse()
                  .find(
                    (call) =>
                      call.tool === toolName &&
                      (call.status === 'running' || call.status === 'awaiting'),
                  )
              : undefined);
          if (repeatOf) {
            updateCalls((call) => call === repeatOf, {
              status: 'running',
              ...(evt.data?.args != null ? { args: evt.data.args } : {}),
            });
          } else {
            toolCalls = [
              ...toolCalls,
              {
                id: callId ?? `${toolName}-${runUuid}-${evt.seq}`,
                tool: toolName,
                args: evt.data?.args ?? {},
                status: 'running',
              },
            ];
          }
        }
        // A delegation *is* a block: the model has handed the work to a subagent
        // and nothing else will be said until it comes back, so the turn has to
        // show what it is waiting for. The matching `ai.tool_result` resolves this
        // very part — see the `ai.tool_result` case.
        if (toolName === DELEGATION_TOOL) {
          const delegation = parseDelegationArgs(evt.data?.args);
          const callId = evt.data?.tool_call_id ?? `${DELEGATION_TOOL}-${runUuid}-${evt.seq}`;
          delegations.set(callId, committed.length);
          pendingDelegations.push(callId);
          committed.push({
            type: 'tool-call',
            toolCallId: `delegation-${callId}`,
            toolName: AI_DELEGATION_TOOL_NAME,
            args: { ...delegation, status: 'running' } satisfies AiDelegationArgs,
          });
          toolCount += 1;
          log.info('ai.tool_call — delegating to a subagent', {
            runUuid,
            seq: evt.seq,
            toolCallId: callId,
            subagentType: delegation.subagentType,
            // The description is the model's own words and short by construction;
            // it is the one thing that says *which* delegation this line is about.
            description: delegation.description,
          });
          bump();
          break;
        }
        // **A tool call is not a block.** `render_ui` is the only tool whose output
        // is meant for the screen, and it arrives on its own event; everything else
        // — `list_analytics_charts`, `get_company_overview`, `run_analytics_chart`,
        // `task` — is the model fetching context. Committing a part for those put an
        // invisible block in the turn for every call the model made and warned
        // "unknown generative-UI tool" on each render, because the registry has
        // never had a component for them and never will.
        //
        // This is the live-stream half of the same rule history follows for stored
        // tool results (see `toTranscript`): the announcement is logged, not drawn.
        log.info('ai.tool_call received from backend', {
          runUuid,
          seq: evt.seq,
          tool: toolName,
          toolCallId: evt.data?.tool_call_id ?? null,
          args: evt.data?.args,
        });
        bump();
        break;
      }
      case 'ai.tool_result': {
        // Not rendered as its own block, but logged so tool round-trips are
        // visible — and raised to a warning when the result reads as a failure,
        // which the event itself does not say (see `looksLikeToolFailure`).
        const failed = looksLikeToolFailure(evt.data?.content);
        const line = {
          runUuid,
          seq: evt.seq,
          tool: evt.data?.tool,
          ...(failed ? { content: evt.data?.content } : {}),
        };
        if (failed) log.warn('a tool reported a failure in its result', line);
        else log.info('ai.tool_result received from backend', line);

        // Close its card in the tool line: by `tool_call_id`, else the oldest call
        // of the same tool still open — the same fallback the web client uses.
        const lineId = evt.data?.tool_call_id;
        const open = (call: ToolCallRecord) =>
          call.status === 'running' || call.status === 'awaiting';
        const target =
          (lineId ? toolCalls.find((call) => call.id === lineId) : undefined) ??
          toolCalls.find((call) => open(call) && call.tool === evt.data?.tool);
        if (target) {
          updateCalls((call) => call === target, {
            status: statusFromResult(evt.data?.content),
            result: typeof evt.data?.content === 'string' ? evt.data.content : undefined,
          });
          bump();
        }

        // The one result that *is* drawn: it closes a delegation card opened
        // above. Paired on `tool_call_id`, falling back to the oldest open one —
        // see `pendingDelegations`. A card left `running` because its result never
        // arrived is exactly what the backend's own hung-`task` bug produced, so
        // the fallback matters more here than the precision does.
        const resultId = evt.data?.tool_call_id;
        const callId =
          resultId && delegations.has(resultId)
            ? resultId
            : evt.data?.tool === DELEGATION_TOOL
              ? pendingDelegations[0]
              : undefined;
        const index = callId === undefined ? undefined : delegations.get(callId);
        if (callId !== undefined && index !== undefined) {
          const part = committed[index];
          if (part?.type === 'tool-call') {
            const args = part.args as AiDelegationArgs;
            // Replaced, not mutated: the consumer assigns the parts array straight
            // onto the message, and a mutated-in-place part would not re-render.
            committed[index] = {
              ...part,
              args: { ...args, status: failed ? 'failed' : 'done' } satisfies AiDelegationArgs,
            };
          }
          delegations.delete(callId);
          const queued = pendingDelegations.indexOf(callId);
          if (queued >= 0) pendingDelegations.splice(queued, 1);
          log.info('a delegation came back', {
            runUuid,
            seq: evt.seq,
            toolCallId: callId,
            pairedBy: resultId && resultId === callId ? 'tool_call_id' : 'arrival order',
            outcome: failed ? 'failed' : 'done',
          });
          bump();
        }
        break;
      }
      case 'ai.artifact.generated': {
        // The model drew something rather than describing it. Close any open text
        // and append it as a part so it keeps its place in the turn. Not terminal —
        // one run can emit several of these and keep streaming afterwards.
        if (currentText) {
          committed.push({ type: 'text', text: currentText });
          currentText = '';
        }
        const artifact = parseArtifactPayload(evt.data?.code, {
          where: 'ai.artifact.generated',
          title: evt.data?.title,
          language: evt.data?.language,
          sourceTool: evt.data?.source_tool,
          context: { runUuid, seq: evt.seq },
        });
        committed.push({
          type: 'tool-call',
          toolCallId: `artifact-${runUuid}-${evt.seq ?? toolCount}`,
          toolName: AI_ARTIFACT_TOOL_NAME,
          args: artifact,
        });
        toolCount += 1;
        log.info('ai.artifact.generated received from backend', {
          runUuid,
          seq: evt.seq,
          title: artifact.title,
          sourceTool: artifact.sourceTool,
          // The JSX itself is a model output and stays out of the log (these cross
          // the bridge into the native log file); its size is what tells you
          // whether the payload arrived at all.
          jsxChars: artifact.jsx?.length ?? 0,
        });
        bump();
        break;
      }
      case 'ai.run.completed': {
        // Authoritative final text. For a plain-text turn (no tool calls) replace
        // with the canonical `content`; when tool calls are interleaved we keep
        // the streamed parts as-is (the content can't be re-threaded around them).
        // Only swap in a *non-empty* `content`: an empty/absent value (a partial
        // completion whose final token batch was dropped, or a terminal event with
        // no body) must not wipe what already streamed to a blank message — `??`
        // would let `content: ""` through and blank it.
        const finalText = evt.data?.content;
        if (toolCount === 0 && typeof finalText === 'string' && finalText.length > 0) {
          committed.length = 0;
          currentText = finalText;
        }
        // The only place a live turn learns its own server uuid. Without it the
        // reply has no identity until the next history load, so it cannot be
        // regenerated or branched — see AiRunChunk.messageUuid.
        if (typeof evt.data?.message_uuid === 'string') messageUuid = evt.data.message_uuid;
        done = true;
        bump();
        break;
      }
      case 'ai.run.cancelled':
        // Terminal, no authoritative text to swap in — keep what streamed.
        done = true;
        bump();
        break;
      case 'ai.action.pending': {
        // The run pauses awaiting human approval — NOT terminal. Close any open
        // text and append a HITL card part (rendered via the reserved tool name);
        // the card POSTs the resume decision and the backend continues this same
        // run on the channel. Suspend the watchdog: the wait is a person deciding,
        // not the run stalling.
        if (currentText) {
          committed.push({ type: 'text', text: currentText });
          currentText = '';
        }
        const pendingArgs: HitlPendingArgs = {
          pendingUuid: evt.data?.pending_uuid ?? '',
          conversationUuid: evt.conversation_uuid,
          actions: evt.data?.actions,
          allowOptions: evt.data?.allow_options,
        };
        committed.push({
          type: 'tool-call',
          toolCallId: `hitl-${runUuid}-${evt.data?.pending_uuid ?? evt.seq ?? toolCount}`,
          toolName: HITL_PENDING_TOOL_NAME,
          args: pendingArgs,
        });
        toolCount += 1;
        // The calls this card is about now wait on a person, not on the tool.
        const gated = gatedTools(evt.data?.actions, evt.data?.allow_options);
        updateCalls((call) => call.status === 'running' && gated.has(call.tool), {
          status: 'awaiting',
        });
        paused = true;
        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }
        log.info('ai.action.pending — run paused for human approval', {
          runUuid,
          seq: evt.seq,
          pendingUuid: evt.data?.pending_uuid,
        });
        bump();
        break;
      }
      case 'ai.action.auto_approved': {
        // A gated tool ran without a card because the person allowed it earlier.
        // Said out loud, in place: an email that went out with nobody asked is
        // exactly the thing a person must be able to see happened.
        if (currentText) {
          committed.push({ type: 'text', text: currentText });
          currentText = '';
        }
        const tool = evt.data?.tool ?? '';
        const summary = evt.data?.summary?.trim() || tool || t('autoApproved.fallback');
        committed.push({
          type: 'tool-call',
          toolCallId: `auto-${runUuid}-${evt.data?.tool_call_id ?? evt.seq ?? toolCount}`,
          toolName: AI_AUTO_APPROVED_TOOL_NAME,
          args: { tool, summary } satisfies AiAutoApprovedArgs,
        });
        toolCount += 1;
        log.info('ai.action.auto_approved — an allowed tool ran without a card', {
          runUuid,
          seq: evt.seq,
          tool,
          toolCallId: evt.data?.tool_call_id,
        });
        bump();
        break;
      }
      case 'ai.run.error':
        log.warn('ai.run.error — the backend ended this run with a failure', {
          runUuid,
          seq: evt.seq,
          message: evt.data?.message,
        });
        error = new Error(evt.data?.message || t('reply.runFailed'));
        done = true;
        bump();
        break;
      case 'ai.run.resumed':
        // The person decided: the calls that were waiting run now, or never will.
        updateCalls((call) => call.status === 'awaiting', {
          status: evt.data?.decision === 'reject' ? 'denied' : 'running',
        });
        bump();
        break;
      case 'ai.todos': {
        const next = readTodos(evt.data);
        if (next) {
          todos = next;
          bump();
        }
        break;
      }
      default:
        // started / titled / step — not surfaced here.
        break;
    }
  };

  const onAbort = () => {
    done = true;
    bump();
  };

  client.on('publication', handler);
  // End the stream promptly if the connection is deliberately torn down (sign-out /
  // company switch) — otherwise removeAllListeners() detaches our handler and the
  // run would park until the idle watchdog.
  const offTeardown = onRealtimeTeardown(() => {
    done = true;
    bump();
  });
  // Arm the watchdog up front: it also covers the pre-first-token window, so a
  // run that is accepted (202) but never publishes anything can't hang either.
  armIdle();
  if (abortSignal.aborted) onAbort();
  else abortSignal.addEventListener('abort', onAbort);

  try {
    while (!done) {
      if (dirty) {
        dirty = false;
        yield snapshot();
      } else {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    }
    // Flush a final cumulative chunk (e.g. the authoritative completed `content`).
    if (dirty)
      yield snapshot();
    // A delegation card is only ever closed by its result, and a stream can end
    // without one — the run failed, stalled or was stopped, or (the backend's own
    // hung-`task` bug) the result simply never came. Leaving the card spinning
    // says the subagent is still working when nothing is listening any more, so
    // every open one is settled here: the run finished ⇒ the work is over, and
    // anything else ⇒ it did not get there.
    if (pendingDelegations.length > 0) {
      const status: DelegationStatus =
        error || timedOut || abortSignal.aborted ? 'failed' : 'done';
      log.warn('the stream ended with a delegation still open — settling the card', {
        runUuid,
        open: pendingDelegations.length,
        status,
      });
      for (const callId of pendingDelegations.splice(0)) {
        const index = delegations.get(callId);
        delegations.delete(callId);
        const part = index === undefined ? undefined : committed[index];
        if (index === undefined || part?.type !== 'tool-call') continue;
        committed[index] = {
          ...part,
          args: { ...(part.args as AiDelegationArgs), status } satisfies AiDelegationArgs,
        };
      }
      yield snapshot();
    }
    if (error) throw error;
    if (timedOut) {
      log.warn('run idle timeout — no event past the watchdog window; ending stream', {
        runUuid,
        idleTimeoutMs: AI_RUN_IDLE_TIMEOUT_MS,
        chars: allText().length,
      });
      // Nothing streamed at all ⇒ surface a failure so the user sees an error
      // rather than a blank reply.
      if (!hasOutput()) {
        throw new Error(t('reply.stoppedResponding'));
      }
      // Partial output ⇒ keep every character of it, but say that it is partial.
      // This used to end quietly, which marked the turn `complete` and left the
      // user with a half-sentence that looked like the whole answer — and the run
      // that stalled never persisted anything either, so reopening the thread
      // showed the question with no reply at all. A stall is not a completion.
      yield { ...snapshot(), timedOut: true };
    }
  } finally {
    // One line per run saying what the client actually ended up holding. This is
    // *the* log to read for "the assistant answered and I saw nothing": it names
    // every committed part, so a turn that produced only an artifact — or an
    // artifact with no renderable payload — is distinguishable from one that
    // produced nothing at all, without reading the whole event trace above it.
    log.info('run stream ended', {
      runUuid,
      lastSeq,
      textChars: allText().length,
      // The thinking is never shown after the first token and never stored, so
      // its size here is the only lasting trace that the model thought at all.
      reasoningChars: reasoning.length,
      // A card still spinning when the stream ended: the delegation's result
      // never arrived. This is the client-side signature of the hung-`task` bug.
      unresolvedDelegations: pendingDelegations.length,
      partCount: committed.length + (currentText ? 1 : 0),
      parts: buildParts().map((part) =>
        part.type === 'text' ? `text(${part.text.length})` : `tool:${part.toolName}`,
      ),
      timedOut,
      aborted: abortSignal.aborted,
      failed: error !== null,
    });
    if (idleTimer) clearTimeout(idleTimer);
    // Detach only this run's listener; the connection (and its server-side AI
    // subscription) stays live for the next run.
    client.off('publication', handler);
    abortSignal.removeEventListener('abort', onAbort);
    offTeardown();
  }
}
