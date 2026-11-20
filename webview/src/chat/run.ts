/**
 * One turn: send → stream → terminal state.
 *
 * This is the port of the native `realtimeChatModel.ts`, minus assistant-ui. The
 * shape of a turn is unchanged and comes from the ai-assistant contract:
 *
 *   1. POST the text → `202 RunAcceptedResponse { conversation_uuid, run_uuid, channel }`.
 *   2. Stream `ai.*` events off that channel, replacing the assistant message's
 *      parts with each *cumulative* chunk.
 *   3. Stop on the terminal event — there is no `[DONE]` sentinel and the reply
 *      never comes back over HTTP.
 *
 * Two rules carried over verbatim, both bug history:
 *
 *   - **Nothing throws out of the send path.** Every failure becomes a message
 *     status. In the native app throwing escaped as an uncaught rejection
 *     because assistant-ui ran the model fire-and-forget; here it would take out
 *     the screen instead. Same fix: statuses, not exceptions.
 *   - **An abort is not a failure.** A user stop (or a thread switch tearing the
 *     run down) is cooperative. React Native reported it as a bare "Network
 *     Error", so the native code matched on the signal as well as the error —
 *     `isAbortError` does both here.
 *
 * The native first-send dance (`aiThreadListAdapter.initialize()` +
 * `takePreparedRun`) is gone: it existed only because assistant-ui awaited
 * `initialize()` before running the model, so the conversation had to be created
 * in a different place from the message. Here one function does both — a `null`
 * `conversationUuid` simply means "POST to the front door", which is what creates
 * the conversation.
 */
import { AxiosError } from 'axios';
import type { Centrifuge } from 'centrifuge';

import {
  clearComposerAttachments,
  outgoingAttachments,
  takeUploadedUuids,
} from '@/attachments/uploads';
import { send as bridgeSend } from '@/bridge/bridge';
import { buildDemoParts } from '@/generative/mockData';
import {
  cancelRun,
  editMessage,
  getConversation,
  listActiveRuns,
  listPendingActions,
  regenerateMessage,
  releasePending,
  resumePending,
  sendMessage as apiSendMessage,
  startMessage,
} from '@/lib/api/ai';
import { t } from '@/i18n';
import { getErrorMessage, isAbortError } from '@/lib/api/errors';
import type {
  AllowScope,
  PendingActionRead,
  ResumeAcceptedResponse,
  ResumeRequest,
  RunAcceptedResponse,
} from '@/lib/api/types';
import { logger } from '@/lib/logger';
import { isVerbose, verbatim } from '@/lib/verbose';
import {
  connectRealtime,
  getAiChannel,
  getRealtimeClient,
  HITL_PENDING_TOOL_NAME,
  streamAiRun,
  type HitlPendingArgs,
} from '@/realtime';

import { resetBranches } from './branches';
import { getPendingDisabledConnectors } from './connectors';
import {
  clearQueue,
  enqueueMessage,
  hasQueued,
  promoteQueuedMessage,
  removeQueuedMessage,
  takeNextQueued,
} from './queue';
import { shortUuid } from './diagnostics';
import { refreshAfterJoinedRun, reloadAfterBranchChange, syncDeliveredFiles } from './history';
import { getCompanyForNewThread, setConversationCompany } from './companies';
import {
  appendMessages,
  createAssistantMessage,
  createUserMessage,
  currentGeneration,
  getState,
  hasContent,
  isStale,
  lastAssistantMessage,
  lastUserMessage,
  removeMessages,
  setAgent,
  setConversationUuid,
  setRunning,
  setTitle,
  truncateAfter,
  updateAssistantMessage,
  updateUserMessage,
} from './store';
import type { AssistantMessage, ChatAttachment, MessagePart } from './types';

const log = logger.child('run');

// Functions, not constants: the text is looked up in the language active when
// the failure happens, not the one active when this module was imported.
const sendError = () => t('errors.sendFailed');
const aiReplyError = () => t('reply.failedMessage');
const resumeError = () => t('errors.resumeFailed');
const aiStalledError = () => t('reply.stalled');

/**
 * Dev-only generative-UI demo. Typing one of these (or tapping the demo chip)
 * renders one of every registered block from mock data — no backend, and no
 * `ai:user-<id>` channel grant needed, which is what makes it useful while that
 * grant is still the thing blocking the assistant end to end. Ported from the
 * native `DEMO_COMMANDS`; remove once the backend emits real `ai.tool_call`s.
 */
const DEMO_COMMANDS = new Set(['/ui', '/ui-demo', '/demo']);

/* ---------------------------------------------------------------- */
/* The in-flight runs                                                */
/* ---------------------------------------------------------------- */

type ActiveRun = {
  /** Local, unique, and the map key — a run has no `run_uuid` until it is accepted. */
  key: string;
  controller: AbortController;
  /** The thread generation this run belongs to; see `store.isStale`. */
  generation: number;
  /** The bubble that started it, or `null` for a regenerate (no new user turn). */
  userId: string | null;
  assistantId: string;
  /** `null` until the POST that creates the conversation is accepted. */
  conversationUuid: string | null;
  /** `null` until the `202`; the cancel endpoint names the run explicitly. */
  runUuid: string | null;
  /** Set by `stop()` only. A teardown abort is silent; a user stop is `stopped`. */
  stoppedByUser: boolean;
  /** Followed after the fact by `recoverRuns`, not started by a send here. */
  joined?: boolean;
};

/**
 * Every run this screen has in flight, keyed by {@link ActiveRun.key}.
 *
 * A **map, not a single slot**: a conversation can carry more than one run at
 * once (subagent fan-out, or a voice session sharing it), and a terminal event
 * ends *its* `run_uuid`, never the conversation. `isRunning` is therefore derived
 * from this map being non-empty rather than being flipped by whichever run
 * happened to finish last — that flag is what the composer's stop button and the
 * typing indicator read.
 *
 * The composer still refuses a second *send* while one is in flight (see
 * `sendMessage`). That is a product decision about this screen, not a limit the
 * API imposes any more.
 */
const activeRuns = new Map<string, ActiveRun>();
let runKeySequence = 0;

function nextRunKey(): string {
  runKeySequence += 1;
  return `run-${runKeySequence}`;
}

/** Add a run and republish `isRunning` from the set. */
function trackRun(run: ActiveRun): void {
  activeRuns.set(run.key, run);
  setRunning(activeRuns.size > 0);
}

/** Drop a run and republish `isRunning`. Idempotent — `stop()` may have got there first. */
function untrackRun(run: ActiveRun): void {
  if (activeRuns.get(run.key) !== run) return;
  activeRuns.delete(run.key);
  setRunning(activeRuns.size > 0);
  // The thread is free: whatever was written while the reply ran goes out now.
  if (activeRuns.size === 0) drainQueue();
}

/**
 * The uuids sent with the last turn. Kept because `takeUploadedUuids()` is
 * read-and-clear: without this a retry (or regenerate) of a send that carried
 * files would silently resend the text alone and drop the attachments.
 */
let lastTurnFileUuids: string[] = [];

/**
 * Stop the local run without telling the backend. Used when the thread changes:
 * the user navigated away, they did not press stop, so the run is left to finish
 * server-side and its reply is there next time the conversation is opened.
 */
export function teardownActiveRun(): void {
  const runs = [...activeRuns.values()];
  activeRuns.clear();
  setRunning(false);
  stopRecheck();
  // Nothing queued for the thread being left may go out into the next one.
  clearQueue();
  if (drainTimer !== undefined) window.clearTimeout(drainTimer);
  drainTimer = undefined;
  lastTurnFileUuids = [];
  for (const run of runs) run.controller.abort();
}

/**
 * Cancel the live run. Both halves are needed: the abort ends our stream at once
 * (so the UI settles immediately) and the POST stops the worker burning tokens.
 * Cancellation is cooperative on the backend — it answers with a terminal
 * `ai.run.cancelled`, which would end the stream on its own.
 */
export function stop(): void {
  // Every run this screen owns, not "the" run: the button means "stop what you
  // are doing", and with fan-out that can be more than one.
  for (const run of activeRuns.values()) {
    run.stoppedByUser = true;
    run.controller.abort();

    // No conversation or run uuid ⇒ the POST never came back, so there is nothing
    // named to cancel yet. `performTurn` catches up once the `202` lands.
    if (!run.conversationUuid || !run.runUuid) continue;
    cancelRun(run.conversationUuid, run.runUuid).catch((error: unknown) => {
      log.warn('cancel failed', describeError(error));
    });
  }
}

/* ---------------------------------------------------------------- */
/* Sending                                                           */
/* ---------------------------------------------------------------- */

/**
 * Send the composer's text, with whatever it has attached.
 *
 * The chips are read here rather than passed in, and that is the fix for a real
 * bug: they used to be an optional argument for the optimistic bubble, every
 * caller omitted it, and so every photo the user sent vanished the moment it
 * was sent — the bubble had no chips, and the upload response carries no
 * `download_url` to draw from either, so nothing came back until the thread was
 * reopened. A send cannot forget its own attachments.
 */
export async function sendMessage(text: string): Promise<void> {
  const content = text.trim();

  // Before anything clears the composer: these are the local previews the sent
  // bubble renders until a history load replaces them with presigned URLs.
  const attachments = outgoingAttachments();

  // **Text or a file** — the backend accepts a send whose `content` is empty as
  // long as `file_uuids` is not, and answers it with a generic "review the
  // attached file(s)" instruction to the model. So "here, look at this" with a
  // photo and no caption is a complete message, and no placeholder text is
  // invented here: the empty content is stored verbatim and the turn comes back
  // from history as an attachment with no caption. A send with neither is still
  // a 422, and is dropped before it gets that far.
  if (!content && attachments.length === 0) return;

  // The demo short-circuits before any network call — no POST, no realtime — so
  // it works against a backend that cannot stream yet. `import.meta.env.DEV` is
  // statically false in a production build, so the branch and `buildDemoParts`
  // are dropped by the bundler.
  if (import.meta.env.DEV && DEMO_COMMANDS.has(content.toLowerCase())) {
    log.info('rendering the generative-UI demo', { command: content });
    const demoUser = createUserMessage(content, attachments);
    const demoAssistant = createAssistantMessage();
    appendMessages(demoUser, demoAssistant);
    updateUserMessage(demoUser.id, { status: 'sent' });
    updateAssistantMessage(demoAssistant.id, {
      parts: buildDemoParts(),
      status: 'complete',
    });
    return;
  }

  // Collect the uploads *before* the request: `takeUploadedUuids` is
  // read-and-clear, and the uuids go into the request body itself.
  const fileUuids = takeUploadedUuids();
  // The composer's chips belong to the message now — sent or queued.
  clearComposerAttachments();

  // **A reply is still being written: queue, do not send.** A message sent now
  // would hang off the same parent as the reply in progress and fork the
  // conversation (see `queue.ts`). It goes out by itself once the reply is done.
  if (getState().isRunning) {
    enqueueMessage({ text: content, attachments, fileUuids });
    log.info('queued a message until the reply in progress is done', {
      chars: content.length,
      files: fileUuids.length,
      activeRuns: activeRuns.size,
    });
    return;
  }

  await sendPrepared(content, attachments, fileUuids);
}

/** The send itself, with the attachments already taken off the composer. */
async function sendPrepared(
  content: string,
  attachments: ChatAttachment[],
  fileUuids: string[],
): Promise<void> {
  lastTurnFileUuids = fileUuids;
  const user = createUserMessage(content, attachments);
  const assistant = createAssistantMessage();
  // Both go in before the POST: the empty assistant message is where the typing
  // indicator, the stream, a failure and a cancel all live.
  appendMessages(user, assistant);

  await performTurn(postTurn(content, fileUuids), user.id, assistant.id);
}

/* ---------------------------------------------------------------- */
/* The queue                                                         */
/* ---------------------------------------------------------------- */

/**
 * How long a "Send now" waits after the cancel. A run started the instant
 * another is cancelled can hang in `running` on the backend; about a second
 * later it goes through at normal speed (seen by the web client, 2026-09-29).
 */
const AFTER_CANCEL_DELAY_MS = 1000;

let drainTimer: number | undefined;

/**
 * Send the next queued message, once nothing is running. Called whenever the
 * last live run ends — a reply that completed, failed or was stopped alike.
 */
function drainQueue(): void {
  if (drainTimer !== undefined || activeRuns.size > 0 || !hasQueued()) return;
  const generation = currentGeneration();
  const next = takeNextQueued();
  if (!next) return;
  // A beat later rather than on this tick: the run that just ended is still
  // settling its own message, and a regenerate re-reads its branch right after.
  drainTimer = window.setTimeout(
    () => {
      drainTimer = undefined;
      if (isStale(generation)) return;
      const { message } = next;
      log.info('sending the next queued message', {
        afterCancel: next.afterCancel,
        files: message.fileUuids.length,
      });
      void sendPrepared(message.text, message.attachments, message.fileUuids);
    },
    next.afterCancel ? AFTER_CANCEL_DELAY_MS : 0,
  );
}

/** "Send now" on a queued message: it goes first, after the reply is stopped. */
export function sendQueuedNow(id: string): void {
  if (!promoteQueuedMessage(id)) return;
  if (activeRuns.size > 0) stop();
  else drainQueue();
}

export { removeQueuedMessage };

/**
 * Ask for a different answer to a question that was already asked.
 *
 * This is a real fork now, not a re-send. `POST .../regenerate` creates a
 * **sibling** of the target reply — same parent, new content — and the original
 * is never deleted, just no longer the branch you are looking at. Both are
 * reachable afterwards through the switcher (see `branches.ts`), which is why
 * the replaced reply is dropped from the transcript rather than kept above the
 * new one: the transcript shows one branch at a time.
 *
 * Two things follow from the endpoint's shape:
 *   - it is keyed by the **assistant** message, so a reply we have no server
 *     uuid for cannot be regenerated. That happens only for a turn that never
 *     landed (a failed send), and the fallback below re-sends the question
 *     instead — which is what the user meant by pressing it.
 *   - the `202` carries `message_uuid: null` (no row exists yet). The new
 *     reply's uuid arrives on `ai.run.completed`, and the sibling counts around
 *     it only settle on the history reload that follows the run.
 *
 * **It answers the reply that was pressed**, named by its local `messageId`.
 * Every reply has its own button, and taking "the last reply" instead used to
 * regenerate the bottom of the thread whichever one was tapped. An older reply is
 * forked exactly like the last one; what differs is the transcript — everything
 * below it belonged to the branch being left, so it is cut away with the reply,
 * the way an edit cuts below the question. With no id, the last reply is meant.
 */
export async function regenerate(messageId?: string): Promise<void> {
  if (getState().isRunning) return;
  const user = lastUserMessage();
  if (!user) return;

  const { conversationUuid, messages } = getState();
  const latest = lastAssistantMessage();
  const previous =
    messageId === undefined
      ? latest
      : messages.find(
          (message): message is AssistantMessage =>
            message.id === messageId && message.role === 'assistant',
        );
  if (messageId !== undefined && !previous) {
    log.warn('regenerate ignored — no such reply on screen', { messageId });
    return;
  }
  const isLatest = !previous || previous.id === latest?.id;
  const targetUuid = previous?.uuid;

  // The fallback below re-sends the *last* question, so it can only stand in for
  // the last reply. An older one without a uuid is a contract slip (it streamed,
  // and the terminal event never named it); re-sending the bottom question for it
  // would be exactly the bug this function was fixed for.
  if (!isLatest && !(conversationUuid && targetUuid)) {
    log.warn('regenerate ignored — an older reply with no server uuid', { messageId });
    return;
  }

  // Drop the reply we are replacing before anything else, so the transcript
  // never shows two assistant turns for one question — and, for an older reply,
  // everything under it, which is on the branch the fork leaves behind.
  if (previous) {
    if (!isLatest) truncateAfter(previous.id);
    removeMessages([previous.id]);
  }

  const assistant = createAssistantMessage();
  appendMessages(assistant);

  if (conversationUuid && targetUuid) {
    // A branch, on the server. The user bubble is untouched — it is not being
    // re-sent, and marking it 'sending' again would be a lie.
    await performTurn(
      (_conversationUuid, signal) => regenerateMessage(conversationUuid, targetUuid, signal),
      null,
      assistant.id,
    );
    // The fork the run just created is only visible once the branch-aware history
    // is re-read: that is where the new reply's uuid and the "n of N" around it
    // come from.
    await syncBranchesAfterRun('regenerate', { assistantId: assistant.id });
    return;
  }

  // No server-side reply to fork (the turn never landed). Re-send the question,
  // files included — this is the pre-branching behaviour, kept for exactly this
  // case rather than as the default.
  log.info('regenerating by re-sending — the reply has no server uuid yet');
  updateUserMessage(user.id, { status: 'sending', error: undefined });
  await performTurn(postTurn(user.text, lastTurnFileUuids), user.id, assistant.id);
}

/**
 * Replace a past user message with new text, and answer the new version.
 *
 * `POST .../edit` forks a sibling of the user turn — the original stays
 * reachable — and starts a run on it. Unlike regenerate it answers with a real
 * `message_uuid` straight away, because the edited message exists the moment the
 * call is accepted.
 *
 * Locally the transcript is cut back to this message before the run starts:
 * everything after it belonged to the branch that was just left, and leaving it
 * on screen under a question that no longer says the same thing is the one thing
 * this must not do.
 */
export async function editUserMessage(messageId: string, text: string): Promise<void> {
  const content = text.trim();
  if (!content) return;
  if (getState().isRunning) return;

  const { conversationUuid, messages } = getState();
  const target = messages.find((message) => message.id === messageId);
  if (!target || target.role !== 'user' || !target.uuid || !conversationUuid) {
    // Nothing to fork from: the message has no server identity yet.
    log.warn('edit ignored — the message has no server uuid', { messageId });
    return;
  }
  const targetUuid = target.uuid;

  // The new text, and nothing below it. `truncateAfter` keeps the message itself.
  updateUserMessage(messageId, { text: content, status: 'sending', error: undefined });
  truncateAfter(messageId);

  const assistant = createAssistantMessage();
  appendMessages(assistant);

  await performTurn(
    (_conversationUuid, signal) =>
      editMessage(conversationUuid, targetUuid, { content }, signal),
    messageId,
    assistant.id,
  );
  await syncBranchesAfterRun('edit', { userId: messageId, assistantId: assistant.id });
}

/**
 * Re-read the transcript once a fork has landed, so the switchers around it are
 * right. `sibling_count` is only computed by the history endpoint, and the run
 * that created the sibling cannot report the counts of its neighbours.
 *
 * Failure is deliberately swallowed: the fork itself succeeded, the reply is on
 * screen, and the only thing missing is an "n of N" — blanking a transcript over
 * that would be a far worse trade.
 *
 * **This reload is also where a fresh reply can vanish**, and that is why it is
 * instrumented rather than silent. What just streamed is on screen only as local
 * state; the reload replaces the whole list with whatever the history endpoint
 * says the active branch holds. If the new message has not been persisted yet, or
 * the conversation's pointer has not moved onto the fork, the answer the user
 * watched arrive is overwritten by a branch that does not contain it. The
 * expectations handed down here are what turn that into a log line naming the
 * owner — see `diagnostics.ts`.
 */
async function syncBranchesAfterRun(
  kind: 'regenerate' | 'edit',
  ids: { userId?: string; assistantId: string },
): Promise<void> {
  const before = getState().messages;
  const reply = before.find((message) => message.id === ids.assistantId);
  const question = ids.userId
    ? before.find((message) => message.id === ids.userId)
    : undefined;
  const chars =
    reply?.role === 'assistant'
      ? reply.parts.reduce(
          (total, part) => total + (part.type === 'text' ? part.text.length : 0),
          0,
        )
      : 0;

  log.info('re-reading the transcript after a fork', {
    kind,
    questionUuid: shortUuid(question?.uuid),
    replyUuid: shortUuid(reply?.uuid),
    replyStatus: reply?.role === 'assistant' ? reply.status : 'missing',
    replyChars: chars,
  });

  // Without a uuid the reply cannot be looked for in the response at all, so the
  // reload below can only be trusted, never checked. The uuid arrives on the
  // terminal `ai.run.completed`; a run that produced an answer and no uuid is
  // itself a contract problem worth seeing.
  if (!reply?.uuid && chars > 0) {
    log.warn('the reply that just streamed never learned a uuid', {
      kind,
      replyChars: chars,
    });
  }

  resetBranches();
  try {
    await reloadAfterBranchChange({
      reason: `after-${kind}`,
      expect: [
        ...(question ? [{ what: 'the forked question', uuid: question.uuid }] : []),
        { what: `the reply the ${kind} produced`, uuid: reply?.uuid },
      ],
    });
  } catch {
    // Already logged by `reloadAfterBranchChange`.
  }
}

/**
 * Retry a send that failed. This is the web replacement for the native
 * `firstSendStatus` / `ThreadFallback` flow: there, a failed first send left no
 * message at all (the create POST ran before the message existed), so the text
 * had to be stashed to be resendable. Here the failed message is still on
 * screen, so the retry just resends it in place.
 */
export async function retryLastSend(): Promise<void> {
  if (getState().isRunning) return;
  const user = lastUserMessage();
  if (!user || user.status !== 'failed') return;

  const previous = lastAssistantMessage();
  if (previous) removeMessages([previous.id]);

  const assistant = createAssistantMessage();
  appendMessages(assistant);
  updateUserMessage(user.id, { status: 'sending', error: undefined });

  await performTurn(postTurn(user.text, lastTurnFileUuids), user.id, assistant.id);
}

/* ---------------------------------------------------------------- */
/* The turn itself                                                   */
/* ---------------------------------------------------------------- */

type TurnRequest = (
  conversationUuid: string | null,
  signal: AbortSignal,
) => Promise<RunAcceptedResponse>;

/**
 * Run one turn: track it, POST it, stream it, settle it.
 *
 * The request is passed in rather than built here, because the four ways a turn
 * starts differ only in which endpoint they call — a first message, a message
 * into an existing conversation, a regenerate, an edit. Everything after the
 * `202` is identical, and used to be copied.
 *
 * `userId` is `null` for a regenerate: it produces no new user bubble, so there
 * is nothing to mark sent or failed.
 */
async function performTurn(
  request: TurnRequest,
  userId: string | null,
  assistantId: string,
): Promise<void> {
  const generation = currentGeneration();
  const controller = new AbortController();
  const run: ActiveRun = {
    key: nextRunKey(),
    controller,
    generation,
    userId,
    assistantId,
    conversationUuid: getState().conversationUuid,
    runUuid: null,
    stoppedByUser: false,
  };
  // Tracked before the POST rather than on acceptance, so the composer is locked
  // and `stop()` has something to abort during the accept window.
  trackRun(run);

  const isNewConversation = run.conversationUuid === null;

  try {
    let accepted: RunAcceptedResponse;
    try {
      accepted = await request(run.conversationUuid, controller.signal);
    } catch (error) {
      if (isStale(generation)) return;
      if (run.stoppedByUser || controller.signal.aborted || isAbortError(error)) {
        // Cooperative cancel during the accept window. Whether the POST landed is
        // unknown; the next history load reconciles. Nothing red is shown.
        log.info('send cancelled');
        if (userId) updateUserMessage(userId, { status: 'sent' });
        updateAssistantMessage(assistantId, { status: 'stopped' });
        return;
      }
      // The exact failure — network vs. HTTP status — is in here. This is the log
      // to read when the reply never starts.
      log.error('send failed', describeError(error));
      const message = getErrorMessage(error, sendError());
      if (userId) updateUserMessage(userId, { status: 'failed', error: message });
      updateAssistantMessage(assistantId, { status: 'error', error: message });
      return;
    }

    run.conversationUuid = accepted.conversation_uuid;
    run.runUuid = accepted.run_uuid;
    if (run.stoppedByUser) {
      // `stop()` fired while the POST was in flight: it aborted the request, but
      // the request had already reached the backend, and `stop()` had no run uuid
      // to name. Cancel now — otherwise the worker generates a whole reply that
      // nobody is listening to.
      cancelRun(accepted.conversation_uuid, accepted.run_uuid).catch((error: unknown) => {
        log.warn('late cancel failed', describeError(error));
      });
    }
    if (isStale(generation)) return;

    if (userId) {
      // The user bubble learns its server uuid here — that is what `edit` is keyed
      // by, so without it a message sent in this session could not be edited until
      // the thread was reopened. Regenerate answers `null` instead; that one is
      // about the reply, which learns its uuid from the terminal event.
      updateUserMessage(userId, {
        status: 'sent',
        error: undefined,
        ...(accepted.message_uuid ? { uuid: accepted.message_uuid } : {}),
      });
    }
    updateAssistantMessage(assistantId, { runUuid: accepted.run_uuid });

    if (isNewConversation) {
      // The conversation was just born from this message. The native side owns
      // the chat list and has no idea it exists until we say so.
      setConversationUuid(accepted.conversation_uuid);
      bridgeSend('thread.created', { conversationUuid: accepted.conversation_uuid });
      // The host tracks the open conversation separately from its list, so it can
      // restore it after a WebView render-process crash. It only ever learns the
      // open thread changed from us.
      bridgeSend('thread.changed', { conversationUuid: accepted.conversation_uuid });
    }

    log.info('run accepted', {
      conversationUuid: accepted.conversation_uuid,
      runUuid: accepted.run_uuid,
      channel: accepted.channel,
      createdConversation: accepted.created_conversation,
      activeRuns: activeRuns.size,
    });

    await streamTurn(run, accepted);
  } finally {
    untrackRun(run);
    // A conversation is auto-titled by the backend shortly after its first run.
    if (run.conversationUuid) void ensureTitle(run.conversationUuid);
  }
}

/**
 * The plain send: a first message through the front door, or a message into an
 * existing conversation.
 *
 * No `interrupt_previous`, and no 409 retry. The backend used to enforce one
 * active run per conversation and answer `409 { detail: { active_run_uuid } }`, so
 * a stale run that never emitted a terminal event could block the chat until it
 * was interrupted. A conversation can now hold several runs at once, so a send is
 * simply never rejected for one that is still in flight.
 */
function postTurn(content: string, fileUuids: string[]): TurnRequest {
  return (conversationUuid, signal) => {
    // While several companies are selected, the conversation this creates has
    // to name its owner (see chat/companies.ts); otherwise nothing is added.
    const company = getCompanyForNewThread();
    const files = fileUuids.length ? { file_uuids: fileUuids } : {};
    // The Connectors switches flipped before the conversation existed.
    const disabled = getPendingDisabledConnectors();

    return conversationUuid === null
      ? startMessage(
          {
            content,
            // No `model`: the backend picks its default (the model picker is gone).
            ...(company ? { company_uuid: company } : {}),
            ...(disabled.length > 0 ? { disabled_connectors: disabled } : {}),
            ...files,
          },
          signal,
        )
      : apiSendMessage(conversationUuid, { content, ...files }, signal);
  };
}

/**
 * Consume the run's events and settle the assistant message.
 *
 * Each chunk is **cumulative** — it replaces the parts rather than appending to
 * them — because the terminal `ai.run.completed` carries the authoritative full
 * text, which may differ from the concatenated deltas.
 */
async function streamTurn(run: ActiveRun, accepted: RunAcceptedResponse): Promise<void> {
  const { generation, assistantId, controller } = run;
  /** The run went silent instead of ending — see `AiRunChunk.timedOut`. */
  let stalled = false;
  /** The run used a tool, so it may have delivered a file — see `syncDeliveredFiles`. */
  let calledTools = false;

  try {
    // The socket is shared with the rest of the app and is normally already up;
    // connecting here covers a send that beats the initial handshake, which the
    // native app could only answer with "not ready yet, try again".
    const client = getRealtimeClient() ?? (await connectRealtime());

    for await (const chunk of streamAiRun(
      client,
      accepted.channel,
      accepted.run_uuid,
      controller.signal,
    )) {
      // The user switched threads mid-stream; this reply belongs to a thread that
      // is no longer on screen.
      if (isStale(generation)) return;
      if (chunk.timedOut) stalled = true;
      if (chunk.calledTools) calledTools = true;
      updateAssistantMessage(assistantId, {
        parts: chunk.parts,
        // The thinking, while the turn is still thinking. It rides beside the
        // parts rather than inside them because it is live-only — see
        // `AssistantMessage.reasoning`.
        ...(chunk.reasoning ? { reasoning: chunk.reasoning } : {}),
        // The reply's tool line and task list ride beside the parts, like the
        // thinking — see `AssistantMessage.toolCalls`.
        ...(chunk.toolCalls ? { toolCalls: chunk.toolCalls } : {}),
        ...(chunk.todos ? { todos: chunk.todos } : {}),
        // The terminal event is where a live reply learns its own uuid, and that
        // is what `regenerate` is keyed by — without adopting it here the answer
        // that just streamed could not be forked until the thread was reopened.
        ...(chunk.messageUuid ? { uuid: chunk.messageUuid } : {}),
      });
    }
  } catch (error) {
    if (isStale(generation)) return;
    if (run.stoppedByUser || controller.signal.aborted || isAbortError(error)) {
      // Stop is neutral, never an error — and whatever streamed so far stays.
      log.info('stream cancelled', { conversationUuid: accepted.conversation_uuid });
      updateAssistantMessage(assistantId, { status: 'stopped' });
      return;
    }
    // A terminal `ai.run.error` (or a genuine stream fault). Keep the partial
    // reply and put the error under it — losing what already streamed is worse
    // than showing an incomplete answer.
    log.error('stream failed', describeError(error));
    updateAssistantMessage(assistantId, {
      status: 'error',
      error: getErrorMessage(error, aiReplyError()),
    });
    return;
  }

  if (isStale(generation)) return;

  // Terminal state, in precedence order:
  //   stopped → a deliberate cancel, even if nothing streamed yet (calling that
  //             "empty" would blame the assistant for the user's tap);
  //   empty   → the run ended cleanly having produced nothing at all, which the
  //             screen must say out loud rather than render as a blank bubble;
  //   complete.
  const parts = assistantParts(assistantId);
  if (run.stoppedByUser) {
    updateAssistantMessage(assistantId, { status: 'stopped' });
    return;
  }
  if (!hasContent(parts)) {
    log.warn('run produced no content', { conversationUuid: accepted.conversation_uuid });
    updateAssistantMessage(assistantId, { status: 'empty' });
    return;
  }
  // The backend stopped publishing without a terminal event and something had
  // already streamed. Keep it — it is a real, if partial, answer — and say that it
  // was cut off: the run left nothing in history either, so silently calling this
  // `complete` leaves the user with half a sentence and no way to know.
  if (stalled) {
    log.warn('run stalled — keeping the partial reply and marking it interrupted', {
      conversationUuid: accepted.conversation_uuid,
      runUuid: accepted.run_uuid,
    });
    updateAssistantMessage(assistantId, { status: 'error', error: aiStalledError() });
    return;
  }
  updateAssistantMessage(assistantId, { status: 'complete' });
  log.info('run finished', { conversationUuid: accepted.conversation_uuid });

  // A file the turn built arrives on the stored message, never in the stream, so
  // the chip has to be fetched once the run is done. Fire-and-forget: it decorates
  // a reply that is already complete and must never hold it up or fail it.
  if (calledTools) void syncDeliveredFiles(assistantId);

  // The counterpart to the history dump: this is the reply as the *stream* built
  // it — one message, however many steps the model took. Compare it with the rows
  // the same turn comes back as on the next open, and the difference between what
  // was watched and what is replayed is on two adjacent lines.
  if (isVerbose()) {
    log.info('verbatim dump — the reply as it streamed', {
      runUuid: accepted.run_uuid,
      parts: parts.map((part) =>
        part.type === 'text'
          ? { type: 'text', text: verbatim(part.text) }
          : { type: 'view', tool: part.toolName },
      ),
    });
  }
}

/* ---------------------------------------------------------------- */
/* Human-in-the-loop                                                 */
/* ---------------------------------------------------------------- */

/**
 * Answer a gated action (`ai.action.pending`). The run is paused, not finished:
 * the backend resumes it on the same run and keeps publishing to the same
 * channel, so there is nothing to restart here.
 *
 * The decision names the paused action (`pendingUuid`): a conversation can hold
 * more than one gated action at a time, so there is no "the" open pending action
 * to resolve implicitly any more.
 *
 * `allow` makes the approval standing ("Always allow" / "Allow for this
 * session"); it counts only on an approve. The answer's `allowed` is what the
 * backend actually recorded — see `recordedScope`.
 *
 * **This one throws.** Unlike a send, it has a caller that owns the failure: the
 * card keeps its buttons, shows the error and offers the retry, because the run
 * is still waiting on exactly that card. Turning the failure into a message
 * status instead — which this used to do — left the card's own retry path dead
 * and marked the whole reply as failed over one button press.
 */
export async function resumeAction(
  pendingUuid: string,
  decision: ResumeRequest['decision'],
  options: { allow?: AllowScope; message?: string } = {},
): Promise<ResumeAcceptedResponse> {
  const { conversationUuid } = getState();
  if (!conversationUuid) {
    log.warn('resume ignored — no conversation', { pendingUuid });
    throw new Error(resumeError());
  }

  try {
    const accepted = await resumePending(conversationUuid, pendingUuid, {
      decision,
      ...(options.message ? { message: options.message } : {}),
      ...(decision === 'approve' && options.allow ? { allow: options.allow } : {}),
    });
    log.info('resumed a gated action', {
      conversationUuid,
      pendingUuid,
      decision,
      allow: options.allow ?? null,
      allowed: accepted.allowed ?? {},
    });
    return accepted;
  } catch (error) {
    log.error('resume failed', describeError(error));
    throw error;
  }
}

/**
 * Free a gated action stranded in `resolving` — its decision was accepted and the
 * task that should have resumed the run died. After this it can be answered
 * again. Throws, for the same reason as {@link resumeAction}.
 */
export async function releaseAction(pendingUuid: string): Promise<void> {
  const { conversationUuid } = getState();
  if (!conversationUuid) throw new Error(resumeError());
  try {
    await releasePending(conversationUuid, pendingUuid);
    log.info('released a stranded gated action', { conversationUuid, pendingUuid });
  } catch (error) {
    log.error('release failed', describeError(error));
    throw error;
  }
}

/* ---------------------------------------------------------------- */
/* Catching up: joining runs this screen did not start               */
/* ---------------------------------------------------------------- */

/**
 * How often a joined run is checked against `GET …/runs`. A joined run has no
 * `202` and may have had its terminal event published before the socket was
 * back, so the stream alone cannot be trusted to end; the backend's own list is.
 * The web client uses the same 10 s.
 */
const RECOVERY_RECHECK_MS = 10_000;

let recovering = false;
let recheckTimer: number | undefined;

/**
 * Join whatever the backend is still doing in the open conversation.
 *
 * A run is enqueued by a POST and finishes on a worker whether anyone listens or
 * not. Leaving the chat, backgrounding the app or a WebView crash does not stop
 * it — and its `run_uuid` and channel were only ever known from the `202`. So a
 * reopened conversation showed history as it stood *before* the reply, with no
 * stream and no stop button; and a run paused on an approval was worse, because
 * the card is drawn from the event and `resume` is keyed by a `pending_uuid` that
 * then had no other source.
 *
 * Two reads answer it: `GET …/runs` (live runs) and `GET …/pending` (open
 * approvals, with no run uuid on them). Pending actions are paired with
 * `awaiting_approval` runs in order, the way the web client does; one that finds
 * no run is followed by conversation instead (see `StreamJoinOptions`).
 *
 * **What it cannot recover is text that streamed before it joined.**
 * Publications are not replayed. A plain reply repairs itself from
 * `ai.run.completed.content`; any other is re-read from history when the joined
 * stream ends.
 *
 * Skipped while this screen already follows a run of its own — that run's events
 * are the truth, and joining it a second time would draw the reply twice.
 */
export async function recoverRuns(reason: string): Promise<void> {
  const { conversationUuid, historyStatus } = getState();
  if (!conversationUuid || historyStatus !== 'ready') return;
  if (activeRuns.size > 0 || recovering) return;

  const generation = currentGeneration();
  recovering = true;
  try {
    const [runs, pendings] = await Promise.all([
      listActiveRuns(conversationUuid),
      listPendingActions(conversationUuid),
    ]);
    if (isStale(generation) || activeRuns.size > 0) return;

    const running = runs.filter((run) => run.status === 'running');
    const paused = runs.filter((run) => run.status === 'awaiting_approval');
    const open = pendings.filter(
      (pending) => pending.status === 'pending' || pending.status === 'resolving',
    );

    if (running.length === 0 && open.length === 0) return;
    log.info('joining runs this screen did not start', {
      reason,
      conversationUuid,
      running: running.map((run) => shortUuid(run.uuid)),
      paused: paused.map((run) => shortUuid(run.uuid)),
      pending: open.map((pending) => `${shortUuid(pending.uuid)}:${pending.status}`),
    });

    const client = getRealtimeClient() ?? (await connectRealtime());
    const channel = getAiChannel();
    if (isStale(generation)) return;
    if (!channel) {
      log.warn('cannot join a run — the connection token granted no ai channel', {
        conversationUuid,
      });
      return;
    }

    // Approvals first: they are the ones a person can lose. Paired with paused
    // runs in order; the ones left over share one stream that adopts its run.
    const unpaired: PendingActionRead[] = [];
    open.forEach((pending, index) => {
      const run = paused[index];
      if (run) {
        void joinRun(client, channel, conversationUuid, run.uuid, [pending], generation);
      } else {
        unpaired.push(pending);
      }
    });
    if (unpaired.length > 0) {
      void joinRun(client, channel, conversationUuid, null, unpaired, generation);
    }
    for (const run of running) {
      void joinRun(client, channel, conversationUuid, run.uuid, [], generation);
    }
    scheduleRecheck(conversationUuid, generation);
  } catch (error) {
    // A catch-up that failed leaves the screen exactly as it was before this
    // existed — the history is on screen — so it is logged, never shown.
    if (!isStale(generation)) log.warn('could not check for live runs', describeError(error));
  } finally {
    recovering = false;
  }
}

/** The approval card a restored pending action is drawn as. */
function pendingCardPart(conversationUuid: string, pending: PendingActionRead): MessagePart {
  return {
    type: 'tool-call',
    toolCallId: `hitl-restored-${pending.uuid}`,
    toolName: HITL_PENDING_TOOL_NAME,
    args: {
      pendingUuid: pending.uuid,
      conversationUuid,
      actions: pending.action,
      allowOptions: pending.allow_options,
      status: pending.status,
    } satisfies HitlPendingArgs,
  };
}

/**
 * Follow one run this screen did not start, into a fresh assistant bubble at the
 * end of the thread. When it ends — however it ends — the transcript is re-read:
 * a joined stream only ever saw the tail of the reply, and history holds all of
 * it.
 */
async function joinRun(
  client: Centrifuge,
  channel: string,
  conversationUuid: string,
  runUuid: string | null,
  pendings: PendingActionRead[],
  generation: number,
): Promise<void> {
  if (isStale(generation)) return;
  const seedParts = pendings.map((pending) => pendingCardPart(conversationUuid, pending));
  const assistant = { ...createAssistantMessage(), parts: seedParts };
  appendMessages(assistant);

  const run: ActiveRun = {
    key: nextRunKey(),
    controller: new AbortController(),
    generation,
    userId: null,
    assistantId: assistant.id,
    conversationUuid,
    runUuid,
    stoppedByUser: false,
    joined: true,
  };
  trackRun(run);
  /** The reply's server uuid, from `ai.run.completed` — what the reload waits for. */
  let replyUuid: string | undefined;

  try {
    for await (const chunk of streamAiRun(client, channel, runUuid, run.controller.signal, {
      conversationUuid,
      startPaused: pendings.length > 0,
      seedParts,
    })) {
      if (isStale(generation)) return;
      // A stream that started by conversation learns its run here — and stop
      // needs it to name the run it cancels.
      if (chunk.runUuid) run.runUuid = chunk.runUuid;
      if (chunk.messageUuid) replyUuid = chunk.messageUuid;
      updateAssistantMessage(assistant.id, {
        parts: chunk.parts,
        ...(chunk.reasoning ? { reasoning: chunk.reasoning } : {}),
        ...(chunk.toolCalls ? { toolCalls: chunk.toolCalls } : {}),
        ...(chunk.todos ? { todos: chunk.todos } : {}),
        ...(chunk.messageUuid ? { uuid: chunk.messageUuid } : {}),
        ...(chunk.runUuid ? { runUuid: chunk.runUuid } : {}),
      });
    }
    if (isStale(generation)) return;
    updateAssistantMessage(assistant.id, { status: run.stoppedByUser ? 'stopped' : 'complete' });
  } catch (error) {
    if (isStale(generation)) return;
    if (run.stoppedByUser || run.controller.signal.aborted || isAbortError(error)) {
      updateAssistantMessage(assistant.id, { status: 'stopped' });
    } else {
      log.warn('a joined run ended in an error', describeError(error));
      updateAssistantMessage(assistant.id, {
        status: 'error',
        error: getErrorMessage(error, aiReplyError()),
      });
    }
  } finally {
    untrackRun(run);
  }

  // The last joined run to finish puts the whole transcript right. Earlier ones
  // leave it alone: `refreshOpenThread` refuses while any run is still live,
  // because replacing the list would delete the bubble that run is writing.
  if (!isStale(generation) && activeRuns.size === 0) {
    stopRecheck();
    await refreshAfterJoinedRun(replyUuid);
  }
}

function stopRecheck(): void {
  if (recheckTimer !== undefined) window.clearTimeout(recheckTimer);
  recheckTimer = undefined;
}

/**
 * While a joined run is live, ask the backend whether it still is. A run that
 * finished while the socket was down published its terminal event to nobody, so
 * its stream would wait out the 60 s watchdog — and a paused one has no watchdog
 * at all. A run the server no longer lists is ended here, and its stream's end
 * re-reads the transcript.
 */
function scheduleRecheck(conversationUuid: string, generation: number): void {
  stopRecheck();
  recheckTimer = window.setTimeout(() => {
    recheckTimer = undefined;
    void (async () => {
      const joined = [...activeRuns.values()].filter((run) => run.joined);
      if (isStale(generation) || joined.length === 0) return;
      try {
        const [runs, pendings] = await Promise.all([
          listActiveRuns(conversationUuid),
          listPendingActions(conversationUuid),
        ]);
        if (isStale(generation)) return;
        const live = new Set(runs.map((run) => run.uuid));
        const anyOpenPending = pendings.some(
          (pending) => pending.status === 'pending' || pending.status === 'resolving',
        );
        for (const run of joined) {
          // A run still waiting on its card is legitimately silent; one that
          // adopted no uuid yet can only be judged by its pending action.
          const gone = run.runUuid ? !live.has(run.runUuid) : !anyOpenPending;
          if (!gone) continue;
          log.info('a joined run is no longer live on the server — ending its stream', {
            runUuid: shortUuid(run.runUuid ?? undefined),
          });
          run.controller.abort();
        }
      } catch (error) {
        log.debug('joined-run recheck failed', describeError(error));
      }
      if (!isStale(generation) && [...activeRuns.values()].some((run) => run.joined)) {
        scheduleRecheck(conversationUuid, generation);
      }
    })();
  }, RECOVERY_RECHECK_MS);
}

/* ---------------------------------------------------------------- */
/* Title                                                             */
/* ---------------------------------------------------------------- */

/**
 * Conversations whose title we have already *successfully* read. The backend
 * publishes `ai.conversation.titled`, but the realtime layer does not surface it,
 * so the title is read over REST instead — at most one useful request per
 * conversation per session, which is the whole reason this set exists.
 *
 * Only a probe that came back with a title counts. The backend titles a
 * conversation shortly *after* its first run, so the probe that follows that run
 * usually answers "no title yet" — recording that as done is what left every
 * fresh conversation with the default header forever.
 */
const titleProbed = new Set<string>();

/**
 * Read a conversation's title, once. Exported because a conversation opened from
 * the native list needs this just as much as one that has just run a turn: its
 * title lives on the conversation, not in the message history.
 */
export async function ensureTitle(
  conversationUuid: string,
  options: { opening?: boolean } = {},
): Promise<void> {
  // Everything below asks about the conversation being probed, never about
  // whatever thread happens to be on screen — a switch mid-probe used to make
  // this skip, or write the title onto the wrong thread.
  const isOpen = (): boolean => getState().conversationUuid === conversationUuid;

  // Opening a thread always reads the record: besides the title it says which
  // custom agent the conversation is with, and that changes what the screen
  // offers (no starters, no voice). A post-run probe stays at most once.
  if (!options.opening) {
    if (isOpen() && getState().title) return;
    if (titleProbed.has(conversationUuid)) return;
  }

  try {
    const conversation = await getConversation(conversationUuid);
    if (isVerbose()) {
      log.info('verbatim dump — the conversation record', { raw: verbatim(conversation) });
    }
    // The conversation record itself, which is where the header's title comes
    // from, along with the model the backend picked. Neither is in the history
    // page, so without this line a wrong title or an unexpected model has no
    // trail at all. `title: null` here is normal right after the first run — the backend
    // writes it slightly later, which is why this probe is allowed to repeat.
    log.info('conversation read', {
      conversationUuid,
      hasTitle: Boolean(conversation.title),
      titleChars: (conversation.title ?? '').length,
      model: conversation.model ?? null,
      lastMessageAt: conversation.last_message_at ?? null,
      createdAt: conversation.created_at,
      updatedAt: conversation.updated_at,
      stillOpen: isOpen(),
    });
    // The conversation also knows which company owns it — the composer pill shows
    // it in place of a choice — but only while it is still the open one.
    if (isOpen()) {
      setConversationCompany(conversation.company);
      setAgent(conversation.agent?.uuid ? conversation.agent : null);
    }
    // No title yet: leave the conversation unprobed so a later run re-asks.
    if (!conversation.title) return;

    titleProbed.add(conversationUuid);
    // The native header and chat list both show this title and have no other way
    // to learn it changed. The message names its conversation, so it is worth
    // sending even if the user has since moved on.
    bridgeSend('thread.titled', { conversationUuid, title: conversation.title });
    if (isOpen()) setTitle(conversation.title);
  } catch (error) {
    // A missing title is cosmetic — never surface it. A failed request answered
    // nothing, so it is not a probe: the next run tries again.
    log.warn('could not read the conversation title', describeError(error));
  }
}

/* ---------------------------------------------------------------- */
/* Helpers                                                           */
/* ---------------------------------------------------------------- */

function assistantParts(assistantId: string): MessagePart[] {
  const message = getState().messages.find((candidate) => candidate.id === assistantId);
  return message && message.role === 'assistant' ? message.parts : [];
}

/**
 * Flatten an error into something loggable. The pieces that actually tell you
 * *why* are the axios ones: a missing `response` means the request never reached
 * the server (aborted, DNS/TLS, wrong host) rather than a 4xx/5xx from it, which
 * is the difference between "the backend rejected us" and "we never called it".
 */
function describeError(error: unknown): Record<string, unknown> {
  const base = {
    name: error instanceof Error ? error.name : typeof error,
    message: getErrorMessage(error, 'Unknown error'),
  };
  if (!(error instanceof AxiosError)) return base;
  // Deliberately no response body: these logs cross the bridge into the native
  // log file and Sentry breadcrumbs, and an AI response body is the last thing
  // that belongs there. Status, code, method and url are what a diagnosis needs.
  return {
    ...base,
    code: error.code,
    httpStatus: error.response?.status,
    method: error.config?.method,
    url: error.config?.url,
    aborted: error.config?.signal?.aborted === true,
  };
}
