import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Flag, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react';
import clsx from 'clsx';

import { send } from '@/bridge/bridge';
import { getChatState, rateMessage } from '@/chat';
import type { MessageRating } from '@/chat';
import { useTranslation } from '@/i18n';
import { logger } from '@/lib/logger';
import { useToast } from '@/ui/primitives';

/**
 * The row under a *finished* assistant reply: copy, regenerate, thumbs up/down,
 * report.
 *
 * Figma 3234:70940 (node 3234:71036) draws the timestamp here as a third item.
 * It is not rendered any more: a time on every turn is noise on a screen where
 * the whole conversation happened in the last minute, so it moved into the
 * long-press menu (`MessageMenu`) where it is available on demand for both
 * message kinds — see `messageTime.ts` for what it renders there.
 *
 * **The thumbs are back, and now they mean something.** They were removed while
 * there was no endpoint behind them — a vote that reached no backend and survived
 * nothing is worse than no control at all. `POST …/messages/{uuid}/feedback`
 * exists now: the rating is written to the message row (and pushed to Langfuse as
 * a score afterwards), history returns it, and the filled glyph comes back with
 * the thread. Pressing the filled thumb again clears the rating — an opinion you
 * cannot take back is its own kind of broken control.
 *
 * Two states they deliberately do not have:
 *
 *  - **No spinner.** The glyph fills on the tap and rolls back if the request
 *    fails (`rateMessage` owns that); a rating is not worth a loading state.
 *  - **No retry offer for a reply that predates the feedback migration.** Those
 *    have no Langfuse trace to score and answer `422` forever, so the toast says
 *    that in words instead of inviting a second attempt.
 *
 * They only mount for a reply the server knows by uuid — a turn that is still
 * streaming has nothing to attach a rating to. `AssistantMessage` already keeps
 * this whole row off a live turn; `messageUuid` is what covers the rest.
 *
 * **Report is not the thumbs.** A rating is a quality score for Langfuse; the
 * flag is the in-app "Report this response" Google Play and Apple require of
 * generative-AI apps. The page only names the reply: it posts `report.open` and
 * the host opens its own reason sheet, files the report and shows the toast — the
 * same flow the native chat runs, so a report reads the same from either screen.
 * Like the thumbs it needs the reply's server uuid (a reviewer finds the reply by
 * it), so it appears on a just-streamed reply once `ai.run.completed` names it.
 *
 * It never mounts while a run is streaming: copying or regenerating half an
 * answer is a worse outcome than waiting (see AssistantMessage).
 */

const log = logger.child('message-actions');

/** How long the copy glyph stays a checkmark. */
const COPIED_MS = 1500;

/* ---------------------------------------------------------------- */
/* Actions                                                           */
/* ---------------------------------------------------------------- */

export type MessageActionsProps = {
  /** Plain text of the reply — what lands on the clipboard. */
  text: string;
  onRegenerate: () => void;
  /** This reply's local id — what `rateMessage` addresses. */
  messageId: string;
  /**
   * The reply's server uuid, once it has one. Absent ⇒ no thumbs and no report:
   * there is nothing on the backend to rate or point a reviewer at yet.
   */
  messageUuid?: string;
  /** The rating already on this reply, from history or from this session. */
  feedback?: MessageRating | null;
  /** A rating request is in flight — the thumbs are locked, not spinning. */
  feedbackPending?: boolean;
};

// 20px is the Figma glyph size; the pseudo-element grows the tap target to ~36px
// without changing the row's height or the measured 10px gaps.
const GLYPH = 'relative text-label-secondary active:opacity-60 after:absolute after:-inset-2';

export function MessageActions({
  text,
  onRegenerate,
  messageId,
  messageUuid,
  feedback,
  feedbackPending = false,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  const { show } = useToast();
  const { t } = useTranslation();

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(() => {
    // No `navigator.clipboard` here: a WebView served from file:// is not a
    // secure context, so the write goes through the native host.
    send('haptic', { style: 'tap' });
    send('clipboard.write', { text });
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  }, [text]);

  const regenerate = useCallback(() => {
    send('haptic', { style: 'tap' });
    onRegenerate();
  }, [onRegenerate]);

  const report = useCallback(() => {
    // Read at the press rather than subscribed to: the row is memoised per
    // reply, and a uuid on the reply means the conversation exists.
    const { conversationUuid } = getChatState();
    if (!conversationUuid || !messageUuid) {
      log.warn('report skipped — the reply has no server uuid yet', { messageId });
      return;
    }
    send('haptic', { style: 'tap' });
    send('report.open', { conversationUuid, messageUuid });
  }, [messageId, messageUuid]);

  const rate = useCallback(
    (rating: MessageRating) => {
      send('haptic', { style: 'tap' });
      void rateMessage(messageId, rating).then((result) => {
        if (result.ok) return;
        show(t(result.reason === 'unsupported' ? 'rating.unsupported' : 'rating.failed'), {
          // The pre-migration case is a fact about an old message, not a failure
          // the user did anything to cause.
          type: result.reason === 'unsupported' ? 'info' : 'error',
        });
      });
    },
    [messageId, show, t],
  );

  return (
    <div className="flex h-6 items-center gap-2.5">
      <button
        type="button"
        aria-label={copied ? t('message.copied') : t('message.copy')}
        onClick={copy}
        className={clsx(GLYPH, copied && 'text-primary')}
      >
        {copied ? (
          <Check size={20} strokeWidth={2} aria-hidden />
        ) : (
          <Copy size={20} strokeWidth={2} aria-hidden />
        )}
      </button>

      <button
        type="button"
        aria-label={t('rating.regenerate')}
        onClick={regenerate}
        className={GLYPH}
      >
        <RefreshCw size={20} strokeWidth={2} aria-hidden />
      </button>

      {messageUuid ? (
        <>
          <button
            type="button"
            aria-label={feedback === 'good' ? t('rating.remove') : t('rating.good')}
            aria-pressed={feedback === 'good'}
            disabled={feedbackPending}
            onClick={() => rate('good')}
            className={clsx(GLYPH, feedback === 'good' && 'text-primary')}
          >
            <ThumbsUp
              size={20}
              strokeWidth={2}
              // Filled rather than merely tinted: at 20px a colour change alone is
              // easy to miss on the glance back at a reply you already rated.
              fill={feedback === 'good' ? 'currentColor' : 'none'}
              aria-hidden
            />
          </button>

          <button
            type="button"
            aria-label={feedback === 'bad' ? t('rating.remove') : t('rating.bad')}
            aria-pressed={feedback === 'bad'}
            disabled={feedbackPending}
            onClick={() => rate('bad')}
            className={clsx(GLYPH, feedback === 'bad' && 'text-danger')}
          >
            <ThumbsDown
              size={20}
              strokeWidth={2}
              fill={feedback === 'bad' ? 'currentColor' : 'none'}
              aria-hidden
            />
          </button>

          <button type="button" aria-label={t('report.open')} onClick={report} className={GLYPH}>
            <Flag size={20} strokeWidth={2} aria-hidden />
          </button>
        </>
      ) : null}
    </div>
  );
}
