import clsx from 'clsx';

import { useEnterExit } from './useEnterExit';

/**
 * The transcript's entrance animation, in one component.
 *
 * The native chat gives every element a reanimated `entering`/`exiting`; this is
 * the web equivalent, and the durations below are that screen's numbers rather
 * than new ones — 250ms for an assistant turn, 220ms for a user bubble, 180ms for
 * the jump button, 500ms for the skeleton crossfade. Wrap, don't hand-roll: a
 * one-off `transition-opacity` on a conditionally rendered element animates in
 * and then vanishes on a single frame, which is the exact asymmetry this fixes
 * (see {@link useEnterExit}).
 *
 * `prefers-reduced-motion: reduce` collapses every duration to ~0 globally, from
 * `index.css` — nothing to pass here.
 */

/** RN's `FadeIn` / `FadeInDown` default travel, in px. */
const OFFSET = {
  none: '',
  /** Enters from below, moving up — `FadeInDown`. */
  down: 'translate-y-2',
  /** Enters from above, moving down — `FadeInUp`. */
  up: '-translate-y-2',
} as const;

export type FadeProps = {
  /**
   * Keep it on screen. Omit for a mount-only fade (the common case: a message
   * that appears and then simply belongs to the transcript). Pass the real flag
   * when the element also has to fade *out* — the typing dots, the skeleton.
   */
  show?: boolean;
  /** Enter duration, ms. */
  enterMs?: number;
  /** Exit duration, ms. Also how long the element outlives `show === false`. */
  exitMs?: number;
  /** Where the enter animation starts from. Exits are opacity-only, like RN's. */
  from?: keyof typeof OFFSET;
  /**
   * While leaving, take the element out of the flow (`absolute inset-0`) so the
   * content replacing it can occupy the same box at the same time — that is what
   * makes a *crossfade* rather than a fade-out followed by a jump. The parent
   * must be `relative`.
   */
  absoluteOnExit?: boolean;
  /** Layout only — the wrapper is a plain block otherwise. */
  className?: string;
  children: React.ReactNode;
};

export function Fade({
  show = true,
  enterMs = 250,
  exitMs = enterMs,
  from = 'none',
  absoluteOnExit = false,
  className,
  children,
}: FadeProps) {
  const { mounted, visible } = useEnterExit(show, exitMs);

  if (!mounted) return null;

  const leaving = !show;

  return (
    <div
      className={clsx(
        'transition-[opacity,transform] ease-out',
        visible
          ? 'translate-y-0 opacity-100'
          : // On the way out it only fades: sliding a departing element is RN's
            // `FadeOut` behaviour too, and it reads as the content moving twice.
            leaving
            ? 'translate-y-0 opacity-0'
            : clsx(OFFSET[from], 'opacity-0'),
        leaving && absoluteOnExit && 'pointer-events-none absolute inset-0',
        className,
      )}
      style={{ transitionDuration: `${leaving ? exitMs : enterMs}ms` }}
    >
      {children}
    </div>
  );
}
