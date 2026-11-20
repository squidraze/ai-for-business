import { Info } from 'lucide-react';

import { send } from '@/bridge/bridge';
import { useTranslation } from '@/i18n';

/**
 * Shown under an assistant turn the user cancelled. Cancelling is not a failure,
 * so the tone is neutral: no red, no alarm glyph — just a note and a compact
 * "Try again". Whatever text did stream stays above it rather than being thrown
 * away.
 *
 * It is deliberately **not** `ErrorState`, and that is the native screen's rule
 * too (`ChatScreen/components/StoppedBanner.tsx` is its own component): a cancel
 * is not a failure, so it must not borrow the alarm disc and the red glyph. Its
 * own shape — a filled 16px-radius block, 15px text and a pill on a contrasting
 * fill — is what keeps "you stopped this" distinguishable from "this broke".
 */
export function StoppedBanner({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    // `bg-surface`, not `bg-surface-muted`: an assistant turn sits directly on
    // the screen, and the muted step *is* the screen step to within a shade — a
    // muted banner there has no visible fill at all. The card step is what marks
    // something off from the transcript here (it is what the bubbles use), and
    // the pill inside then takes the muted step so it stays legible on it.
    <div className="flex w-full items-center gap-3 rounded-card border border-border bg-surface px-4 py-3">
      <Info size={20} strokeWidth={2} className="shrink-0 text-label-secondary" aria-hidden />
      <p className="min-w-0 flex-1 text-[0.9375rem] leading-5 text-label">
        {t('reply.stopped')}
      </p>
      <button
        type="button"
        onClick={() => {
          send('haptic', { style: 'tap' });
          onRetry();
        }}
        className="shrink-0 rounded-full bg-surface-muted px-4 py-2 text-[0.875rem] font-semibold text-label active:opacity-80"
      >
        {t('common.tryAgain')}
      </button>
    </div>
  );
}
