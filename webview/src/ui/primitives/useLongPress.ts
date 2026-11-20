import { useCallback, useEffect, useRef } from 'react';

/**
 * Press-and-hold, the way a native chat opens a message menu.
 *
 * Hand-rolled rather than pulled from a library, and that is not a preference:
 * this bundle is one self-contained `index.html` under a CSP that blocks every
 * external request, so a gesture library would have to be vendored whole for
 * ~40 lines of pointer bookkeeping.
 *
 * What the 40 lines actually buy:
 *
 *  - **A scroll is not a press.** The timer is cancelled once the finger travels
 *    past {@link MOVE_TOLERANCE_PX}, so holding still for a moment at the start
 *    of a flick does not open a menu behind the user's back.
 *  - **A button is not a press target.** A hold that starts on a control belongs
 *    to that control; without this, holding the copy button opened the menu
 *    instead of copying.
 *  - **The tap that follows is swallowed.** A long press still ends in a
 *    `click`, which would immediately act on whatever was underneath.
 *  - **The native menu never appears.** `contextmenu` is always prevented, so
 *    the OS text callout does not race ours.
 *
 * The pressed element must not be text-selectable, or the platform starts a
 * selection mid-hold and the two gestures fight. That is why the transcript's
 * `.selectable` opt-in came off the message bodies — selection becomes an entry
 * *in* the menu, which is how every app with this gesture resolves it.
 */

/** Long enough not to fire on a slow tap, short enough not to feel stuck. */
const HOLD_MS = 450;
/** Past this the finger is scrolling, not holding. */
const MOVE_TOLERANCE_PX = 10;

export type LongPressHandlers = {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
};

/**
 * @param onLongPress called with the element that was held — the caller
 *   measures it, so the menu can be anchored to the real message.
 */
export function useLongPress(onLongPress: (element: HTMLElement) => void): LongPressHandlers {
  const timer = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const element = useRef<HTMLElement | null>(null);
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      // Right-click and friends are not a hold.
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      // A hold that starts on a control belongs to the control.
      if (event.target instanceof Element && event.target.closest('button, a, [role="button"]')) {
        return;
      }

      fired.current = false;
      origin.current = { x: event.clientX, y: event.clientY };
      element.current = event.currentTarget;

      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        if (element.current) onLongPress(element.current);
      }, HOLD_MS);
    },
    [cancel, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (timer.current === null) return;
      const dx = event.clientX - origin.current.x;
      const dy = event.clientY - origin.current.y;
      if (Math.hypot(dx, dy) > MOVE_TOLERANCE_PX) cancel();
    },
    [cancel],
  );

  const onClickCapture = useCallback((event: React.MouseEvent<HTMLElement>) => {
    if (!fired.current) return;
    fired.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event) => event.preventDefault(),
    onClickCapture,
  };
}
