/**
 * The chat state layer. Everything the UI needs comes from here — nothing
 * outside this folder should reach into `store.ts` directly, so there is exactly
 * one writer per piece of state.
 */
export type {
  AssistantMessage,
  AssistantMessageStatus,
  BranchInfo,
  ChatAttachment,
  ChatMessage,
  ChatState,
  HistoryStatus,
  MessagePart,
  MessageRating,
  TextPart,
  ToolCallPart,
  UserMessage,
  UserMessageStatus,
} from './types';
export { isAssistantMessage, isUserMessage, messageText } from './types';

export type { ChatActions } from './useChat';
export { useChatActions, useChatState } from './useChat';

export type { CompanyState } from './companies';
export { getCompanyForNewThread, initCompanies, selectCompany, useCompanies } from './companies';

export { HISTORY_PAGE_LIMIT, toChatAttachment, toChatMessage } from './history';

/** Thumbs up/down on a reply — durable, and cleared by pressing the same thumb. */
export { rateMessage } from './feedback';
export type { RateFailure, RateResult } from './feedback';

/** Deleting one message — the server decides what goes with it, so it re-reads. */
export { deleteMessage } from './deletion';

/** Branching: the "n of N" under a forked message, and moving between versions. */
export { resetBranches, switchBranch, useBranchInfo } from './branches';

/**
 * Read-only access for code that runs outside React (the bridge handlers, the
 * realtime lifecycle). Prefer `useChatState()` inside a component.
 */
export { getState as getChatState, subscribe as subscribeToChat } from './store';

/**
 * The same actions as free functions, for callers that are not components — the
 * bridge's `thread.switch` handler, the realtime reconnect handler, the app's
 * bootstrap. Inside a component use `useChatActions()`.
 */
export { openThread, refreshOpenThread, retryHistory } from './history';
export {
  editUserMessage,
  recoverRuns,
  regenerate,
  releaseAction,
  removeQueuedMessage,
  resumeAction,
  retryLastSend,
  sendMessage,
  sendQueuedNow,
  stop,
} from './run';

/** Messages written while a reply runs — sent one at a time once it is done. */
export { useQueuedMessages } from './queue';
export type { QueuedMessage } from './queue';

/** Standing approvals ("Always allow" / "Allow for this session"). */
export { ALLOW_LABEL, cardAllowChoices, readAllowOptions, recordedScope } from './allow';
export type { AllowOptions } from './allow';
