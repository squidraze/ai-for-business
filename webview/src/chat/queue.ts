/**
 * Messages written while the assistant is still replying.
 *
 * Sending one at once would fork the conversation: the backend keeps a tree, and
 * a message sent mid-reply hangs off the same parent as the reply in progress —
 * the "1 of 2" switcher on a user message that the web client traced back to
 * exactly this. So they wait here and go out one at a time once the reply is done
 * (`run.ts` drains it), or at once on "Send now", which stops the reply first.
 *
 * Each entry carries its attachments already taken off the composer — the
 * uploaded `file_uuids` and the previews the queued bubble draws — so the
 * composer is free for the next message the moment one is queued.
 *
 * Memory only and per thread, like the web client's: a reload or a thread switch
 * drops it, like any unsent draft.
 */
import { useSyncExternalStore } from 'react';

import type { ChatAttachment } from './types';

export type QueuedMessage = {
  id: string;
  text: string;
  attachments: ChatAttachment[];
  fileUuids: string[];
};

const EMPTY: QueuedMessage[] = [];
let queue: QueuedMessage[] = EMPTY;
const listeners = new Set<() => void>();
let sequence = 0;

/** Set by "Send now": the next send follows a cancel and must wait a beat. */
let sentNow = false;

function write(next: QueuedMessage[]): void {
  queue = next.length === 0 ? EMPTY : next;
  for (const listener of [...listeners]) listener();
}

export function enqueueMessage(message: Omit<QueuedMessage, 'id'>): QueuedMessage {
  sequence += 1;
  const queued = { ...message, id: `queued-${sequence}` };
  write([...queue, queued]);
  return queued;
}

export function removeQueuedMessage(id: string): void {
  write(queue.filter((message) => message.id !== id));
}

/** Move one message to the head and mark the next send as following a cancel. */
export function promoteQueuedMessage(id: string): boolean {
  const message = queue.find((candidate) => candidate.id === id);
  if (!message) return false;
  sentNow = true;
  write([message, ...queue.filter((candidate) => candidate.id !== id)]);
  return true;
}

/** Take the head of the queue, with whether it follows a "Send now". */
export function takeNextQueued(): { message: QueuedMessage; afterCancel: boolean } | null {
  const [next, ...rest] = queue;
  if (!next) return null;
  const afterCancel = sentNow;
  sentNow = false;
  write(rest);
  return { message: next, afterCancel };
}

export function hasQueued(): boolean {
  return queue.length > 0;
}

/** A thread switch: nothing queued for one thread may go out into another. */
export function clearQueue(): void {
  sentNow = false;
  if (queue.length > 0) write([]);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): QueuedMessage[] => queue;

export function useQueuedMessages(): QueuedMessage[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
