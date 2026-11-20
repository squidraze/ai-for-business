import type { LucideIcon } from 'lucide-react';
import { LoaderCircle } from 'lucide-react';
import clsx from 'clsx';

/**
 * Every call-to-action in the WebView goes through this file — the web mirror of
 * `packages/ui/shared/PrimaryButton.tsx`. Press feedback is scale + opacity on
 * `:active` only: this surface is a phone screen, so a hover-only affordance
 * would never fire.
 */

const PRESS = 'transition-[transform,opacity,background-color] duration-100 ease-out';

export type IconButtonProps = {
  icon: LucideIcon;
  onPress: () => void;
  /** Required: the button has no text, so this is its accessible name. */
  label: string;
  disabled?: boolean;
  variant?: 'muted' | 'primary' | 'primary-disabled';
  /** Diameter in px. 36 is the composer size from Figma. */
  size?: number;
  /** Layout only — margins, `shrink-0`, etc. Not fills. */
  className?: string;
};

const ICON_VARIANTS = {
  muted: 'bg-surface-muted text-label-secondary',
  primary: 'bg-primary text-on-primary',
  'primary-disabled': 'bg-primary-disabled text-on-primary',
} as const;

/** Round icon button (composer attach / mic / send). */
export function IconButton({
  icon: Icon,
  onPress,
  label,
  disabled = false,
  variant = 'muted',
  size = 36,
  className,
}: IconButtonProps) {
  // The Figma send button is the disabled blue when it cannot be pressed, so a
  // disabled `primary` resolves to that step rather than a dimmed brand fill.
  const resolved = disabled && variant === 'primary' ? 'primary-disabled' : variant;

  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      style={{ width: size, height: size }}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full',
        ICON_VARIANTS[resolved],
        PRESS,
        disabled ? 'cursor-default' : 'active:scale-90 active:opacity-80',
        resolved === 'muted' && disabled && 'opacity-50',
        className,
      )}
    >
      {/* lucide inherits `currentColor`, so the variant class carries the tint. */}
      <Icon size={Math.round(size * 0.56)} strokeWidth={2} aria-hidden />
    </button>
  );
}

export type PrimaryButtonProps = {
  children: React.ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  /** `destructive` is the confirm of something that cannot be undone (a delete). */
  variant?: 'primary' | 'neutral' | 'destructive';
  /**
   * `default` is the screen CTA. `compact` is the retry inside a state message
   * — 12px radius, semibold label, 18px glyph — which is a preset rather than a
   * one-off because that is exactly the button
   * `packages/ui/shared/StateMessage.tsx` draws, and the two must not drift.
   */
  size?: 'default' | 'compact';
  icon?: LucideIcon;
  /** Layout only — `w-full`, margins. Not fills. */
  className?: string;
};

const BUTTON_VARIANTS = {
  primary: 'bg-primary text-on-primary',
  neutral: 'bg-surface-muted text-label border border-border',
  // `danger-solid`, not `danger`: the text step lightens in dark mode, and a fill
  // under white text must not.
  destructive: 'bg-danger-solid text-on-primary',
} as const;

const BUTTON_SIZES = {
  default: { shape: 'h-11 rounded-card px-5 text-sm font-medium', icon: 20 },
  compact: { shape: 'rounded-xl px-5 py-2.5 text-sm font-semibold', icon: 18 },
} as const;

/** Filled CTA. Disabled keeps the fill and dims the whole button; loading keeps
 *  the fill at full strength and swaps the label for a spinner. Both block taps. */
export function PrimaryButton({
  children,
  onPress,
  disabled = false,
  loading = false,
  variant = 'primary',
  size = 'default',
  icon: Icon,
  className,
}: PrimaryButtonProps) {
  const blocked = disabled || loading;
  const metrics = BUTTON_SIZES[size];

  return (
    <button
      type="button"
      disabled={blocked}
      aria-busy={loading || undefined}
      onClick={onPress}
      className={clsx(
        'inline-flex items-center justify-center gap-2',
        metrics.shape,
        BUTTON_VARIANTS[variant],
        PRESS,
        disabled && !loading && 'opacity-50',
        blocked ? 'cursor-default' : 'active:scale-[0.97] active:opacity-85',
        className,
      )}
    >
      {loading ? (
        <LoaderCircle size={metrics.icon} className="animate-spin" aria-hidden />
      ) : (
        <>
          {Icon ? <Icon size={metrics.icon} strokeWidth={2} aria-hidden /> : null}
          {children}
        </>
      )}
    </button>
  );
}
