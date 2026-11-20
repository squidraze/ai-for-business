/**
 * The fake Centrifugo socket and the fake AI run that streams over it.
 *
 * DEV ONLY. Reached only from `src/dev/mockBackend.ts`.
 *
 * The contract this file has to satisfy is `src/realtime/aiEvents.ts`, which is
 * *not* modified for the harness. Concretely:
 *
 *  - the AI channel is a **server-side** subscription, so it is announced in the
 *    `connect` reply's `subs` map, never through a `subscribe` command;
 *  - publications reach the client as `{ push: { channel, pub: { data } } }`,
 *    which Centrifuge re-emits as the client-level `publication` event that
 *    `streamAiRun` filters by `ctx.channel`;
 *  - every event is the envelope `{ conversation_uuid, run_uuid, seq, event_type,
 *    data }`. `run_uuid` is the demux key and `seq` is a per-run counter that
 *    increases by exactly one — a hole makes `streamAiRun` log a gap warning, so
 *    it is stamped when the event is *published*, not when it is scheduled;
 *  - a run streams `ai.run.started` → deltas → exactly one terminal event.
 *
 * The connect reply deliberately carries no `ping` field: Centrifuge only arms
 * its no-ping watchdog when the server advertises one, and a mock that never
 * pings would otherwise be disconnected after ~10s.
 */

import type { AIRunRead, AllowScope, PendingActionRead, ResumeRequest } from '@/lib/api/types';

export const MOCK_WS_URL = 'ws://mock.localhost/connection/websocket';

/** Cadence of the fake stream: slow enough to watch, fast enough to iterate. */
const TOKEN_INTERVAL_MS = 60;
const TOKEN_CHUNK_CHARS = 14;

/* ------------------------------------------------------------------ */
/* What the next run does                                              */
/* ------------------------------------------------------------------ */

/**
 * The states a developer has to be able to see with no backend. Cycled from the
 * DEV panel; a slash command in the message overrides it for that one send.
 */
export type RunMode =
  | 'stream'
  | 'error'
  | 'cancel'
  | 'hitl'
  | 'thinking'
  | 'delegate'
  | 'auto'
  | 'slow'
  | 'work';

export const RUN_MODES: readonly RunMode[] = [
  'stream',
  'error',
  'cancel',
  'hitl',
  'thinking',
  'delegate',
  'auto',
  'slow',
  'work',
];

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  stream: 'streams a reply',
  error: 'ends in ai.run.error',
  cancel: 'is cancelled mid-stream',
  hitl: 'pauses for approval',
  thinking: 'thinks first (ai.reasoning)',
  delegate: 'delegates to a subagent',
  auto: 'runs an allowed tool without a card',
  slow: 'streams slowly (reopen the thread to rejoin it)',
  work: 'plans, then calls three tools (one fails)',
};

let runMode: RunMode = 'stream';

export const getRunMode = (): RunMode => runMode;

export function setRunMode(mode: RunMode): void {
  runMode = mode;
}

export function cycleRunMode(): RunMode {
  runMode = RUN_MODES[(RUN_MODES.indexOf(runMode) + 1) % RUN_MODES.length];
  return runMode;
}

/* ------------------------------------------------------------------ */
/* The socket                                                          */
/* ------------------------------------------------------------------ */

type MessageHandler = ((event: { data: string }) => void) | null;

let liveSocket: MockCentrifugoSocket | null = null;
/** Frames published before the socket connected — replayed on connect. */
const pendingFrames: unknown[] = [];
let aiChannel = 'ai:user-mock';

export function setAiChannel(channel: string): void {
  aiChannel = channel;
}

export const getAiChannel = (): string => aiChannel;

/** Indirection so the socket never has to alias `this` into module scope. */
function adoptSocket(socket: MockCentrifugoSocket): void {
  liveSocket = socket;
  for (const frame of pendingFrames.splice(0)) socket.deliver(frame);
}

/** Only the surface `WebsocketTransport` in `centrifuge` touches. */
export class MockCentrifugoSocket {
  onopen: (() => void) | null = null;
  onmessage: MessageHandler = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  binaryType = 'blob';
  readyState = 0;

  constructor() {
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    }, 10);
  }

  send(data: string): void {
    for (const line of data.trim().split('\n')) {
      let command: Record<string, unknown>;
      try {
        command = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      // `{}` is a pong. Nothing to answer.
      if (Object.keys(command).length === 0) continue;

      if (command.connect) {
        // Server-side subscriptions ride in the connect reply, exactly as
        // Centrifugo does for the channels carried by the connection token.
        this.deliver({
          id: command.id,
          connect: {
            client: 'mock-client',
            version: 'mock',
            session: 'mock-session',
            node: 'mock-node',
            subs: { [aiChannel]: {} },
          },
        });
        adoptSocket(this);
        continue;
      }
      // subscribe / rpc / anything else: an empty successful reply.
      if (typeof command.id === 'number') this.deliver({ id: command.id });
    }
  }

  close(): void {
    this.readyState = 3;
    if (liveSocket === this) liveSocket = null;
    this.onclose?.({ code: 3000, reason: 'mock close' });
  }

  deliver(reply: unknown): void {
    setTimeout(() => this.onmessage?.({ data: JSON.stringify(reply) }), 0);
  }
}

function publish(data: unknown): void {
  const frame = { push: { channel: aiChannel, pub: { data } } };
  if (liveSocket) liveSocket.deliver(frame);
  else pendingFrames.push(frame);
}

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

interface LiveRun {
  conversationUuid: string;
  runUuid: string;
  /** Per-run counter stamped at publish time so `seq` is always contiguous. */
  seq: number;
  /** Cumulative schedule offset, in ms, for the events still being queued. */
  at: number;
  timers: number[];
  /** Characters streamed so far — reported by `ai.run.cancelled`. */
  chars: number;
  /** Text streamed so far — handed to `onSettled` and to the cancel reporter. */
  text: string;
  /** True between `ai.action.pending` and the resume that follows it. */
  awaitingApproval: boolean;
  /** The rest of the reply, held back until the human approves. */
  remainder: string;
  /** The open approval, as `GET …/pending` reports it — `null` when there is none. */
  pending: {
    uuid: string;
    status: 'pending' | 'resolving';
    actions: unknown;
    allowOptions: Record<string, AllowScope[]>;
    /** `/hitl downgrade`: record `session` whatever was asked for. */
    downgrade: boolean;
    /** `/hitl stuck`: accept the decision and never continue — a stranded row. */
    stuck: boolean;
  } | null;
  /** Called with the final text once the run completes normally. */
  onSettled: ((text: string, delegation?: SettledDelegation, calls?: SettledCall[]) => void) | null;
}

const runs = new Map<string, LiveRun>();

export const hasLiveRun = (): boolean => runs.size > 0;

/** The conversation whose run is live, if any — the DEV panel targets it. */
export const liveRunConversation = (): string | null => {
  const [first] = runs.keys();
  return first ?? null;
};

const REPLY =
  'Here is what I can see right now.\n\n' +
  'You have **3 unread Telegram chats** and **2 new emails** that look important.\n\n' +
  '- **Anna (Telegram)** asks whether the contract can be signed by Friday.\n' +
  '- **Team chat (Telegram)** — 12 new messages, mostly about the Monday release.\n' +
  '- **billing@acme.com (Gmail)** — invoice #1042 is due in 3 days.\n\n' +
  'Nothing is urgent. Ask me to reply to Anna and I will draft the message.';

const HITL_INTRO =
  'I can tell **Anna** on Telegram that the contract will be signed on Friday. Here is the ' +
  'action I want to take — approve it and I will send it.\n\n';

const HITL_TAIL =
  '\n\nDone — Anna got the message and the reply email to billing@acme.com was sent.';

const ERROR_INTRO = 'Let me pull that up for you. Checking your inbox';

/**
 * What a thinking model writes before it answers — deltas on `ai.reasoning`,
 * always ahead of the first `ai.token`.
 *
 * Long on purpose: the trace under the typing dots only shows its tail, and the
 * bug it guards against is a block that grows down the screen instead.
 */
const REASONING =
  'The question is about a single load, so the load board is the right source rather than the ' +
  'analytics cards. I should check the current position first, then the planned arrival, and ' +
  'compare the two before saying anything about the ETA. If it is running ahead I should say ' +
  'by how much, and offer to notify the customer rather than doing it unasked.';

/** The delegation the model announces before it hands work to a subagent. */
const DELEGATE_INTRO =
  'That is a spreadsheet rather than a table on screen — I will have the sandbox build it.\n\n';

const DELEGATE_TAIL =
  '\n\nThe report is ready: 42 work orders across 6 drivers, one sheet per driver plus a totals ' +
  'row.';

const DELEGATE_ARGS = {
  subagent_type: 'code-runner',
  description: 'Build an xlsx report of August work orders, one sheet per driver',
};

const CANCEL_INTRO =
  'Pulling the full history for this lane. There are quite a few stops, so this may take a ' +
  'moment while I read through them';

function emit(run: LiveRun, delay: number, eventType: string, data: unknown): void {
  run.at += delay;
  run.timers.push(
    window.setTimeout(() => {
      publish({
        conversation_uuid: run.conversationUuid,
        run_uuid: run.runUuid,
        seq: run.seq++,
        event_type: eventType,
        data,
      });
    }, run.at),
  );
}

/** Queue `text` as `ai.token` deltas at the stream cadence. */
function emitTokens(run: LiveRun, text: string): void {
  for (let i = 0; i < text.length; i += TOKEN_CHUNK_CHARS) {
    const delta = text.slice(i, i + TOKEN_CHUNK_CHARS);
    run.chars += delta.length;
    run.text += delta;
    emit(run, TOKEN_INTERVAL_MS, 'ai.token', { delta });
  }
}

/**
 * Queue `text` as `ai.reasoning` deltas.
 *
 * Deliberately *not* counted into `run.text` or `run.chars`: the thinking is
 * live-only and never part of the stored reply, so a mock that folded it into
 * the final `content` would hide exactly the bug this event can cause.
 */
function emitReasoning(run: LiveRun, text: string): void {
  for (let i = 0; i < text.length; i += TOKEN_CHUNK_CHARS) {
    emit(run, TOKEN_INTERVAL_MS, 'ai.reasoning', { delta: text.slice(i, i + TOKEN_CHUNK_CHARS) });
  }
}

function clearRun(run: LiveRun): void {
  for (const timer of run.timers) window.clearTimeout(timer);
  run.timers.length = 0;
  runs.delete(run.conversationUuid);
}

/** A slash command in the message wins over the panel's setting, for that send. */
function modeFor(prompt: string): { mode: RunMode; tool: string | null } {
  const text = prompt.trim();
  const tool = /^\/tool\s+(\S+)/.exec(text);
  if (tool) return { mode: 'stream', tool: tool[1] };
  if (text.startsWith('/error')) return { mode: 'error', tool: null };
  if (text.startsWith('/cancel')) return { mode: 'cancel', tool: null };
  if (text.startsWith('/hitl') || text.startsWith('/approve')) return { mode: 'hitl', tool: null };
  if (text.startsWith('/think')) return { mode: 'thinking', tool: null };
  if (text.startsWith('/auto')) return { mode: 'auto', tool: null };
  if (text.startsWith('/slow')) return { mode: 'slow', tool: null };
  if (text.startsWith('/work')) return { mode: 'work', tool: null };
  // `/task` with no argument delegates and comes back; `/task hang` never sends
  // the result, which is how the hung-subagent case is reproduced on purpose.
  if (text.startsWith('/task') || text.startsWith('/delegate'))
    return { mode: 'delegate', tool: null };
  return { mode: runMode, tool: null };
}

/**
 * What a delegation left behind in the store, so a re-opened thread can be
 * rebuilt from rows rather than from the stream.
 *
 * `result: null` is the hung subagent — the call was stored, its answer never
 * was — which is what a reload has to show as an unfinished delegation.
 */
export interface SettledDelegation {
  callId: string;
  args: Record<string, string>;
  result: string | null;
}

/** One tool call a turn made, stored with its answer (`null` = it never answered). */
export interface SettledCall {
  callId: string;
  name: string;
  args: unknown;
  result: string | null;
}

export interface StartRunOptions {
  conversationUuid: string;
  runUuid: string;
  prompt: string;
  /** A brand-new conversation also gets an `ai.conversation.titled`. */
  fresh: boolean;
  /**
   * Store the assistant's reply so a re-open of the thread shows it. The second
   * argument is the trace the turn also has to leave behind — today only a
   * delegation, since that is the one tool call history is expected to redraw.
   */
  onSettled?: (text: string, delegation?: SettledDelegation, calls?: SettledCall[]) => void;
}

/** Schedule one whole run. Returns immediately — everything after is on timers. */
export function startRun(options: StartRunOptions): void {
  const { conversationUuid, runUuid, prompt, fresh, onSettled } = options;
  const existing = runs.get(conversationUuid);
  if (existing) clearRun(existing);

  const run: LiveRun = {
    conversationUuid,
    runUuid,
    seq: 0,
    at: 120,
    timers: [],
    chars: 0,
    text: '',
    awaitingApproval: false,
    remainder: '',
    pending: null,
    onSettled: onSettled ?? null,
  };
  runs.set(conversationUuid, run);

  const { mode, tool } = modeFor(prompt);
  emit(run, 0, 'ai.run.started', { model: 'gpt-4.1-mini' });

  if (mode === 'error') {
    emitTokens(run, ERROR_INTRO);
    emit(run, 500, 'ai.run.error', {
      message: 'The model provider returned 503. Please try again.',
    });
    run.timers.push(window.setTimeout(() => runs.delete(conversationUuid), run.at + 50));
    return;
  }

  if (mode === 'cancel') {
    emitTokens(run, CANCEL_INTRO);
    // The backend cancelling itself mid-stream — the same terminal event the
    // user's stop button produces, minus the POST.
    emit(run, 400, 'ai.run.cancelled', { chars: run.chars });
    run.timers.push(window.setTimeout(() => runs.delete(conversationUuid), run.at + 50));
    return;
  }

  if (mode === 'hitl') {
    emitTokens(run, HITL_INTRO);
    run.remainder = HITL_TAIL;
    run.awaitingApproval = true;
    const actions = [
      {
        tool: 'telegram_send_message',
        title: 'Send a Telegram message to Anna',
        description: '“Hi Anna, the contract will be signed on Friday.”',
      },
      {
        tool: 'gmail_reply',
        title: 'Reply to billing@acme.com',
        description: 'Replies in the invoice #1042 thread: “Thanks, it will be paid by Thursday.”',
      },
    ];
    // `/hitl session`: one tool on the card accepts only `session`, so the card
    // may offer that and not "Always allow". `/hitl none`: no standing approval.
    const allowOptions: Record<string, AllowScope[]> = prompt.includes('none')
      ? {}
      : prompt.includes('session')
        ? { telegram_send_message: ['session'], gmail_reply: ['session', 'always'] }
        : { telegram_send_message: ['session', 'always'], gmail_reply: ['session', 'always'] };
    // The gated call is announced before the pause, the way the backend does it,
    // so its card reads "Awaiting approval" until the decision lands.
    emit(run, 150, 'ai.tool_call', {
      tool: 'telegram_send_message',
      tool_call_id: `call-${runUuid}-gated`,
      args: { chat_id: 'Anna', text: 'Hi Anna, the contract will be signed on Friday.' },
    });
    run.pending = {
      uuid: `pending-${runUuid}`,
      status: 'pending',
      actions,
      allowOptions,
      downgrade: prompt.includes('downgrade'),
      stuck: prompt.includes('stuck'),
    };
    emit(run, 200, 'ai.action.pending', {
      pending_uuid: run.pending.uuid,
      actions,
      allow_options: allowOptions,
    });
    return;
  }

  if (mode === 'auto') {
    // The tool was allowed earlier, so it runs with no card — and the stream
    // says so with `ai.action.auto_approved`, between its call and its result.
    const callId = `call-${runUuid}`;
    emitTokens(run, 'Updating the ETA on **ST-4822** — you allowed that earlier.\n\n');
    emit(run, 200, 'ai.tool_call', {
      tool: 'update_load',
      tool_call_id: callId,
      args: { load: 'ST-4822', eta: 'Wed 11:10' },
    });
    emit(run, 150, 'ai.action.auto_approved', {
      tool: 'update_load',
      summary: 'Updated the ETA on ST-4822 to Wed 11:10',
      tool_call_id: callId,
    });
    emit(run, 300, 'ai.tool_result', { tool: 'update_load', tool_call_id: callId, content: 'ok' });
    emitTokens(run, 'Done — the load now shows **Wed 11:10**.');
    emit(run, 150, 'ai.run.completed', { message_uuid: `dev-msg-${runUuid}`, content: run.text });
    run.timers.push(
      window.setTimeout(() => {
        run.onSettled?.(run.text);
        runs.delete(conversationUuid);
      }, run.at + 50),
    );
    return;
  }

  if (mode === 'work') {
    // A multi-step turn: a plan ticked off as it goes, an analytics call, a
    // connected-app call and one that fails — the tool line and the task list,
    // live and (through `onSettled`) from history.
    const plan = (a: string, b: string, c: string) => [
      { content: 'Pull the fleet utilisation numbers', status: a },
      { content: 'Check the calendar for Friday', status: b },
      { content: 'Summarise what needs attention', status: c },
    ];
    const calls: SettledCall[] = [
      {
        callId: `call-${runUuid}-1`,
        name: 'run_analytics_chart',
        args: { chart: 'fleet_utilization_by_truck', truck_scope: 'active' },
        result: '<untrusted-data source="metabase">{"rows": 12, "idle_pct": 18}</untrusted-data>',
      },
      {
        callId: `call-${runUuid}-2`,
        name: 'run_connected_app_tool',
        args: { tool: 'google-calendar__list-events', arguments: { day: 'Friday' } },
        result: 'Two events on Friday: a 09:00 broker call and a 14:00 safety review.',
      },
      {
        callId: `call-${runUuid}-3`,
        name: 'run_analytics_chart',
        args: { chart: 'driver_fuel_usage' },
        result:
          "Chart 'driver_fuel_usage' failed to run: Client error '400 Bad Request'",
      },
    ];
    const finalPlan = plan('completed', 'completed', 'completed');

    emit(run, 100, 'ai.todos', { todos: plan('in_progress', 'pending', 'pending') });
    emitTokens(run, 'Let me check a few things first.\n\n');
    for (const [index, call] of calls.entries()) {
      emit(run, 250, 'ai.tool_call', { tool: call.name, tool_call_id: call.callId, args: call.args });
      emit(run, 900, 'ai.tool_result', {
        tool: call.name,
        tool_call_id: call.callId,
        content: call.result,
      });
      if (index === 0) {
        emit(run, 100, 'ai.todos', { todos: plan('completed', 'in_progress', 'pending') });
      }
    }
    emit(run, 100, 'ai.todos', { todos: plan('completed', 'completed', 'in_progress') });
    emitTokens(
      run,
      'Utilisation is **82%** across 12 active trucks, and Friday has a broker call at 09:00. ' +
        'The fuel chart did not load, so I left fuel out.',
    );
    emit(run, 100, 'ai.todos', { todos: finalPlan });
    emit(run, 150, 'ai.run.completed', { message_uuid: `dev-msg-${runUuid}`, content: run.text });
    run.timers.push(
      window.setTimeout(() => {
        run.onSettled?.(run.text, undefined, [
          { callId: `todos-${runUuid}`, name: 'write_todos', args: { todos: finalPlan }, result: 'ok' },
          ...calls,
        ]);
        runs.delete(conversationUuid);
      }, run.at + 50),
    );
    return;
  }

  if (mode === 'slow') {
    // Long and slow enough to leave the thread mid-reply and come back to it:
    // that is the "rejoin a run this screen did not start" path.
    const text = `${REPLY}\n\n${REPLY}`;
    for (let i = 0; i < text.length; i += TOKEN_CHUNK_CHARS) {
      const delta = text.slice(i, i + TOKEN_CHUNK_CHARS);
      run.chars += delta.length;
      run.text += delta;
      emit(run, 250, 'ai.token', { delta });
    }
    emit(run, 150, 'ai.run.completed', { message_uuid: `dev-msg-${runUuid}`, content: run.text });
    run.timers.push(
      window.setTimeout(() => {
        run.onSettled?.(run.text);
        runs.delete(conversationUuid);
      }, run.at + 50),
    );
    return;
  }

  if (mode === 'thinking') {
    // Thinking first, then the answer — the documented order. The dots and the
    // trace under them must both go on the first `ai.token`.
    emitReasoning(run, REASONING);
    emitTokens(run, REPLY);
    emit(run, 150, 'ai.run.completed', { message_uuid: `dev-msg-${runUuid}`, content: run.text });
    run.timers.push(
      window.setTimeout(() => {
        run.onSettled?.(run.text);
        runs.delete(conversationUuid);
      }, run.at + 50),
    );
    return;
  }

  if (mode === 'delegate') {
    const callId = `call-${runUuid}`;
    // A short thought first: a delegation is the turn most likely to have one,
    // and it exercises reasoning → text → card in a single run.
    emitReasoning(run, 'A spreadsheet means the sandbox, not a rendered table.');
    emitTokens(run, DELEGATE_INTRO);
    emit(run, 200, 'ai.tool_call', {
      tool: 'task',
      tool_call_id: callId,
      args: DELEGATE_ARGS,
    });
    // `/task hang`: the call goes out and nothing ever answers it — the backend's
    // own hung-subagent bug, and the case the client has to settle by itself.
    const result = 'Wrote /work/august-work-orders.xlsx (42 rows, 6 sheets).';
    if (!prompt.includes('hang')) {
      emit(run, 1800, 'ai.tool_result', { tool: 'task', tool_call_id: callId, content: result });
      emitTokens(run, DELEGATE_TAIL);
      emit(run, 150, 'ai.run.completed', { message_uuid: `dev-msg-${runUuid}`, content: run.text });
      run.timers.push(
        window.setTimeout(() => {
          run.onSettled?.(run.text, { callId, args: DELEGATE_ARGS, result });
          runs.delete(conversationUuid);
        }, run.at + 50),
      );
    }
    return;
  }

  const text = tool ? `Rendering \`${tool}\` for you.\n\n` : REPLY;
  emitTokens(run, text);

  if (tool) {
    emit(run, 200, 'ai.tool_call', { tool, args: { mock: true, prompt } });
    emit(run, 200, 'ai.tool_result', { tool, tool_call_id: `tc-${runUuid}`, content: 'ok' });
  }

  if (fresh) {
    emit(run, 100, 'ai.conversation.titled', { title: titleFor(prompt) });
  }

  emit(run, 150, 'ai.run.completed', { message_uuid: `dev-msg-${runUuid}`, content: run.text });
  run.timers.push(
    window.setTimeout(() => {
      run.onSettled?.(run.text);
      runs.delete(conversationUuid);
    }, run.at + 50),
  );
}

/** POST /cancel, and the DEV panel's "Cancel the live run". */
export function cancelRun(conversationUuid: string): boolean {
  const run = runs.get(conversationUuid);
  if (!run) return false;
  clearRun(run);
  publish({
    conversation_uuid: conversationUuid,
    run_uuid: run.runUuid,
    seq: run.seq,
    event_type: 'ai.run.cancelled',
    data: { chars: run.chars },
  });
  return true;
}

/** Cancel whatever run is live, whichever conversation it belongs to. */
export function cancelLiveRun(): boolean {
  const conversationUuid = liveRunConversation();
  return conversationUuid ? cancelRun(conversationUuid) : false;
}

/**
 * POST /resume. The run was never finished — it was paused on
 * `ai.action.pending` — so this continues the *same* run on the same channel,
 * which is what `streamAiRun` un-suspends its watchdog for.
 */
export function resumeRun(
  conversationUuid: string,
  decision: ResumeRequest['decision'],
  allow?: AllowScope,
): { allowed: Record<string, AllowScope> } | null {
  const run = runs.get(conversationUuid);
  if (!run || !run.awaitingApproval || run.pending?.status !== 'pending') return null;

  // What the backend records: the asked scope for every tool on the card that
  // accepts it — or `session` across the board on `/hitl downgrade`, which is
  // the "always came back as session" case the card has to report honestly.
  const allowed: Record<string, AllowScope> = {};
  if (decision === 'approve' && allow) {
    for (const [tool, scopes] of Object.entries(run.pending.allowOptions)) {
      const scope: AllowScope = run.pending.downgrade ? 'session' : allow;
      if (scopes.includes(scope)) allowed[tool] = scope;
    }
  }

  // `/hitl stuck`: the decision is accepted and the task that should resume the
  // run dies — the row sits in `resolving` until someone releases it.
  if (run.pending.stuck) {
    run.pending.status = 'resolving';
    run.pending.stuck = false;
    return { allowed };
  }

  run.pending = null;
  run.awaitingApproval = false;
  run.at = 0;
  run.timers.length = 0;

  emit(run, 150, 'ai.run.resumed', { decision });

  if (decision === 'reject') {
    const rejected = '\n\nUnderstood — I have not sent anything.';
    emitTokens(run, rejected);
  } else {
    // The resumed segment announces the gated call again — same id, no args —
    // exactly as the backend did on a device (2026-10-23). One card, not two.
    emit(run, 100, 'ai.tool_call', {
      tool: 'notify_customer',
      tool_call_id: `call-${run.runUuid}-gated`,
      args: null,
    });
    emit(run, 300, 'ai.tool_result', {
      tool: 'notify_customer',
      tool_call_id: `call-${run.runUuid}-gated`,
      content: 'SMS queued to +1 312 555 0142.',
    });
    emitTokens(run, run.remainder);
  }

  emit(run, 150, 'ai.run.completed', { message_uuid: `dev-msg-${run.runUuid}`, content: run.text });
  run.timers.push(
    window.setTimeout(() => {
      run.onSettled?.(run.text);
      runs.delete(conversationUuid);
    }, run.at + 50),
  );
  return { allowed };
}

/** POST …/release — a stranded `resolving` row goes back to `pending`. */
export function releaseRun(conversationUuid: string): boolean {
  const pending = runs.get(conversationUuid)?.pending;
  if (!pending || pending.status !== 'resolving') return false;
  pending.status = 'pending';
  return true;
}

/** GET …/runs — the live run, the way the backend lists it. */
export function listRuns(conversationUuid: string): AIRunRead[] {
  const run = runs.get(conversationUuid);
  if (!run) return [];
  return [
    {
      uuid: run.runUuid,
      status: run.awaitingApproval ? 'awaiting_approval' : 'running',
      model: 'gpt-4.1-mini',
      created_at: new Date().toISOString(),
    },
  ];
}

/** GET …/pending — the open approval, with no run uuid on it, as on the backend. */
export function listPendings(conversationUuid: string): PendingActionRead[] {
  const pending = runs.get(conversationUuid)?.pending;
  if (!pending) return [];
  return [
    {
      uuid: pending.uuid,
      status: pending.status,
      action: pending.actions,
      allow_options: pending.allowOptions,
    },
  ];
}

/** First line of the prompt, trimmed to something that reads like a title. */
function titleFor(prompt: string): string {
  const text = prompt.trim().split('\n')[0];
  if (!text) return 'New conversation';
  return text.length > 48 ? `${text.slice(0, 45)}...` : text;
}
