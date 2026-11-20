/**
 * Branching: the "n of N" under a message, and moving between the versions.
 *
 * Every message now has an internal parent pointer on the backend. Editing a
 * past user turn or regenerating a reply **forks a sibling instead of
 * overwriting anything** — the original is never deleted, it is simply no longer
 * on the branch you are viewing. So a fork point is a message with more than one
 * version, and this module is what lets the user walk between them.
 *
 * The data arrives in two halves, and that is the whole design here:
 *
 *   - **N** comes from `sibling_count` on the history page. It is only computed
 *     there (one extra query for the whole page); anywhere else the field
 *     defaults to `1`, which means "not computed", *not* "no alternates". That is
 *     why the switcher is only ever fed from a history load.
 *   - **n** does not come from anywhere. Knowing *which* of the N versions is on
 *     screen means reading `GET .../siblings`, so that request is made lazily —
 *     only for messages that actually have alternates, and only once each. Until
 *     it lands the switcher renders the count alone rather than a wrong position.
 *
 * The cache is per message uuid and lives as long as the open thread: uuids only
 * mean anything inside their own conversation, and a fork changes the counts of
 * messages already on screen, so `resetBranches()` is called on a thread switch
 * and after any run that created a sibling.
 */
import { useEffect, useSyncExternalStore } from 'react';

import { listMessageHistory, listSiblings, selectBranch } from '@/lib/api/ai';
import { getErrorMessage } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

import { describeRawHistory, describeTranscript, shortUuid } from './diagnostics';
import { reloadAfterBranchChange } from './history';
import { getState } from './store';
import type { BranchInfo } from './types';

const log = logger.child('branches');

/** What we know about one fork point. */
type BranchEntry = {
  /** Every version at this fork, oldest-first. `null` until `/siblings` lands. */
  uuids: string[] | null;
  /** Where the visible version sits in `uuids`. `null` while unknown. */
  index: number | null;
  /** A `/siblings` request is in flight — don't start a second one. */
  loading: boolean;
  /** A switch is in flight: the arrows are disabled until the transcript reloads. */
  switching: boolean;
};

/**
 * The empty entry, shared by every uncached uuid.
 *
 * It has to be one frozen object rather than a fresh literal per call:
 * `useSyncExternalStore` compares snapshots by reference, and returning a new
 * `{}` each time would re-render every message on every store notification — and
 * React would loop on the "getSnapshot should be cached" check.
 */
const EMPTY: BranchEntry = Object.freeze({
  uuids: null,
  index: null,
  loading: false,
  switching: false,
});

const entries = new Map<string, BranchEntry>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function read(messageUuid: string): BranchEntry {
  return entries.get(messageUuid) ?? EMPTY;
}

/** Replace an entry (never mutate one — see {@link EMPTY}) and publish it. */
function write(messageUuid: string, patch: Partial<BranchEntry>): void {
  entries.set(messageUuid, { ...read(messageUuid), ...patch });
  notify();
}

/** Forget every cached fork. Called on a thread switch and after a new fork lands. */
export function resetBranches(): void {
  if (entries.size === 0) return;
  entries.clear();
  notify();
}

/* ---------------------------------------------------------------- */
/* Loading                                                           */
/* ---------------------------------------------------------------- */

/**
 * Read the sibling list for a fork point, once.
 *
 * Failure is logged and left uncached: the switcher keeps showing N with its
 * arrows disabled, which is honest — we know there are alternates, we just could
 * not find out which one is on screen. The next mount tries again.
 */
async function ensureSiblings(messageUuid: string): Promise<BranchEntry> {
  const cached = read(messageUuid);
  if (cached.uuids || cached.loading) return cached;

  const { conversationUuid } = getState();
  if (!conversationUuid) return cached;

  write(messageUuid, { loading: true });
  try {
    const siblings = await listSiblings(conversationUuid, messageUuid);
    const uuids = siblings.map((sibling) => sibling.uuid);
    const index = uuids.indexOf(messageUuid);
    // A message that is not in its own sibling list leaves the switcher showing a
    // count it cannot move within — the arrows stay dead and it reads as a broken
    // control. It can only come from the endpoint, so say so plainly.
    if (index < 0) {
      log.warn('the sibling list does not contain the message it was asked about', {
        messageUuid: shortUuid(messageUuid),
        siblings: uuids.map(shortUuid),
      });
    } else {
      log.info('sibling list read', {
        messageUuid: shortUuid(messageUuid),
        position: `${index + 1} of ${uuids.length}`,
        siblings: uuids.map(shortUuid),
        roles: siblings.map((sibling) => sibling.role),
      });
    }
    write(messageUuid, { uuids, index: index >= 0 ? index : null, loading: false });
  } catch (error) {
    log.warn('could not read the sibling list', {
      messageUuid,
      message: getErrorMessage(error, 'Unknown error'),
    });
    write(messageUuid, { loading: false });
  }
  return read(messageUuid);
}

/* ---------------------------------------------------------------- */
/* Switching                                                         */
/* ---------------------------------------------------------------- */

/**
 * Say, in one line, what the user is now looking at.
 *
 * The reported symptom is a switch that leaves the question on screen and the
 * answer gone, and the reload cannot tell that apart from a version that never
 * had an answer. So the transcript is re-read once the reload has landed and the
 * shape is checked directly: a *user* version with no assistant message anywhere
 * under it is the failure, and it is a failure of the path the history endpoint
 * returned — every message on screen came from it. Selecting an assistant version
 * is the ordinary case where nothing follows and is not reported.
 */
async function reportSwitchOutcome(
  conversationUuid: string,
  target: string,
  activeLeaf: string,
): Promise<void> {
  const messages = getState().messages;
  const at = messages.findIndex((message) => message.uuid === target);
  if (at < 0 || messages[at].role !== 'user') return;
  if (messages.slice(at + 1).some((message) => message.role === 'assistant')) return;

  log.warn('the version switched to has no reply under it', {
    target: shortUuid(target),
    activeLeaf: shortUuid(activeLeaf),
    leafIsTheSelectedMessage: activeLeaf === target,
    transcript: describeTranscript(messages),
  });

  // The one probe that settles it, and the reason it is worth an extra request in
  // a path that has already failed: this asks for the *same* branch a second time,
  // addressed by `leaf` instead of by "whatever is active".
  //
  //   `carriesAnAnswer: true`  — the reply is stored and reachable; the active
  //     branch read is what left it out, i.e. `select-branch` parked the pointer on
  //     the selected message instead of walking down to that branch's last message.
  //     Backend — and a `leaf` parameter is the workaround if it has to be one.
  //   `carriesAnAnswer: false` — the reply is not under this version at all. Either
  //     the fork re-parented it onto the sibling, or it was never linked to this
  //     one. Backend, and a data question rather than a pointer one.
  try {
    const page = await listMessageHistory(conversationUuid, { leaf: target });
    const items = page.items ?? [];
    log.warn('the same branch, read again by leaf', {
      target: shortUuid(target),
      rows: items.length,
      carriesAnAnswer: items.some(
        (item) => item.role === 'assistant' && (item.content ?? '').length > 0,
      ),
      wire: describeRawHistory(items),
    });
  } catch (error) {
    log.warn('the leaf-addressed read failed, so the switch stays unattributed', {
      target: shortUuid(target),
      message: getErrorMessage(error, 'Unknown error'),
    });
  }
}

/**
 * Move the conversation's active branch one step at this fork point, then re-read
 * the transcript.
 *
 * `select-branch` starts no run — it only moves the pointer — so the reload that
 * follows is the whole visible effect. Resolves to `false` when there was nothing
 * to move to or the switch failed, so the caller can say so; it never throws,
 * because it runs from a press handler.
 */
export async function switchBranch(messageUuid: string, delta: 1 | -1): Promise<boolean> {
  const { conversationUuid } = getState();
  if (!conversationUuid) return false;

  // The arrows are drawn from the sibling list, so it is normally already here;
  // this covers a press that beats the lazy load.
  const entry = await ensureSiblings(messageUuid);
  if (!entry.uuids || entry.index === null || entry.switching) return false;

  const from = entry.index;
  const target = entry.uuids[from + delta];
  if (!target) return false;
  const position = `${from + 1} -> ${from + delta + 1} of ${entry.uuids.length}`;

  write(messageUuid, { switching: true });
  try {
    const selected = await selectBranch(conversationUuid, target);
    // `active_leaf_message_uuid` is the backend's own account of where the
    // conversation now points, and it is the first thing to read when a switch
    // lands on a question with no answer under it. A leaf equal to the message we
    // just selected means the pointer was parked on that sibling instead of being
    // walked down its branch to the last message on it — the reply then simply is
    // not on the path `…/messages/history` returns, and nothing this app can do
    // will put it back.
    log.info('switched branch', {
      conversationUuid,
      from: shortUuid(messageUuid),
      to: shortUuid(target),
      delta,
      position,
      activeLeaf: shortUuid(selected.active_leaf_message_uuid),
      leafIsTheSelectedMessage: selected.active_leaf_message_uuid === target,
    });
    // The message at this position is a different one now, so every cached entry
    // is keyed on a uuid that may no longer be on screen.
    resetBranches();
    await reloadAfterBranchChange({
      reason: 'select-branch',
      expect: [
        { what: 'selected version', uuid: target },
        { what: 'active leaf', uuid: selected.active_leaf_message_uuid },
      ],
    });
    await reportSwitchOutcome(conversationUuid, target, selected.active_leaf_message_uuid);
    return true;
  } catch (error) {
    log.error('branch switch failed', {
      messageUuid,
      target,
      message: getErrorMessage(error, 'Unknown error'),
    });
    write(messageUuid, { switching: false });
    return false;
  }
}

/* ---------------------------------------------------------------- */
/* React binding                                                     */
/* ---------------------------------------------------------------- */

/**
 * The switcher's state for one message, or `null` when there is nothing to
 * switch between.
 *
 * The lazy `/siblings` read is fired from here rather than from the store, so a
 * request happens exactly when a switcher is actually on screen — a hundred-turn
 * thread with two forks makes two requests, not a hundred.
 */
export function useBranchInfo(
  messageUuid: string | undefined,
  siblingCount: number | undefined,
): BranchInfo | null {
  const entry = useSyncExternalStore(
    subscribe,
    () => (messageUuid ? read(messageUuid) : EMPTY),
    () => EMPTY,
  );

  const count = siblingCount ?? 1;
  const hasBranches = Boolean(messageUuid) && count > 1;

  useEffect(() => {
    if (!messageUuid || !hasBranches) return;
    void ensureSiblings(messageUuid);
  }, [messageUuid, hasBranches]);

  if (!hasBranches) return null;
  return {
    uuids: entry.uuids,
    index: entry.index,
    count,
    switching: entry.switching,
  };
}
