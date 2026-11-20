import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

/**
 * The web mirror of `packages/ui/shared/SwipeableBottomSheet.tsx`: every drawer,
 * picker and confirm in this app is this component, so gestures, backdrop and
 * safe-area handling are identical everywhere.
 *
 * The parent owns `isOpen` and unmounts the sheet in `onClose`; `close()` from
 * the render-prop plays the slide-out first, so a Cancel button animates the
 * same way a backdrop tap does.
 */

/** Kept in sync with the transition below — JS drives the unmount. */
const ANIM_MS = 260;
/** Drag distance (px) / fling velocity (px per ms) past which the sheet dismisses. */
const CLOSE_DISTANCE = 110;
const CLOSE_VELOCITY = 0.5;

export type BottomSheetProps = {
  isOpen: boolean;
  /** Called once the slide-out finishes — unmount / flip `isOpen` here. */
  onClose: () => void;
  title?: string;
  /** Open at (almost) full height instead of sizing to the content. */
  fullHeight?: boolean;
  children: React.ReactNode | ((api: { close: () => void }) => React.ReactNode);
};

export function BottomSheet({
  isOpen,
  onClose,
  title,
  fullHeight = false,
  children,
}: BottomSheetProps) {
  // `mounted` outlives `isOpen` by one animation so the sheet has an exit at all
  // — React would otherwise rip it out of the tree on the same frame.
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);

  // Adjusting state while rendering, not in an effect: the mount must land in
  // the same commit as the prop flip, or the sheet paints one frame late.
  const [lastOpen, setLastOpen] = useState(isOpen);
  if (lastOpen !== isOpen) {
    setLastOpen(isOpen);
    setVisible(false);
    if (isOpen) {
      setMounted(true);
      setDragY(0);
    }
  }

  // Two frames: the sheet must paint at translateY(100%) before we flip it to 0,
  // or the browser collapses both states into one and there is no transition.
  useEffect(() => {
    if (!mounted || !isOpen) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setVisible(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [mounted, isOpen]);

  useEffect(() => {
    if (isOpen || !mounted) return;
    const timer = window.setTimeout(() => setMounted(false), ANIM_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen, mounted]);

  const close = useCallback(() => {
    // `visible` doubles as the re-entrancy guard: a second backdrop tap during
    // the slide-out must not queue a second `onClose`.
    if (!visible) return;
    setDragging(false);
    setVisible(false);
    window.setTimeout(onClose, ANIM_MS);
  }, [visible, onClose]);

  // Body scroll lock: without it the page behind scrolls under the sheet, and in
  // a WebView that rubber-band does not always come back on its own.
  useEffect(() => {
    if (!mounted) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mounted, close]);

  // Drag-to-dismiss lives on the handle only, so a scrollable body keeps every
  // vertical drag of its own — no gesture arbitration needed.
  const drag = useRef({ startY: 0, lastY: 0, lastT: 0, velocity: 0 });

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      startY: event.clientY,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
    };
    setDragging(true);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const dt = event.timeStamp - drag.current.lastT;
    if (dt > 0) drag.current.velocity = (event.clientY - drag.current.lastY) / dt;
    drag.current.lastY = event.clientY;
    drag.current.lastT = event.timeStamp;
    // Downwards only — an upward drag must not lift the sheet off its anchor.
    setDragY(Math.max(0, event.clientY - drag.current.startY));
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    const travelled = Math.max(0, event.clientY - drag.current.startY);
    if (travelled > CLOSE_DISTANCE || drag.current.velocity > CLOSE_VELOCITY) close();
    else setDragY(0);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className={clsx(
        'fixed inset-0 z-50 flex flex-col justify-end',
        // Once it is on its way out it must stop swallowing taps meant for the
        // screen behind it, which is still live for the length of the animation.
        !visible && 'pointer-events-none',
      )}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        onClick={close}
        className={clsx(
          'absolute inset-0 transition-opacity duration-[260ms] ease-out',
          visible ? 'opacity-100' : 'opacity-0',
        )}
        style={{ backgroundColor: 'var(--color-overlay)' }}
      />

      <div
        className={clsx(
          'relative flex w-full flex-col overflow-hidden rounded-t-[24px] bg-surface',
          fullHeight ? 'h-[92dvh]' : 'max-h-[88dvh]',
        )}
        style={{
          transform: visible ? `translateY(${dragY}px)` : 'translateY(100%)',
          transition: dragging ? 'none' : `transform ${ANIM_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`,
          // The keyboard inset is pushed in by the native host; env(safe-area-*)
          // is not reliable in a WebView, so both come from CSS variables.
          paddingBottom: 'calc(var(--inset-bottom) + var(--inset-keyboard))',
        }}
      >
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          // `touch-none`: the handle must own the drag, not the WebView's scroll.
          className="shrink-0 touch-none pt-2.5 pb-1"
        >
          <div className="mx-auto h-1 w-10 rounded-full bg-border" />
        </div>

        {title ? (
          <div className="shrink-0 px-5 pt-2 pb-3">
            <h2 className="text-base font-semibold text-label">{title}</h2>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {typeof children === 'function' ? children({ close }) : children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
