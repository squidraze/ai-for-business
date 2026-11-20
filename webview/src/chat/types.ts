import type { ThreadTarget } from '@/bridge/protocol';
import type { AgentRef } from '@/lib/api/types';

/* ---------------------------------------------------------------- */
/* Message content                                                   */
/* ---------------------------------------------------------------- */

export type TextPart = { type: 'text'; text: string };

/**
 * A generative-UI block. `args` arrive complete in one event, so a part is
 * never half-written; the registry decides what (if anything) to draw.
 */
export type ToolCallPart = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: unknown;
};

export type MessagePart = TextPart | ToolCallPart;

/**
 * Where one tool call stands. `awaiting` and `denied` come from an approval card:
 * the call is gated, waiting on a person, or the person said no.
 */
export type ToolCallStatus = 'running' | 'done' | 'error' | 'awaiting' | 'denied';

/**
 * One tool the model called while writing a reply — drawn as a card inside the
 * reply's "Used N tools" line, the way the web client shows its work.
 *
 * **Not a part**, like the thinking: the line sits above the reply's text as a
 * whole, it is not a block in the middle of it. Two calls are deliberately not
 * here because they draw something of their own — `render_ui` (the view) and
 * `task` (the delegation card) — and neither is `write_todos`, which is the task
 * list.
 */
export type ToolCallRecord = {
  /** `tool_call_id` when the wire carried one, otherwise a local key. */
  id: string;
  tool: string;
  args: unknown;
  status: ToolCallStatus;
  /** The raw result. Only ever shown in a debug build — it is the model's context. */
  result?: string;
};

/** One line of the agent's plan (`ai.todos` / `write_todos`). */
export type TodoItem = {
  content: string;
  /** `pending` | `in_progress` | `completed`, verbatim. */
  status: string;
};

/**
 * A thumbs up or down on one reply. There is no third value: clearing a rating
 * is `null`, which is the undo half of a toggle rather than a "neutral" vote.
 */
export type MessageRating = 'good' | 'bad';

export type ChatAttachment = {
  id: string;
  name: string;
  contentType: string;
  kind: 'image' | 'file';
  /** Presigned URL, or null while the backend is still processing the file. */
  url: string | null;
  /**
   * The backend's own word for the file's state, verbatim (`AIAttachmentRead.status`)
   * — `'uploaded'` for one this session just sent.
   *
   * Kept because a missing `url` has more than one reading, and they need
   * different answers: still being processed, processing failed, or a presigned
   * link that was never issued on this read. Without it the only thing anyone can
   * say is "nothing happens when I tap it".
   */
  status: string;
  /** Why it failed, when the backend says so. */
  error: string | null;
};

/* ---------------------------------------------------------------- */
/* Messages                                                          */
/* ---------------------------------------------------------------- */

/** A user message is optimistic: it exists before the POST resolves. */
export type UserMessageStatus = 'sending' | 'sent' | 'failed';

export type UserMessage = {
  id: string;
  role: 'user';
  text: string;
  attachments: ChatAttachment[];
  createdAt: string;
  status: UserMessageStatus;
  error?: string;
  /**
   * The server's uuid for this message, once it has one. For a message that came
   * from history it is also the local `id`; for an optimistic bubble it is filled
   * in from the `202` that accepted the send. Branching is keyed by it — a message
   * with no `uuid` cannot be edited or switched, because the server does not know
   * it yet.
   */
  uuid?: string;
  /** The N in "n of N". Absent or `1` ⇒ no switcher (see {@link BranchInfo}). */
  siblingCount?: number;
};

/**
 * `stopped` is the user cancelling — a neutral state, never an error.
 * `empty` is a clean completion that produced no content at all, which the
 * screen must surface rather than render as a blank bubble.
 */
export type AssistantMessageStatus = 'streaming' | 'complete' | 'stopped' | 'error' | 'empty';

export type AssistantMessage = {
  id: string;
  role: 'assistant';
  parts: MessagePart[];
  /**
   * Files the turn produced — an XLSX built in the sandbox and handed over by
   * `deliver_file`, for example. Same shape as a user's uploads and drawn by the
   * same component, because it is the same `AIAttachmentRead` on the wire.
   *
   * It arrives with **history**, not with the stream: the run publishes text and
   * views, and the file only exists as a row once the turn is stored. So a live
   * turn fills this in after the fact — see `syncDeliveredFiles`.
   */
  attachments: ChatAttachment[];
  createdAt: string;
  status: AssistantMessageStatus;
  error?: string;
  /** Set while a run is live so the composer can cancel it. */
  runUuid?: string;
  /**
   * What the model thought before it answered (`ai.reasoning`), while it is
   * still thinking.
   *
   * **Live-only, and deliberately not a part.** The backend never stores it: the
   * final `content` does not contain it and no endpoint returns it afterwards, so
   * a reopened thread cannot show it. Keeping it out of `parts` is what stops it
   * from being copied, regenerated or folded into history as if it were the
   * reply — the screen shows it only while the turn has no text yet.
   */
  reasoning?: string;
  /** The tools the model called for this reply — see {@link ToolCallRecord}. */
  toolCalls?: ToolCallRecord[];
  /**
   * The agent's plan for a multi-step reply. Live from `ai.todos` (the whole list
   * every time); from history, the last `write_todos` call of the turn.
   */
  todos?: TodoItem[];
  /**
   * The server's uuid for this reply. From history it is also the local `id`; for
   * a reply that just streamed it arrives on the terminal `ai.run.completed`.
   * `regenerate` is keyed by it, so a reply without one cannot be forked yet.
   */
  uuid?: string;
  /** The N in "n of N". Absent or `1` ⇒ no switcher (see {@link BranchInfo}). */
  siblingCount?: number;
  /**
   * The rating on this reply, or `null` for none.
   *
   * Unlike the thinking, this **is** durable: the backend stores it on the
   * message row (and pushes it to Langfuse as a score afterwards), and history
   * returns it as `feedback_rating` — so a thread reopened tomorrow shows the
   * same filled glyph.
   */
  feedback?: MessageRating | null;
  /** A rating request is in flight — the buttons show the new state but are locked. */
  feedbackPending?: boolean;
};

export type ChatMessage = UserMessage | AssistantMessage;

export const isUserMessage = (message: ChatMessage): message is UserMessage =>
  message.role === 'user';

export const isAssistantMessage = (message: ChatMessage): message is AssistantMessage =>
  message.role === 'assistant';

export const messageText = (message: AssistantMessage): string =>
  message.parts
    .filter((part): part is TextPart => part.type === 'text')
    .map((part) => part.text)
    .join('');

/* ---------------------------------------------------------------- */
/* Thread                                                            */
/* ---------------------------------------------------------------- */

/**
 * What the branch switcher under a message needs to draw itself.
 *
 * `count` comes from the history page (`sibling_count`); `index` does not exist
 * there and is only known once `/siblings` has been read, so it is `null` until
 * then and the switcher shows the count alone. See `branches.ts`.
 */
export type BranchInfo = {
  /** Every version at this fork point, oldest-first — `null` until loaded. */
  uuids: string[] | null;
  /** Position of the visible version within `uuids`, or `null` while unknown. */
  index: number | null;
  /** How many versions exist, from `sibling_count`. */
  count: number;
  /** A switch is in flight — the arrows are disabled and the transcript reloads. */
  switching: boolean;
};

/** loading -> error -> empty -> data, the same order the native app uses. */
export type HistoryStatus = 'idle' | 'loading' | 'error' | 'ready';

export type ChatState = {
  /** `'new'` until the first message creates the conversation. */
  threadId: ThreadTarget;
  conversationUuid: string | null;
  title: string | null;
  /**
   * The custom agent this conversation is with, or `null` for Rooler itself. An
   * agent chat has no starter chips and no voice — agent conversations cannot go
   * to voice yet (web client's `ai-agents.md`).
   */
  agent: AgentRef | null;
  messages: ChatMessage[];
  historyStatus: HistoryStatus;
  historyError: unknown;
  /** True from the moment a send is accepted until the run reaches a terminal event. */
  isRunning: boolean;
};
