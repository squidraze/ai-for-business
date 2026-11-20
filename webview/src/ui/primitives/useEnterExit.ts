import { useEffect, useState } from 'react';

/**
 * "Stay mounted one animation longer than you are wanted."
 *
 * React rips a conditionally-rendered element out of the tree on the same commit
 * as the flag that hid it, so a CSS transition has nothing to animate *to* on the
 * way out. This is the one place that fixes that, for every fade in the app:
 * `mounted` outlives `show` by `exitMs`, and `visible` is the class-flipping flag
 * that drives the transition in both directions.
 *
 * It is the generalised form of the pattern `Sheet.tsx` grew for the bottom sheet
 * (same two-frame trick, same JS-driven unmount); `Fade` is the wrapper that
 * turns it into markup. Reach for the hook directly only when the animated
 * element cannot afford the extra `<div>` a wrapper adds.
 *
 * @param show   render it?
 * @param exitMs how long the exit transition lasts — keep in sync with the CSS.
 */
export function useEnterExit(
  show: boolean,
  exitMs: number,
): { mounted: boolean; visible: boolean } {
  const [mounted, setMounted] = useState(show);
  const [visible, setVisible] = useState(false);

  // Adjusting state while rendering, not in an effect: the mount must land in the
  // same commit as the prop flip, or the element paints one frame late — at rest,
  // where the enter animation was supposed to start.
  const [lastShow, setLastShow] = useState(show);
  if (lastShow !== show) {
    setLastShow(show);
    setVisible(false);
    if (show) setMounted(true);
  }

  // Two frames: it must paint at rest (opacity 0) before we flip it, or the
  // browser collapses both states into one and there is no transition at all.
  useEffect(() => {
    if (!mounted || !show) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setVisible(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [mounted, show]);

  useEffect(() => {
    if (show || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [show, mounted, exitMs]);

  return { mounted, visible };
}
