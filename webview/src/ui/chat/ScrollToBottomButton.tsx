import { ChevronDown } from 'lucide-react';

import { send } from '@/bridge/bridge';
import { useTranslation } from '@/i18n';
import { Fade } from '@/ui/primitives';

/** RN's `FadeIn.duration(180)` / `FadeOut.duration(180)` on this button. */
const FADE_MS = 180;

export type ScrollToBottomButtonProps = {
  /** Shown only while the user is scrolled away from the latest message. */
  show: boolean;
  onPress: () => void;
  /** Layout only — the parent positions it above the composer. */
  className?: string;
};

/**
 * "Jump to latest".
 *
 * It owns both halves of its own fade, which is why `show` is a prop rather than
 * the parent mounting it conditionally: React unmounts on the same commit as the
 * flag, so a parent-owned `{show ? <Button/> : null}` can only ever animate in —
 * the disappearance is a cut. `Fade` keeps it alive for the 180ms out.
 */
export function ScrollToBottomButton({ show, onPress, className }: ScrollToBottomButtonProps) {
  const { t } = useTranslation();
  return (
    <Fade show={show} enterMs={FADE_MS} from="down" className={className}>
      <button
        type="button"
        aria-label={t('chat.scrollToBottom')}
        onClick={() => {
          send('haptic', { style: 'tap' });
          onPress();
        }}
        className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface shadow-lg transition-transform duration-100 ease-out active:scale-90"
      >
        <ChevronDown size={22} strokeWidth={2} className="text-label-secondary" aria-hidden />
      </button>
    </Fade>
  );
}
