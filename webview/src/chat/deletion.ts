/**
 * Deleting one message — the "Delete message" row of the long-press menu.
 *
 * The native chat's `deleteMessage` (`realtime/branching.ts`), ported. Two rules
 * carried over:
 *
 * - **The transcript is read back, not spliced.** `DELETE …/messages/{uuid}` is a
 *   soft delete on the server, and the server decides what else goes with the row
 *   (its attachments, and whatever the branch hangs off it). Guessing on screen is
 *   how a transcript starts disagreeing with the conversation the model answers
 *   from — so success is followed by the same branch-aware reload an edit or a
 *   regenerate ends with.
 * - **Not while a run is live.** The reply being written hangs off the branch
 *   this would change, and the reload would replace the list under the stream.
 *   The menu row is disabled for the same reason; this is the race, not the path.
 *
 * Unlike a rating there is nothing optimistic here: a delete cannot be undone,
 * so the message stays on screen until the server has said yes.
 */
import { deleteMessage as apiDeleteMessage } from '@/lib/api/ai';
import { isAbortError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

import { resetBranches } from './branches';
import { shortUuid } from './diagnostics';
import { reloadAfterBranchChange } from './history';
import { currentGeneration, getState, isStale, removeMessages } from './store';

const log = logger.child('delete');

/** Messages with a delete in flight — a second press is not a second request. */
const inFlight = new Set<string>();

/**
 * Delete a message the server knows, then re-read the transcript.
 *
 * Resolves `true` once the server accepted the delete, `false` when it did not
 * happen — the caller is a confirmation sheet, and every outcome is something to
 * show rather than something to throw.
 */
export async function deleteMessage(messageId: string): Promise<boolean> {
  const state = getState();
  if (state.isRunning) {
    log.info('delete ignored — a run is in progress', { messageId });
    return false;
  }
  const message = state.messages.find((m) => m.id === messageId);
  const conversationUuid = state.conversationUuid;
  const messageUuid = message?.uuid;
  // The menu only offers the row for a message with a server uuid.
  if (!conversationUuid || !messageUuid) {
    log.warn('delete ignored — the message has no server uuid', { messageId });
    return false;
  }
  if (inFlight.has(messageId)) return false;

  inFlight.add(messageId);
  const generation = currentGeneration();
  try {
    await apiDeleteMessage(conversationUuid, messageUuid);
  } catch (error) {
    if (!isAbortError(error)) {
      log.warn('delete failed', { messageUuid: shortUuid(messageUuid), role: message.role });
    }
    return false;
  } finally {
    inFlight.delete(messageId);
  }
  log.info('deleted a message', { messageUuid: shortUuid(messageUuid), role: message.role });

  // The thread was switched while the request was out: the delete stands, and
  // there is nothing on screen left to update.
  if (isStale(generation)) return true;

  resetBranches();
  try {
    await reloadAfterBranchChange({ reason: 'after-delete' });
  } catch {
    // Already logged by `reloadAfterBranchChange`. The server has the delete; at
    // least stop showing the one row we know is gone.
    if (!isStale(generation)) removeMessages([messageId]);
  }
  return true;
}
