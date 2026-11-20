/**
 * The chat store: one open thread, held in a module-level snapshot and read
 * through `useSyncExternalStore`.
 *
 * This is the state layer assistant-ui used to provide in the native app
 * (`@assistant-ui/react-native`'s local runtime + remote thread list). The web
 * app has no runtime, so the pieces that were spread across the native
 * `realtime/` folder — `historyLoadStatus`, `firstSendStatus`, the optimistic
 * message repository — collapse into this single snapshot:
 *
 *   - `historyStatus` replaces `historyLoadStatus.ts`. A failed history load is
 *     `'error'`, never an empty `'ready'` thread: the native bug this guards
 *     against was a load error masquerading as the "How can I help?" greeting.
 *   - A failed first send lives on the optimistic user message (`status:
 *     'failed'`) instead of `firstSendStatus.ts`. In the native app the create
 *     POST ran inside `initialize()`, *before* the user message existed, so the
 *     error had nowhere to live; here we append the message first, so it does.
 *
 * There is exactly one thread on screen (the native host owns the chat list and
 * tells us which one to open), so a single slot is enough — the same reasoning
 * the native one-slot stores documented.
 */
import type { ThreadTarget } from '@/bridge/protocol';
import type { AgentRef } from '@/lib/api/types';
import type {
  AssistantMessage,
  ChatAttachment,
  ChatMessage,
  ChatState,
  MessagePart,
  UserMessage,
} from './types';

/* ---------------------------------------------------------------- */
/* Ids                                                               */
/* ---------------------------------------------------------------- */

let idCounter = 0;

/**
 * Local message ids. Deliberately not `crypto.randomUUID()`: it is only defined
 * in a secure context, and the bundle can be served to the WebView from
 * `file://`, where it is `undefined` and would throw on the first send. A
 * counter cannot fail and only has to be unique within one page load.
 */
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

/* ---------------------------------------------------------------- */
/* Snapshot                                                          */
/* ---------------------------------------------------------------- */

function emptyState(threadId: ThreadTarget): ChatState {
  return {
    threadId,
    conversationUuid: threadId === 'new' ? null : threadId,
    title: null,
    agent: null,
    messages: [],
    // A brand-new thread has nothing to fetch, so it is ready immediately; an
    // existing one is flipped to 'loading' by `openThread`.
    historyStatus: threadId === 'new' ? 'ready' : 'loading',
    historyError: null,
    isRunning: false,
  };
}

let state: ChatState = emptyState('new');
const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The current snapshot. Every mutation replaces the object, so this doubles as
 * `getSnapshot` for `useSyncExternalStore` — React compares by reference, so an
 * unchanged store never re-renders.
 */
export function getState(): ChatState {
  return state;
}

function commit(patch: Partial<ChatState>): void {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener();
}

/* ---------------------------------------------------------------- */
/* Staleness guard                                                   */
/* ---------------------------------------------------------------- */

let generation = 0;

/**
 * Bumped on every thread switch. Any async work (history fetch, send, stream)
 * captures the generation it started in and drops its result if it no longer
 * matches — otherwise a slow history response, or a stream chunk from the run
 * we just navigated away from, lands in the thread the user is now looking at.
 * That is the native "old-chat jump" bug (`chatContent.hooks.ts`), which the
 * native app could only paper over with a skeleton because one runtime was
 * shared across every thread.
 */
export function bumpGeneration(): number {
  generation += 1;
  return generation;
}

export function currentGeneration(): number {
  return generation;
}

export function isStale(captured: number): boolean {
  return captured !== generation;
}

/* ---------------------------------------------------------------- */
/* Thread mutations                                                  */
/* ---------------------------------------------------------------- */

/**
 * Drop everything and start on `threadId`. Clearing `messages` here is what
 * stops the previous conversation from showing for a frame while the new one
 * loads — the screen renders the history skeleton instead.
 */
export function resetThread(threadId: ThreadTarget): number {
  state = emptyState(threadId);
  for (const listener of [...listeners]) listener();
  return bumpGeneration();
}

export function setHistoryLoading(): void {
  commit({ historyStatus: 'loading', historyError: null });
}

/** A load failure keeps the error so the screen can render ErrorState + retry. */
export function setHistoryError(error: unknown): void {
  commit({ historyStatus: 'error', historyError: error });
}

export function setHistoryReady(messages: ChatMessage[]): void {
  commit({ historyStatus: 'ready', historyError: null, messages });
}

export function setConversationUuid(conversationUuid: string): void {
  commit({ conversationUuid, threadId: conversationUuid });
}

export function setTitle(title: string): void {
  commit({ title });
}

export function setAgent(agent: AgentRef | null): void {
  if (state.agent?.uuid === agent?.uuid && state.agent?.name === agent?.name) return;
  commit({ agent });
}

export function setRunning(isRunning: boolean): void {
  if (state.isRunning === isRunning) return;
  commit({ isRunning });
}

/* ---------------------------------------------------------------- */
/* Message mutations                                                 */
/* ---------------------------------------------------------------- */

export function setMessages(messages: ChatMessage[]): void {
  commit({ messages });
}

export function appendMessages(...messages: ChatMessage[]): void {
  commit({ messages: [...state.messages, ...messages] });
}

/**
 * Drop everything **after** `messageId`, keeping the message itself.
 *
 * Editing a past turn forks a new branch: everything below the edited message
 * belonged to the branch that was just left, and leaving it on screen under a
 * question that no longer says the same thing is the one outcome an edit must
 * not produce. An unknown id changes nothing rather than clearing the transcript.
 */
export function truncateAfter(messageId: string): void {
  const index = state.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return;
  commit({ messages: state.messages.slice(0, index + 1) });
}

export function removeMessages(ids: readonly string[]): void {
  const drop = new Set(ids);
  commit({ messages: state.messages.filter((message) => !drop.has(message.id)) });
}

/**
 * The two updaters are split by role rather than taking one
 * `Partial<ChatMessage>` so the discriminated union stays sound — a patch can
 * never move a message between roles or put `parts` on a user message.
 */
export function updateUserMessage(
  id: string,
  patch: Partial<Omit<UserMessage, 'id' | 'role'>>,
): void {
  commit({
    messages: state.messages.map((message) =>
      message.id === id && message.role === 'user' ? { ...message, ...patch } : message,
    ),
  });
}

export function updateAssistantMessage(
  id: string,
  patch: Partial<Omit<AssistantMessage, 'id' | 'role'>>,
): void {
  commit({
    messages: state.messages.map((message) =>
      message.id === id && message.role === 'assistant' ? { ...message, ...patch } : message,
    ),
  });
}

/* ---------------------------------------------------------------- */
/* Factories                                                         */
/* ---------------------------------------------------------------- */

export function createUserMessage(text: string, attachments: ChatAttachment[]): UserMessage {
  return {
    id: nextId('user'),
    role: 'user',
    text,
    attachments,
    createdAt: new Date().toISOString(),
    status: 'sending',
  };
}

/**
 * The placeholder that carries the reply. It is appended together with the user
 * message, *before* the POST, because the typing indicator, the stream, a send
 * failure and a cancel all need somewhere to live — in the native app a failed
 * first send had no assistant message yet, which is exactly why it needed its
 * own store (`firstSendStatus.ts`).
 */
export function createAssistantMessage(): AssistantMessage {
  return {
    id: nextId('assistant'),
    role: 'assistant',
    parts: [],
    attachments: [],
    createdAt: new Date().toISOString(),
    status: 'streaming',
  };
}

/* ---------------------------------------------------------------- */
/* Selectors used by the action layer                                */
/* ---------------------------------------------------------------- */

export function lastUserMessage(): UserMessage | null {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const message = state.messages[i];
    if (message.role === 'user') return message;
  }
  return null;
}

export function lastAssistantMessage(): AssistantMessage | null {
  for (let i = state.messages.length - 1; i >= 0; i -= 1) {
    const message = state.messages[i];
    if (message.role === 'assistant') return message;
  }
  return null;
}

/** True when a turn produced anything renderable — text or a generative block. */
export function hasContent(parts: readonly MessagePart[]): boolean {
  return parts.some((part) => (part.type === 'text' ? part.text.trim().length > 0 : true));
}
