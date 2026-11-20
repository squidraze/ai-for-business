import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Check, Info, X } from 'lucide-react';
import clsx from 'clsx';

import { useEnterExit } from './useEnterExit';

/**
 * Transient feedback for things that have no screen of their own — a failed
 * send, a copied message. Anything with a retry belongs in `ErrorState`, not
 * here: a toast disappears, and an error the user must act on must not.
 *
 * Anchored above the composer via `--toast-offset` (a host/layout knob, default
 * 88px) so it never covers the input, and above `--inset-bottom` so it clears
 * the gesture bar.
 *
 * The motion is the native `animated-toast`'s, expressed in CSS: it arrives on a
 * spring (an overshooting cubic-bezier — there is no physics engine here and the
 * difference at 320ms is not visible), and a stack of them offsets 4px and
 * scales 0.98 per toast underneath so several read as a deck rather than as a
 * list. It also carries the type glyph the native one has, which is the only
 * thing that distinguishes an error from a confirmation at a glance while the
 * user is looking somewhere else on the screen.
 */

type ToastType = 'error' | 'info' | 'success';

type ToastOptions = { type?: ToastType; duration?: number };

type Toast = { id: number; message: string; type: ToastType; leaving: boolean };

const DEFAULT_DURATION = 3500;
/** Kept in sync with the transition below — JS drives the removal. */
const EXIT_MS = 200;
/** Long enough for the overshoot to read, short enough not to delay the message. */
const ENTER_MS = 320;
/** Per-toast stacking, from the native `ToastItem`. */
const STACK_OFFSET_PX = 4;
const STACK_OFFSET_MAX_PX = 12;
const STACK_SCALE_STEP = 0.02;
const STACK_SCALE_MIN = 0.92;

const ToastContext = createContext<{ show: (message: string, options?: ToastOptions) => void } | null>(null);

const TOAST_STYLES: Record<ToastType, string> = {
  error: 'bg-danger text-on-primary',
  success: 'bg-success text-on-primary',
  info: 'bg-surface text-label border border-border',
};

/** The native toast's `✗ / ✓ / ℹ`, as the icons the rest of this app draws. */
const TOAST_ICONS = {
  error: X,
  success: Check,
  info: Info,
} as const;

/**
 * One toast. A component of its own because the entrance needs two committed
 * frames (`useEnterExit`) and a provider-level `map` cannot give each row its
 * own — they would all animate on whichever render the newest one triggered.
 */
function ToastItem({
  toast,
  depth,
  onDismiss,
}: {
  toast: Toast;
  /** How many toasts sit above this one in the stack. 0 is the newest. */
  depth: number;
  onDismiss: () => void;
}) {
  // The provider owns the exit (it needs the timer anyway, to remove the row);
  // this only owns the arrival, so the exit duration passed here is irrelevant.
  const { visible } = useEnterExit(!toast.leaving, EXIT_MS);
  const Icon = TOAST_ICONS[toast.type];

  const offset = Math.min(depth * STACK_OFFSET_PX, STACK_OFFSET_MAX_PX);
  const scale = Math.max(1 - depth * STACK_SCALE_STEP, STACK_SCALE_MIN);

  const resting = `translateY(${offset}px) scale(${scale})`;
  const entering = 'translateY(12px) scale(0.9)';
  const leaving = 'translateY(8px) scale(0.95)';

  return (
    <button
      type="button"
      // Tapping dismisses — the native toast does, and a message the user has
      // already read should not have to be waited out. `pointer-events-auto`
      // because the viewport around it is deliberately transparent to taps.
      onClick={onDismiss}
      className={clsx(
        'pointer-events-auto max-w-full text-left',
        'flex items-center gap-2.5 rounded-card px-4 py-2.5 text-sm font-medium shadow-lg',
        'transition-[opacity,transform]',
        TOAST_STYLES[toast.type],
      )}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? resting : toast.leaving ? leaving : entering,
        transitionDuration: `${toast.leaving ? EXIT_MS : ENTER_MS}ms`,
        // A touch of overshoot on the way in — the CSS reading of the native
        // spring. The exit is plain ease-out: a departing toast that springs
        // draws the eye back to something that is leaving.
        transitionTimingFunction: toast.leaving
          ? 'cubic-bezier(0.4, 0, 1, 1)'
          : 'cubic-bezier(0.34, 1.4, 0.64, 1)',
      }}
    >
      <Icon size={18} strokeWidth={2.5} className="shrink-0" aria-hidden />
      <span className="min-w-0">{toast.message}</span>
    </button>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  // Timers are cleared on unmount so a toast fired right before a screen tears
  // down cannot setState on a dead provider.
  const timers = useRef<number[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach(window.clearTimeout);
      timers.current = [];
    },
    [],
  );

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    timers.current.push(
      window.setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), EXIT_MS),
    );
  }, []);

  const show = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = nextId.current++;
      const type = options?.type ?? 'info';
      setToasts((current) => [...current, { id, message, type, leaving: false }]);

      timers.current.push(
        window.setTimeout(() => dismiss(id), options?.duration ?? DEFAULT_DURATION),
      );
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // `pointer-events-none`: the viewport must never swallow a tap meant for
        // the composer sitting underneath it. The toasts themselves opt back in.
        className="pointer-events-none fixed inset-x-0 z-40 flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(var(--inset-bottom) + var(--toast-offset, 88px))' }}
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast, index) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            // Newest last in the column, so depth counts back from the end.
            depth={toasts.length - 1 - index}
            onDismiss={() => dismiss(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// The provider and its hook are one unit — splitting them across files to please
// fast refresh buys nothing here, since editing this file re-mounts the provider
// (and so the toast stack, which is transient by definition) either way.
// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
