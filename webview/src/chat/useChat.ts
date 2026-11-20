/**
 * React bindings.
 *
 * The store lives outside React (a module singleton), so a component reads it
 * through `useSyncExternalStore` and every action is a plain function. There is
 * no provider and no context: one WebView shows one thread, and a second store
 * instance would be a bug, not a feature.
 */
import { useSyncExternalStore } from 'react';

import { deleteMessage } from './deletion';
import { rateMessage } from './feedback';
import { openThread, refreshOpenThread, retryHistory } from './history';
import {
  editUserMessage,
  regenerate,
  releaseAction,
  resumeAction,
  retryLastSend,
  sendMessage,
  stop,
} from './run';
import { getState, subscribe } from './store';
import type { ChatState } from './types';

/** The open thread. Re-renders only when the snapshot object actually changes. */
export function useChatState(): ChatState {
  return useSyncExternalStore(subscribe, getState, getState);
}


export type ChatActions = {
  /** Point the screen at a thread; `'new'` is an empty, ready one. */
  openThread: typeof openThread;
  /** Re-fetch the open thread's history — wire this to realtime reconnect. */
  refreshOpenThread: typeof refreshOpenThread;
  /** Retry after `historyStatus === 'error'`. */
  retryHistory: typeof retryHistory;
  sendMessage: typeof sendMessage;
  /** Cancel the live run: aborts the stream and tells the backend to stop. */
  stop: typeof stop;
  /** Ask for a different answer to one reply — forks a sibling of it, never replaces it. */
  regenerate: typeof regenerate;
  /** Rewrite a past user turn: forks a sibling of it and answers the new version. */
  editUserMessage: typeof editUserMessage;
  /** Resend a user message whose status is `'failed'`. */
  retryLastSend: typeof retryLastSend;
  /** Answer a human-in-the-loop card. Throws — the card owns the failure. */
  resumeAction: typeof resumeAction;
  /** Free a card stranded in `resolving`, so it can be answered again. */
  releaseAction: typeof releaseAction;
  /** Thumbs up/down a reply; the same thumb again clears it. */
  rateMessage: typeof rateMessage;
  /** Delete one message on the server, then re-read the transcript. */
  deleteMessage: typeof deleteMessage;
};

/**
 * Frozen and module-level: every action is a free function over the singleton
 * store, so the object is referentially stable forever and can be depended on
 * from an effect without a `useMemo` or a stale-closure hazard.
 */
const actions: ChatActions = Object.freeze({
  openThread,
  refreshOpenThread,
  retryHistory,
  sendMessage,
  stop,
  regenerate,
  editUserMessage,
  retryLastSend,
  resumeAction,
  releaseAction,
  rateMessage,
  deleteMessage,
});

export function useChatActions(): ChatActions {
  return actions;
}
