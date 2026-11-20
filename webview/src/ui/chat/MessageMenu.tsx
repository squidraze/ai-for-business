import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

import { useTranslation } from '@/i18n';
import { useEnterExit } from '@/ui/primitives';

import { formatMessageTimestamp } from './messageTime';

/**
 * The panel a message opens when it is held down.
 *
 * It carries when the message was sent — a timestamp under every turn is noise on
 * a screen where the whole conversation happened a minute ago, but it still has to
 * be *reachable* — and, under a separator, whatever actions the caller passes for
 * that particular message. Today that is "Edit message" on a user turn the server
 * knows about, and "Delete message" on any turn it knows about; copy and
 * select-text belong here too when they land.
 *
 * The actions come from the caller rather than being built here, because which
 * ones apply is a property of the held message (an assistant turn cannot be
 * edited; nor can a user turn that never reached the server), and this component
 * is deliberately given a rect rather than a message.
 *
 * Hand-rolled, like everything else here — a popover library cannot be added to
 * a single-file bundle under a CSP that blocks external requests, and the whole
 * job is one measurement and one transition.
 *
 * **Anchoring.** The caller hands over the element that was held; the menu is
 * measured before paint (`useLayoutEffect`) and placed under it, flipping above
 * when the bottom of the screen is closer than its own height. It grows out of
 * the corner nearest the message — right for a user bubble, left for a reply —
 * so the animation reads as the message opening rather than a panel arriving.
 */

/** Kept in sync with the transitions below — JS drives the unmount. */
const ENTER_MS = 160;
const EXIT_MS = 120;
/** Breathing room between the menu and the message, and the screen edges. */
const GAP_PX = 8;
const MARGIN_PX = 12;

/** One row under the separator. Selecting it always closes the menu first. */
export type MessageMenuAction = {
  label: string;
  onSelect: () => void;
  /** Draws the row in the destructive colour — "Delete message". */
  destructive?: boolean;
  /**
   * Shown, but not pressable — for an action that exists for this message and
   * cannot run *right now* (a delete while a reply is being written). Hiding it
   * would make the row look absent rather than waiting.
   */
  disabled?: boolean;
};

export type MessageMenuTarget = {
  /** Where the held message is, in viewport coordinates. */
  rect: DOMRect;
  /** ISO timestamp of the held message. */
  createdAt: string;
  /** Which edge the message sits on — the menu lines up with it. */
  align: 'start' | 'end';
  /** What this particular message can do. Omitted ⇒ the timestamp alone. */
  actions?: MessageMenuAction[];
};

export type MessageMenuProps = {
  target: MessageMenuTarget;
  /** Called once the close animation has finished — unmount here. */
  onClose: () => void;
};

type Placement = { left: number; top: number; origin: string };

export function MessageMenu({ target, onClose }: MessageMenuProps) {
  const [open, setOpen] = useState(true);
  const { visible } = useEnterExit(open, EXIT_MS);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  const close = useCallback(() => {
    setOpen(false);
    window.setTimeout(onClose, EXIT_MS);
  }, [onClose]);

  // Before paint, so the menu never shows up in the wrong place for a frame.
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;

    const { rect, align } = target;
    const width = element.offsetWidth;
    const height = element.offsetHeight;

    const root = document.documentElement;
    const readInset = (name: string): number =>
      Number.parseFloat(getComputedStyle(root).getPropertyValue(name)) || 0;
    const insetTop = readInset('--inset-top');
    const insetBottom = readInset('--inset-bottom');

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const below = rect.bottom + GAP_PX;
    const flips = below + height > viewportHeight - insetBottom - MARGIN_PX;
    const top = flips ? rect.top - GAP_PX - height : below;

    const preferred = align === 'end' ? rect.right - width : rect.left;

    setPlacement({
      left: Math.min(Math.max(preferred, MARGIN_PX), viewportWidth - MARGIN_PX - width),
      top: Math.min(
        Math.max(top, insetTop + MARGIN_PX),
        viewportHeight - insetBottom - MARGIN_PX - height,
      ),
      // Grow from the corner nearest the message.
      origin: `${flips ? 'bottom' : 'top'} ${align === 'end' ? 'right' : 'left'}`,
    });
  }, [target]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [close]);

  return createPortal(
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label={t('message.actions')}
    >
      {/* `touch-none` so a drag on the scrim cannot scroll the transcript that is
          still live underneath, and a tap anywhere dismisses. */}
      <div
        onPointerDown={close}
        className="absolute inset-0 touch-none transition-opacity ease-out"
        style={{
          backgroundColor: 'var(--color-overlay-menu)',
          opacity: visible ? 1 : 0,
          transitionDuration: `${visible ? ENTER_MS : EXIT_MS}ms`,
        }}
      />

      <div
        ref={menuRef}
        className="absolute min-w-[13.75rem] overflow-hidden rounded-card bg-surface py-1 shadow-xl transition-[opacity,transform]"
        style={{
          left: placement?.left ?? 0,
          top: placement?.top ?? 0,
          transformOrigin: placement?.origin ?? 'top left',
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1)' : 'scale(0.92)',
          transitionDuration: `${visible ? ENTER_MS : EXIT_MS}ms`,
          // A touch of overshoot on the way in; the exit stays plain, because a
          // panel that springs while leaving pulls the eye back to it.
          transitionTimingFunction: visible
            ? 'cubic-bezier(0.34, 1.4, 0.64, 1)'
            : 'cubic-bezier(0.4, 0, 1, 1)',
          // Hidden until measured — one frame at the wrong coordinates is a jump.
          visibility: placement ? 'visible' : 'hidden',
        }}
      >
        <p className="px-4 py-2 text-[0.8125rem] leading-[1.125rem] text-label-tertiary">
          {formatMessageTimestamp(target.createdAt)}
        </p>

        {target.actions?.length ? (
          <ul className="border-t border-border pt-1">
            {target.actions.map((action) => (
              <li key={action.label}>
                <button
                  type="button"
                  disabled={action.disabled}
                  // Close first, then act: the action replaces what is under the
                  // menu (an edit swaps the bubble for a field), and running it
                  // while the panel is still up hides the thing it just changed.
                  onClick={() => {
                    close();
                    window.setTimeout(action.onSelect, EXIT_MS);
                  }}
                  className={clsx(
                    'w-full px-4 py-2.5 text-left text-[0.9375rem] leading-5',
                    action.destructive ? 'text-danger' : 'text-label',
                    action.disabled ? 'cursor-default opacity-40' : 'active:bg-surface-muted',
                  )}
                >
                  {action.label}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
