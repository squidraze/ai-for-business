/**
 * Opening a thread, and mapping the server's messages onto ours.
 *
 * Replaces `aiThreadListAdapter`'s `history` adapter. The native version had to
 * report its outcome through a side store (`historyLoadStatus.ts`) because
 * assistant-ui swallowed a failed load and simply left the thread empty — a load
 * error masquerading as an empty thread. Here the outcome *is* the state
 * (`historyStatus`), so that class of bug cannot come back.
 */
import { clearComposerAttachments } from '@/attachments/uploads';
import { send as bridgeSend } from '@/bridge/bridge';
import type { ThreadTarget } from '@/bridge/protocol';
import { listMessageHistory } from '@/lib/api/ai';
import { t } from '@/i18n';
import { getErrorMessage, isAbortError } from '@/lib/api/errors';
import type { AIAttachmentRead, AIMessageRead } from '@/lib/api/types';
import { logger } from '@/lib/logger';
import { isVerbose, verbatim } from '@/lib/verbose';
import {
  AI_ARTIFACT_TOOL_NAME,
  AI_DELEGATION_TOOL_NAME,
  ARTIFACT_ANNOUNCEMENT_TOOL,
  DELEGATION_TOOL,
  looksLikeToolFailure,
  parseArtifactPayload,
  parseDelegationArgs,
  type AiDelegationArgs,
} from '@/realtime/aiEvents';

import { resetBranches } from './branches';
import {
  describeRawHistory,
  describeTranscript,
  describeTurnShape,
  emptyBubbles,
  isMissing,
  longestAssistantStreak,
  shortUuid,
  trailingRole,
  verdictFor,
} from './diagnostics';
import { setConversationCompany } from './companies';
import {
  isToolLineCall,
  parseMaybeJson,
  readTodos,
  statusFromResult,
  WRITE_TODOS_TOOL,
} from './toolCalls';
import { ensureTitle, recoverRuns, teardownActiveRun } from './run';
import {
  currentGeneration,
  getState,
  isStale,
  resetThread,
  setHistoryError,
  setHistoryLoading,
  setHistoryReady,
  updateAssistantMessage,
} from './store';
import type {
  AssistantMessage,
  ChatAttachment,
  ChatMessage,
  MessagePart,
  MessageRating,
  TodoItem,
  ToolCallRecord,
} from './types';

const log = logger.child('history');

/** Matches the native `HISTORY_PAGE_LIMIT` — one page covers every real chat. */
export const HISTORY_PAGE_LIMIT = 100;

const HISTORY_ERROR_FALLBACK = 'Could not load this conversation.';

/* ---------------------------------------------------------------- */
/* Mapping                                                           */
/* ---------------------------------------------------------------- */

/**
 * The backend hands back a ready-to-use presigned `download_url`, so the bubble
 * renders the real photo with no extra request. It is `null` while the file is
 * still processing (or once the URL expired), and the chip falls back to its
 * icon + filename tile — never a broken image.
 */
/**
 * The backend stores `filename` percent-encoded, so a Cyrillic name arrives as
 * `%D0%94%D0%B5%D1%84...` and the tile shows that verbatim. Decoding is guarded:
 * `decodeURIComponent` throws on a lone `%`, which a real filename may well
 * contain, and a slightly wrong name beats a transcript that will not render.
 */
function decodeFilename(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function toChatAttachment(attachment: AIAttachmentRead): ChatAttachment {
  const contentType = attachment.content_type ?? 'application/octet-stream';
  return {
    id: attachment.uuid,
    name: attachment.filename ? decodeFilename(attachment.filename) : t('attachments.untitled'),
    contentType,
    kind: contentType.startsWith('image/') ? 'image' : 'file',
    url: attachment.download_url ?? null,
    status: attachment.status,
    error: attachment.error ?? null,
  };
}

/**
 * `role` is a bare `string` on the wire, so anything we do not recognise renders
 * as an assistant turn — the same fallback the native `toThreadMessage` used.
 * Dropping the message instead would silently lose part of the transcript.
 *
 * Only the text lives on the message itself. A turn that drew something has its
 * view on a *separate* `tool` message, which {@link toTranscript} folds back in —
 * this function never sees one.
 */
/** `feedback_rating` is a bare string on the wire — narrow it, or drop it. */
function toRating(value: string | null | undefined): MessageRating | null {
  return value === 'good' || value === 'bad' ? value : null;
}

export function toChatMessage(message: AIMessageRead): ChatMessage {
  const text = message.content ?? '';
  const attachments = (message.attachments ?? []).map(toChatAttachment);

  // `sibling_count` is only computed on this endpoint; `1` there means "no
  // alternates", and anywhere else it would mean "not computed" — which is why the
  // switcher is only ever fed from a history page.
  const siblingCount = message.sibling_count ?? 1;

  if (message.role === 'user') {
    return {
      id: message.uuid,
      uuid: message.uuid,
      role: 'user',
      text,
      attachments,
      createdAt: message.created_at,
      // Anything the server returned is, by definition, delivered.
      status: 'sent',
      siblingCount,
    };
  }

  return {
    id: message.uuid,
    uuid: message.uuid,
    role: 'assistant',
    parts: text ? [{ type: 'text', text }] : [],
    // The thumbs the user left on this reply, if any. Stored on the row, so this
    // is what makes a rating outlive the session that gave it.
    feedback: toRating(message.feedback_rating),
    // Files the assistant delivered. These used to be computed and then thrown
    // away on this branch, so a report the agent had actually built and attached
    // reached the client and was never drawn.
    attachments,
    createdAt: message.created_at,
    status: 'complete',
    siblingCount,
  };
}

/* ---------------------------------------------------------------- */
/* Loading                                                           */
/* ---------------------------------------------------------------- */

/**
 * Is this stored tool result a view, or context for the model?
 *
 * The primary test is the tool's own name: `render_ui` is the one tool whose
 * return value is meant for the screen, and it is the same constant the live
 * stream matches on to recognise the announcement of one.
 *
 * The fallback covers a row that arrives with no `name` at all — the field is
 * optional on the wire — by looking for the stored `render_ui` shape: JSON
 * carrying a `jsx` string. Nothing else produces that, so it is still safe to
 * draw. A payload that is *not* JSON and has no name is plumbing, and reading it
 * as bare JSX is exactly what used to put kilobytes of tool output on screen.
 */
function isViewBearingToolResult(item: AIMessageRead): boolean {
  if (item.name) return item.name === ARTIFACT_ANNOUNCEMENT_TOOL;
  if (typeof item.content !== 'string' || item.content.length === 0) return false;
  try {
    const parsed: unknown = JSON.parse(item.content);
    return Boolean(
      parsed &&
        typeof parsed === 'object' &&
        typeof (parsed as { jsx?: unknown }).jsx === 'string',
    );
  } catch {
    return false;
  }
}

/**
 * The delegations stored on one assistant row, as parts.
 *
 * A `task` call is stored the way OpenAI stores any tool call — on the assistant
 * row's `tool_calls`, as `{ id, function: { name, arguments } }` with the
 * arguments as a JSON *string* — and its answer is a separate `tool` row. The
 * live stream draws a card for it (see `AI_DELEGATION_TOOL_NAME`), so a reopened
 * thread has to as well, or the wait that shaped the turn disappears on reload
 * and the answer looks like it arrived out of nowhere.
 *
 * `tool_calls` is `unknown` on the wire, so every level is checked: a row whose
 * shape we do not recognise contributes nothing rather than throwing inside the
 * transcript. Calls to any other tool are skipped here for the same reason the
 * live stream skips them — they are the model fetching context, not something to
 * show (see `toTranscript`'s tool-result branch).
 */
function storedDelegations(
  item: AIMessageRead,
  resolve: (callId: string | undefined) => AiDelegationArgs['status'],
): MessagePart[] {
  if (!Array.isArray(item.tool_calls)) return [];
  const parts: MessagePart[] = [];

  for (const [index, entry] of item.tool_calls.entries()) {
    if (!entry || typeof entry !== 'object') continue;
    const call = entry as Record<string, unknown>;
    const fn =
      call.function && typeof call.function === 'object'
        ? (call.function as Record<string, unknown>)
        : {};
    // Both spellings: the OpenAI envelope (`function.name` / `function.arguments`)
    // and the flattened one a re-serialising backend can produce.
    const name = typeof fn.name === 'string' ? fn.name : typeof call.name === 'string' ? call.name : '';
    if (name !== DELEGATION_TOOL) continue;
    const callId = typeof call.id === 'string' ? call.id : undefined;
    const delegation = parseDelegationArgs(fn.arguments ?? call.arguments ?? call.args);
    parts.push({
      type: 'tool-call',
      toolCallId: `delegation-${item.uuid}-${callId ?? index}`,
      toolName: AI_DELEGATION_TOOL_NAME,
      args: { ...delegation, status: resolve(callId) } satisfies AiDelegationArgs,
    });
  }

  return parts;
}

/** One stored call, in either spelling, with its arguments decoded. */
function readStoredCall(entry: unknown): { id?: string; name: string; args: unknown } | null {
  if (!entry || typeof entry !== 'object') return null;
  const call = entry as Record<string, unknown>;
  const fn =
    call.function && typeof call.function === 'object'
      ? (call.function as Record<string, unknown>)
      : {};
  const name =
    typeof fn.name === 'string' ? fn.name : typeof call.name === 'string' ? call.name : '';
  if (!name) return null;
  return {
    ...(typeof call.id === 'string' ? { id: call.id } : {}),
    name,
    args: parseMaybeJson(fn.arguments ?? call.arguments ?? call.args) ?? {},
  };
}

/**
 * The tool line and the task list stored on one assistant row.
 *
 * History keeps a call and its result apart: the row carries `tool_calls`, and
 * the `tool` rows right after it carry the results. Ids repeat from step to step
 * (`call_0` every time), so a result is looked up **only among the tool rows that
 * directly follow its call** — by id, then by name, then by position — the same
 * pairing the web client uses. A call with no result comes back `running`, which
 * the card reads as "Pending": the run ended without it answering.
 */
function storedToolLine(
  item: AIMessageRead,
  followers: readonly AIMessageRead[],
): { toolCalls: ToolCallRecord[]; todos: TodoItem[] | null } {
  const toolCalls: ToolCallRecord[] = [];
  let todos: TodoItem[] | null = null;
  if (!Array.isArray(item.tool_calls)) return { toolCalls, todos };

  const unused = new Set(followers);
  const take = (match: (row: AIMessageRead) => boolean): AIMessageRead | undefined => {
    const row = followers.find((candidate) => unused.has(candidate) && match(candidate));
    if (row) unused.delete(row);
    return row;
  };

  item.tool_calls.forEach((entry, position) => {
    const call = readStoredCall(entry);
    if (!call) return;
    if (call.name === WRITE_TODOS_TOOL) {
      todos = readTodos(call.args) ?? todos;
      return;
    }
    if (!isToolLineCall(call.name)) return;
    const row =
      (call.id ? take((candidate) => candidate.tool_call_id === call.id) : undefined) ??
      take((candidate) => candidate.name === call.name) ??
      take((candidate) => followers.indexOf(candidate) === position);
    toolCalls.push({
      id: `${item.uuid}:${position}`,
      tool: call.name,
      args: call.args,
      status: row ? statusFromResult(row.content ?? '') : 'running',
      ...(row ? { result: row.content ?? '' } : {}),
    });
  });

  return { toolCalls, todos };
}

/**
 * Rebuild the transcript from the stored trace.
 *
 * History does not return the turns the user saw — it returns the model's whole
 * working trace, in the OpenAI shape: an assistant message carrying `tool_calls`
 * and no text, then a `tool` message holding that call's raw result, then the
 * assistant message with the prose. Mapping those one-to-one is what put raw JSON
 * and a "No response" error into a reopened chat, in place of the view that had
 * rendered perfectly well while it was streaming:
 *
 *   - the `tool` message became an assistant bubble showing its own payload —
 *     `{"jsx": "<div …` — as text;
 *   - the announcement, having no text and no parts, looked exactly like a turn
 *     that had answered with nothing, which the screen reports as a failure.
 *
 * So the trace is folded instead. A `render_ui` result becomes an artifact part,
 * held until the assistant message it belongs to arrives — everything else in the
 * trace is plumbing and is dropped, with a line in the log saying what and why,
 * because a silently swallowed message is how this class of bug hides.
 *
 * **A turn is one bubble, however many rows it was stored as.** The model speaks
 * between its tool calls — "Got it, pulling the charts…", then the calls, then
 * "here's the dashboard:", then the calls, then the summary — and every one of
 * those is its own assistant row with its own uuid. The live stream shows one
 * message for all of it, because tokens accumulate into one bubble no matter how
 * many times the model stopped to work. Emitting a bubble per row is what made a
 * finished answer split into two or three the moment the thread was reopened, so
 * consecutive assistant rows are assembled into a single reply instead, in wire
 * order, and only a *user* row ends the turn.
 *
 * Two details make that safe rather than merely tidier:
 *
 *   - **the merged bubble keeps the first row's uuid.** That is the row a fork
 *     happens at: in the trace of a regenerated turn it is the announcement row
 *     — content-less, and the one carrying `sibling_count: 2` — that has the
 *     alternates. Keying the bubble on the last row instead would ask `/siblings`
 *     about a message that has none, and the "n of N" switcher would vanish from
 *     every reply.
 *   - **`sibling_count` is taken as the maximum over the turn**, for the same
 *     reason: the count sits on one row of several, and dropping that row (it has
 *     no text) is what used to lose it.
 */
export function toTranscript(items: readonly AIMessageRead[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  // How a stored delegation ended, read from the `tool` row that answered it.
  // A pre-pass, because that row comes *after* the call it belongs to: the answer
  // has to be in hand when the card is built, one pass later.
  const delegationResults = new Map<string, string>();
  // Results with no `tool_call_id` to pair on, in wire order — the fallback.
  const unkeyedDelegationResults: string[] = [];
  for (const item of items) {
    if (item.name !== DELEGATION_TOOL) continue;
    const content = item.content ?? '';
    if (item.tool_call_id) delegationResults.set(item.tool_call_id, content);
    else unkeyedDelegationResults.push(content);
  }
  let unkeyedCursor = 0;
  /**
   * The card's state, from the result that closed it. A delegation with **no**
   * stored result is `failed` rather than `done`: the run ended without the
   * subagent ever answering, which is the whole shape of the hung-`task` bug, and
   * calling it done would claim work that never came back.
   */
  const resolveDelegation = (callId: string | undefined): AiDelegationArgs['status'] => {
    const keyed = callId === undefined ? undefined : delegationResults.get(callId);
    const content = keyed ?? unkeyedDelegationResults[unkeyedCursor];
    if (keyed === undefined && content !== undefined) unkeyedCursor += 1;
    if (content === undefined) return 'failed';
    return looksLikeToolFailure(content) ? 'failed' : 'done';
  };
  /** Views read out of tool results, waiting for the turn that presented them. */
  let pending: MessagePart[] = [];
  /** The assistant turn being assembled from however many rows it was stored as. */
  let turn: AssistantMessage | null = null;
  /** How many rows went into it — logged, because one bubble from five rows is the fix working. */
  let turnRows = 0;

  /** Emit the turn if it has anything to show, and start a fresh one. */
  const closeTurn = (): void => {
    if (!turn) return;
    // A turn that produced only a file — no prose, no view — is still a turn worth
    // showing. Keying this on `parts` alone would drop the reply and the file with it.
    if (turn.parts.length > 0 || turn.attachments.length > 0) {
      if (turnRows > 1) {
        log.info('folded one assistant turn back into a single reply', {
          messageUuid: turn.uuid,
          rows: turnRows,
          parts: turn.parts.length,
        });
      }
      out.push(turn);
    } else {
      // Every row of the turn was a tool-call announcement: the model only ever
      // called things and never spoke. Nothing to draw.
      log.info('dropped an assistant turn with nothing to render', {
        messageUuid: turn.uuid,
        rows: turnRows,
      });
    }
    turn = null;
    turnRows = 0;
  };

  /** Add parts to the open turn, opening one for orphaned views if there is none. */
  const addToTurn = (parts: MessagePart[], seed: AssistantMessage | null, at: string): void => {
    if (turn) {
      turn = {
        ...turn,
        parts: [...turn.parts, ...parts],
        // A file can be attached to any row of the turn, so the merged bubble
        // carries every one of them.
        attachments: [...turn.attachments, ...(seed?.attachments ?? [])],
        // The count lives on whichever row the fork happened at — see the header.
        siblingCount: Math.max(turn.siblingCount ?? 1, seed?.siblingCount ?? 1),
        // A turn is stored as several rows and the rating sits on the one that
        // was on screen when it was given, so the merged bubble keeps whichever
        // row carries one rather than the last row's (usually empty) value.
        feedback: turn.feedback ?? seed?.feedback ?? null,
        // Every step's calls fold into the one "Used N tools" line, in order;
        // the task list is the latest one written.
        toolCalls: [...(turn.toolCalls ?? []), ...(seed?.toolCalls ?? [])],
        todos: seed?.todos ?? turn.todos,
      };
      return;
    }
    turn = seed
      ? { ...seed, parts }
      : {
          // A view whose turn never landed — a run that drew something and then
          // failed. It still belongs on screen: it is what the user asked for.
          id: `artifact-tail-${at}`,
          role: 'assistant',
          parts,
          attachments: [],
          createdAt: at,
          status: 'complete',
        };
  };

  for (const [index, item] of items.entries()) {
    // A tool result: the payload of something the model called. Only a drawn view
    // has anything to show; every other result is context for the model alone.
    if (item.role === 'tool' || item.tool_call_id) {
      // **Only `render_ui` returns something meant for the screen.** Every other
      // tool result is context for the model: a company overview, a catalogue of
      // available charts, the rows a chart was built from. This used to be read
      // as a view regardless of which tool answered, and because
      // `parseArtifactPayload` treats a non-JSON payload as bare JSX, a 6.8 KB
      // list of dataset names became a "generated view" — which then failed to
      // parse and drew its own raw text into the transcript. One question came
      // back from history as five bubbles: a wall of tool output, three blank
      // ones and the actual answer.
      //
      // The live stream never had the bug, and that asymmetry is the proof: it
      // renders views only from `ai.artifact.generated`, and logs `ai.tool_result`
      // without drawing it. History now applies the same rule, so a reopened
      // thread reads like the one that was left.
      if (!isViewBearingToolResult(item)) {
        log.info('dropped a tool result that is context for the model, not a view', {
          messageUuid: item.uuid,
          tool: item.name,
          contentChars: (item.content ?? '').length,
        });
        continue;
      }

      const artifact = parseArtifactPayload(item.content, {
        where: 'history tool result',
        sourceTool: item.name ?? undefined,
        context: { messageUuid: item.uuid, tool: item.name },
      });
      if (artifact.jsx !== null) {
        pending.push({
          type: 'tool-call',
          toolCallId: `artifact-${item.uuid}`,
          toolName: AI_ARTIFACT_TOOL_NAME,
          args: artifact,
        });
      } else {
        log.info('dropped a tool result with nothing to show', {
          messageUuid: item.uuid,
          tool: item.name,
        });
      }
      continue;
    }

    const message = toChatMessage(item);

    // An assistant row extends the turn in progress rather than starting a bubble
    // of its own. Whatever views arrived since the last row go in first, so the
    // parts end up in wire order — the intro, the dashboard it announced, then the
    // words about it, which is exactly the order the live stream produced.
    if (message.role === 'assistant') {
      // Views first (they were drawn before this row's words), then the
      // delegations this row announced, then the words themselves — wire order,
      // the same order the live stream committed them in.
      const parts = [...pending, ...storedDelegations(item, resolveDelegation), ...message.parts];
      pending = [];
      // The tool rows that answered this row's calls are the ones right after it.
      const followers: AIMessageRead[] = [];
      for (let next = index + 1; next < items.length; next += 1) {
        const row = items[next];
        if (row.role !== 'tool' && !row.tool_call_id) break;
        followers.push(row);
      }
      const line = storedToolLine(item, followers);
      const seed: AssistantMessage = {
        ...message,
        ...(line.toolCalls.length > 0 ? { toolCalls: line.toolCalls } : {}),
        ...(line.todos ? { todos: line.todos } : {}),
      };
      addToTurn(parts, seed, item.created_at);
      turnRows += 1;
      continue;
    }

    // A user row ends the turn above it. Anything still pending was drawn by that
    // turn and belongs to it.
    if (pending.length > 0) {
      addToTurn(pending, null, item.created_at);
      pending = [];
    }
    closeTurn();
    out.push(message);
  }

  if (pending.length > 0) {
    const last = items[items.length - 1];
    addToTurn(pending, null, last?.created_at ?? new Date().toISOString());
  }
  closeTurn();

  return out;
}

/** What one history read answered: the rows on the wire, and what we built from them. */
type HistoryRead = {
  /** Exactly what the endpoint returned, in wire order. */
  items: AIMessageRead[];
  /** The folded transcript — what the screen would show. */
  messages: ChatMessage[];
};

/**
 * The history endpoint is keyset-paginated and already returns oldest-first.
 *
 * Both halves come back, because this is the only point where they exist at once
 * and a missing reply can only be attributed by comparing them: a message the
 * response never carried is the backend's answer about the active branch, while
 * one that arrived and did not survive {@link toTranscript} is ours. `reason`
 * names the caller so a log line says *why* the transcript was re-read.
 */
async function fetchHistory(conversationUuid: string, reason: string): Promise<HistoryRead> {
  const page = await listMessageHistory(conversationUuid, { limit: HISTORY_PAGE_LIMIT });
  const items = page.items ?? [];
  const messages = toTranscript(items);
  // Deliberately `info`, not `debug`: `debug` is stripped from a production build
  // (see `lib/logger.ts`), and this is the line that has to be readable from a
  // device — no content, only roles, uuids and lengths.
  const shape = describeTurnShape(messages);
  log.info('history read', {
    reason,
    conversationUuid,
    rows: items.length,
    onScreen: messages.length,
    hasMore: page.meta.has_more,
    shape,
    wire: describeRawHistory(items),
    folded: describeTranscript(messages),
  });

  // A question answered by several bubbles is the reopened-thread half of "the
  // reply split into three". The stream puts every pause the model took into one
  // message; history keeps them as separate assistant rows, and folding them row
  // by row is what pulls the answer apart. Nothing here is wrong on the wire —
  // this is a decision about how the trace is presented, and it is ours.
  const streak = longestAssistantStreak(messages);
  if (streak > 1) {
    log.warn('one turn came back from history as several assistant bubbles', {
      reason,
      conversationUuid,
      bubbles: streak,
      shape,
      folded: describeTranscript(messages),
    });
  }

  // A bubble that draws nothing at all. It is not dropped — it has parts — so the
  // user gets a blank message with a copy button under it, and the `wire` line
  // above says which row it was folded from.
  const blank = emptyBubbles(messages);
  if (blank.length > 0) {
    log.warn('an assistant bubble folded to nothing renderable', {
      reason,
      conversationUuid,
      bubbles: blank,
      shape,
    });
  }

  if (isVerbose()) dumpHistory(reason, conversationUuid, items, messages);

  return { items, messages };
}

/**
 * The whole page, verbatim — every row as the backend sent it, then every bubble
 * as the screen will draw it. Debug builds only (see `lib/verbose.ts`).
 *
 * One line per row rather than one line for the page: a history page runs to tens
 * of kilobytes, and a single message that size crosses the bridge as one blob and
 * reads as none. Numbered `n/N` so a truncated capture is obvious.
 *
 * This is what answers "one answer came back as three": the rows carry no field
 * that groups them into a turn — no parent, no run uuid — so the only thing that
 * says which rows belong together is their order, and reading them side by side
 * is how you tell a genuine second reply from one turn stored in steps.
 */
function dumpHistory(
  reason: string,
  conversationUuid: string,
  items: readonly AIMessageRead[],
  messages: readonly ChatMessage[],
): void {
  log.info('verbatim dump — what the backend sent', {
    reason,
    conversationUuid,
    rows: items.length,
    bubbles: messages.length,
  });

  items.forEach((item, index) => {
    log.info(`wire row ${index + 1}/${items.length}`, {
      role: item.role,
      uuid: item.uuid,
      createdAt: item.created_at,
      name: item.name ?? null,
      toolCallId: item.tool_call_id ?? null,
      toolCalls: verbatim(item.tool_calls),
      siblingCount: item.sibling_count ?? null,
      attachments: verbatim(item.attachments),
      content: verbatim(item.content),
    });
  });

  messages.forEach((message, index) => {
    const common = { role: message.role, uuid: message.uuid ?? null, createdAt: message.createdAt };
    if (message.role === 'user') {
      log.info(`bubble ${index + 1}/${messages.length}`, {
        ...common,
        status: message.status,
        text: verbatim(message.text),
      });
      return;
    }
    log.info(`bubble ${index + 1}/${messages.length}`, {
      ...common,
      status: message.status,
      attachments: verbatim(message.attachments),
      parts: message.parts.map((part) =>
        part.type === 'text'
          ? { type: 'text', text: verbatim(part.text) }
          : { type: 'view', tool: part.toolName, args: verbatim(part.args) },
      ),
    });
  });
}

/**
 * Point the screen at a thread. `'new'` is an empty, immediately-ready thread
 * (a conversation is born from its first message — there is no "create empty
 * conversation" endpoint); a uuid goes loading → ready | error.
 */
export async function openThread(threadId: ThreadTarget): Promise<void> {
  // What the screen is being pointed at, and what it is being pointed away from.
  // Every other line of the entry sequence — the conversation, the model list,
  // the history page — is only readable against this one, and a thread that opens
  // while the previous one still has a run in flight is worth seeing on its own.
  const leaving = getState();
  log.info('opening a thread', {
    threadId,
    willLoadHistory: threadId !== 'new',
    leaving: leaving.conversationUuid ?? leaving.threadId,
    leavingMessages: leaving.messages.length,
    leavingRunInFlight: leaving.isRunning,
  });

  // The previous thread's run must stop driving this store. We do NOT cancel it
  // server-side: the user navigated away, they did not press stop, and killing
  // the run would throw away a reply the conversation will happily show later.
  teardownActiveRun();
  // Files staged for the thread we are leaving must not ride along into the new
  // one.
  clearComposerAttachments();
  // The company shown for an existing thread is that conversation's own, so a
  // switch drops it until the next record is read (the new-thread pick stays).
  setConversationCompany(null);
  // Sibling lists are per message uuid, and a uuid only means anything inside its
  // own conversation — carrying the cache across a switch would offer branches
  // that belong to the thread we just left.
  resetBranches();

  const generation = resetThread(threadId);
  if (threadId === 'new') return;

  // The host tracks the open conversation separately from its list so it can
  // restore it after a WebView render-process crash; only we know it changed.
  bridgeSend('thread.changed', { conversationUuid: threadId });
  // The title is a property of the conversation, not of its history, so a thread
  // opened from the list has to ask for it — otherwise the native header keeps
  // showing the default. Fire-and-forget: it never throws and never blocks the
  // transcript.
  void ensureTitle(threadId, { opening: true });

  setHistoryLoading();
  await load(threadId, generation, 'open-thread');
}

/** One message the caller expects to still be there once the reload lands. */
export type BranchExpectation = {
  /** What it is, in the log: `'edited question'`, `'new reply'`, `'selected version'`. */
  what: string;
  /** Its server uuid, or `undefined` when the caller never learned one. */
  uuid: string | undefined;
};

export type BranchReloadOptions = {
  /** Why the transcript is being re-read — printed on every line of this reload. */
  reason?: string;
  /** Messages whose fate is the diagnosis; see {@link BranchExpectation}. */
  expect?: BranchExpectation[];
};

/**
 * Re-read the transcript after the *active branch moved* (a select-branch, or a
 * run that landed on a new fork). Unlike {@link refreshOpenThread} this is not
 * silent about a live run — it is called at points where the branch the user is
 * looking at has genuinely changed and the cached list is now wrong.
 */
export async function reloadAfterBranchChange(options: BranchReloadOptions = {}): Promise<void> {
  const { reason = 'branch-change', expect = [] } = options;
  const { conversationUuid } = getState();
  if (!conversationUuid) return;
  const generation = currentGeneration();
  const before = getState().messages;
  try {
    const { items, messages } = await fetchHistory(conversationUuid, reason);
    if (isStale(generation)) return;

    // The whole point of the exercise: for every message the caller believes must
    // survive this reload, say where it ended up. `absent-from-history` is the
    // backend's answer, `dropped-locally` is ours — see `diagnostics.ts`.
    const expected = expect.map((entry) => ({
      what: entry.what,
      uuid: shortUuid(entry.uuid),
      verdict: verdictFor(entry.uuid, items, messages),
    }));
    const detail = {
      reason,
      conversationUuid,
      was: describeTranscript(before),
      now: describeTranscript(messages),
      endsWith: trailingRole(messages),
      expected,
    };
    if (expected.some((entry) => isMissing(entry.verdict))) {
      log.warn('the reloaded branch is missing a message this change created', detail);
    } else {
      log.info('transcript replaced after a branch change', detail);
    }

    // A queued message may have gone out while this was in flight; its bubble
    // and the reply streaming into it are not in this read, and replacing the
    // list would delete both. That run's own end re-reads nothing, but what is on
    // screen is at worst one fork-count behind.
    if (getState().isRunning) {
      log.info('skipped the branch reload — a new run started meanwhile', { reason });
      return;
    }
    setHistoryReady(messages);
  } catch (error) {
    if (isStale(generation) || isAbortError(error)) return;
    // Never blank a transcript over this: the switch itself succeeded server-side,
    // and what is on screen is at worst one branch behind.
    log.warn('branch reload failed', {
      conversationUuid,
      message: getErrorMessage(error, HISTORY_ERROR_FALLBACK),
    });
    throw error;
  }
}

/**
 * Pick up the files a finished run delivered.
 *
 * A delivered file is not part of the stream: `deliver_file` writes a row, and the
 * attachment only exists once the turn is stored. So the reply arrives with text
 * (and views) and the chip has to be fetched afterwards.
 *
 * Deliberately **not** a transcript replacement. It re-reads history, takes the
 * files off the last assistant turn and patches them onto the message that just
 * streamed — nothing else on screen is touched. A reload here could drop the very
 * reply it was meant to decorate if the backend has not persisted it yet, and a
 * missing chip is a far smaller loss than a missing answer.
 *
 * Only called for runs that actually used a tool: a plain question can produce no
 * file, and this costs a request.
 */
export async function syncDeliveredFiles(assistantId: string): Promise<void> {
  const { conversationUuid } = getState();
  if (!conversationUuid) return;
  const generation = currentGeneration();

  try {
    const { messages } = await fetchHistory(conversationUuid, 'after-run');
    if (isStale(generation)) return;

    const last = messages[messages.length - 1];
    if (!last || last.role !== 'assistant' || last.attachments.length === 0) return;

    log.info('the run delivered files', {
      conversationUuid,
      count: last.attachments.length,
      files: last.attachments.map(
        (file) => `${file.kind}:${file.contentType}${file.url ? '' : ' (no url yet)'}`,
      ),
    });
    updateAssistantMessage(assistantId, { attachments: last.attachments });
  } catch (error) {
    // Cosmetic: the answer is on screen, only the chip is missing, and reopening
    // the thread will show it.
    if (isStale(generation) || isAbortError(error)) return;
    log.warn('could not read the files this run delivered', {
      conversationUuid,
      message: getErrorMessage(error, 'Unknown error'),
    });
  }
}

/** Retry a failed history load, without re-running the whole thread switch. */
export async function retryHistory(): Promise<void> {
  const { conversationUuid } = getState();
  if (!conversationUuid) return;
  setHistoryLoading();
  await load(conversationUuid, currentGeneration(), 'retry');
}

/**
 * Re-fetch the open thread's history in place. Wired to the realtime reconnect
 * handler: publications sent while the socket was down are gone, so REST is
 * re-read as the source of truth (realtime is cache invalidation, not the source
 * of truth — see the native ai-assistant doc).
 *
 * Deliberately silent — no `loading` flip, so a reconnect does not blank a
 * transcript the user is reading, and a failed refresh only becomes a visible
 * error when there is nothing cached to fall back to.
 */
export async function refreshOpenThread(): Promise<void> {
  const { conversationUuid, isRunning } = getState();
  if (!conversationUuid) return;
  // A live run owns the last assistant message; replacing the list underneath it
  // would delete the reply mid-stream. The run's own terminal event reconciles.
  if (isRunning) return;

  const generation = currentGeneration();
  try {
    const { messages } = await fetchHistory(conversationUuid, 'refresh');
    if (isStale(generation)) return;
    setHistoryReady(messages);
  } catch (error) {
    if (isStale(generation) || isAbortError(error)) return;
    log.warn('history refresh failed', {
      conversationUuid,
      message: getErrorMessage(error, HISTORY_ERROR_FALLBACK),
    });
    // Only surface it when there is nothing cached behind it.
    if (getState().messages.length === 0) setHistoryError(error);
  }
}

/** How long to give the backend to store a reply before reading history again. */
const PERSIST_RETRY_MS = [600, 1500, 3000];

/**
 * Put the transcript right after a run this screen joined late (`recoverRuns`)
 * has finished — but never trade a reply on screen for a history without it.
 *
 * A joined stream only saw the tail of its reply, so history is the one place
 * the whole of it lives. The terminal event can reach us before the row it
 * announces is readable, though, and a blind replacement then swaps the reply
 * the user just watched land for a thread that ends at their question. So the
 * reply's own uuid (from `ai.run.completed`) is the condition: history replaces
 * the screen once it contains it, is re-read a few times until it does, and is
 * left alone if it never does — the next open will read it.
 */
export async function refreshAfterJoinedRun(replyUuid: string | undefined): Promise<void> {
  if (!replyUuid) {
    await refreshOpenThread();
    return;
  }
  const { conversationUuid } = getState();
  if (!conversationUuid) return;
  const generation = currentGeneration();

  for (let attempt = 0; attempt <= PERSIST_RETRY_MS.length; attempt += 1) {
    if (isStale(generation) || getState().isRunning) return;
    try {
      const { items, messages } = await fetchHistory(conversationUuid, 'after-joined-run');
      if (isStale(generation) || getState().isRunning) return;
      if (items.some((item) => item.uuid === replyUuid)) {
        setHistoryReady(messages);
        return;
      }
    } catch (error) {
      if (isStale(generation) || isAbortError(error)) return;
      log.warn('history read after a joined run failed', {
        conversationUuid,
        message: getErrorMessage(error, HISTORY_ERROR_FALLBACK),
      });
    }
    const delay = PERSIST_RETRY_MS[attempt];
    if (delay === undefined) break;
    await new Promise((resolve) => window.setTimeout(resolve, delay));
  }
  log.warn('the joined reply is not in history yet — keeping what streamed', {
    conversationUuid,
    replyUuid: shortUuid(replyUuid),
  });
}

/** The shared loading → ready | error body of `openThread` and `retryHistory`. */
async function load(conversationUuid: string, generation: number, reason: string): Promise<void> {
  try {
    const { messages } = await fetchHistory(conversationUuid, reason);
    // The user switched threads while this was in flight: the response belongs
    // to a thread that is no longer on screen.
    if (isStale(generation)) return;
    setHistoryReady(messages);
    // History is the conversation as stored; a reply still being written, or one
    // waiting on an approval, is not in it yet. Join those now.
    void recoverRuns(reason);
  } catch (error) {
    if (isStale(generation)) return;
    // A cancelled request is cooperative, not a failure; whatever cancelled it
    // has already reset the store.
    if (isAbortError(error)) return;
    log.error('history load failed', {
      conversationUuid,
      message: getErrorMessage(error, HISTORY_ERROR_FALLBACK),
    });
    // Never fall through to an empty `ready` thread: the screen must show
    // ErrorState + retry, not the greeting.
    setHistoryError(error);
  }
}
