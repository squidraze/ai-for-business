/**
 * Thumbs up / down on one assistant reply.
 *
 * The vote is a real backend object, not a screen state: `POST
 * …/messages/{uuid}/feedback` writes it to the message row and only then pushes
 * it to Langfuse as a score on the trace that reply came from. So a rating
 * survives a reload (history returns it as `feedback_rating`), and a Langfuse
 * outage costs the score, never the rating.
 *
 * Two things shape this module:
 *
 * - **It is a toggle, and the off position is `rating: null`.** Pressing the
 *   filled thumb clears the rating rather than doing nothing, because a vote you
 *   cannot take back is a worse offer than no vote at all. There is no third
 *   value on the wire and none here.
 * - **A reply from before the feedback migration cannot be rated.** It carries no
 *   Langfuse trace to score, and the route says so with a `422`. That is an
 *   answer, not a fault: the UI states it plainly and does not offer a retry that
 *   is guaranteed to fail again, and nothing is logged as an error.
 *
 * The optimistic update is the point of the whole file: a thumb has to fill on
 * the tap, and go back to where it was if the request fails.
 */
import { AxiosError } from 'axios';

import { submitMessageFeedback } from '@/lib/api/ai';
import { isAbortError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

import { getState, updateAssistantMessage } from './store';
import { isAssistantMessage, type MessageRating } from './types';

const log = logger.child('feedback');

/**
 * Why a rating did not land.
 *
 * `unsupported` is the pre-migration reply — permanent, and worth different
 * words from a request that merely failed. `failed` is everything else and is
 * worth trying again.
 */
export type RateFailure = 'unsupported' | 'failed';

export type RateResult = { ok: true } | { ok: false; reason: RateFailure };

/** Did the backend answer "this message cannot carry feedback"? */
function isUnsupported(error: unknown): boolean {
  return error instanceof AxiosError && error.response?.status === 422;
}

/**
 * Rate a reply, or clear its rating by pressing the same thumb again.
 *
 * Resolves rather than throws: the caller is a button, and every outcome here is
 * something to show, not something to crash on.
 */
export async function rateMessage(messageId: string, rating: MessageRating): Promise<RateResult> {
  const state = getState();
  const message = state.messages.find((m) => m.id === messageId);
  if (!message || !isAssistantMessage(message)) return { ok: false, reason: 'failed' };

  const conversationUuid = state.conversationUuid;
  const messageUuid = message.uuid;
  // A reply the server has not stored yet has nothing to hang a rating on. The
  // buttons are gated on the same condition, so this is the race, not the path.
  if (!conversationUuid || !messageUuid) {
    log.warn('rating skipped — the reply has no server uuid yet', { messageId });
    return { ok: false, reason: 'failed' };
  }

  const previous = message.feedback ?? null;
  // Pressing the thumb that is already filled clears it.
  const next: MessageRating | null = previous === rating ? null : rating;

  updateAssistantMessage(messageId, { feedback: next, feedbackPending: true });

  try {
    const saved = await submitMessageFeedback(conversationUuid, messageUuid, { rating: next });
    // Trust the row the backend answers with over what we assumed: it is the
    // value the next history load will return.
    const stored =
      saved.feedback_rating === 'good' || saved.feedback_rating === 'bad'
        ? saved.feedback_rating
        : null;
    updateAssistantMessage(messageId, { feedback: stored, feedbackPending: false });
    log.info('rating saved', { messageUuid, rating: stored });
    return { ok: true };
  } catch (error) {
    updateAssistantMessage(messageId, { feedback: previous, feedbackPending: false });
    if (isAbortError(error)) return { ok: false, reason: 'failed' };
    if (isUnsupported(error)) {
      // Expected for anything written before the migration — `info`, not `warn`:
      // it says nothing about the health of the app.
      log.info('this reply predates feedback and cannot be rated', { messageUuid });
      return { ok: false, reason: 'unsupported' };
    }
    log.warn('rating failed', { messageUuid, rating: next });
    return { ok: false, reason: 'failed' };
  }
}
