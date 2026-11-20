import type { LucideIcon } from 'lucide-react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import clsx from 'clsx';

import { send } from '@/bridge/bridge';
import { useTranslation } from '@/i18n';

import { PrimaryButton } from './Button';

/**
 * The only error / empty UI in this app — a faithful web port of
 * `packages/ui/shared/StateMessage.tsx`, the one the rest of the Expo app uses.
 * If you catch yourself writing `<p className="text-danger">Failed to load…</p>`
 * somewhere else, stop and use `ErrorState`. "Nothing here" and "failed to load"
 * are different states and get different components (CLAUDE.md, "Query-backed
 * screens").
 *
 * **One presentation, deliberately.** There is no compact/inline variant: this
 * WebView is a screen of the same app, and a failure inside it has to look like
 * a failure anywhere else in it — the same 80px disc, the same 16px semibold
 * title, the same 14px prose, the same 12px-radius retry. The native
 * `AssistantMessage` renders exactly this component inside the transcript for a
 * failed turn, so a transcript-sized variant here would be a second error
 * language for one app.
 *
 * The one intentional difference from the native component is
 * **`showBackButton`**, which is absent. It exists there for a full-screen
 * failure on a screen whose own header went down with it; here the header is
 * native and lives *above* the WebView, so it never goes down with the page and
 * there is nowhere for a back button in here to go.
 *
 * Every retry also confirms by touch, the same as the composer's buttons and the
 * native orbs (`hapticTap` lives inside `IconOrbButton`) — a retry is a tap the
 * user is not sure worked until something changes on screen, and a refetch often
 * changes nothing for a second or two.
 */

/** Wrap a state action so it confirms by touch before it runs. */
const tapped = (action: () => void) => () => {
  send('haptic', { style: 'tap' });
  action();
};

export type StateMessageProps = {
  /**
   * Leading illustration — already sized and tinted by the caller, exactly like
   * the native component's `icon: React.ReactNode`. `ErrorState` passes its red
   * disc, `EmptyState` a 48px muted glyph.
   */
  icon?: React.ReactNode;
  title: string;
  description?: string;
  /** Renders a "Try again" button below the message. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Fill the available space and centre vertically. */
  fullScreen?: boolean;
};

/** Centred icon + title + optional description, shared by empty and error states. */
export function StateMessage({
  icon,
  title,
  description,
  onRetry,
  retryLabel,
  fullScreen = false,
}: StateMessageProps) {
  const { t } = useTranslation();
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center px-6 text-center',
        fullScreen ? 'min-h-0 flex-1' : 'py-10',
      )}
    >
      {icon}
      <p className={clsx('text-base font-semibold text-label', icon && 'mt-4')}>{title}</p>
      {description ? <p className="mt-1 text-sm text-label-secondary">{description}</p> : null}
      {onRetry ? (
        <PrimaryButton
          className="mt-4"
          size="compact"
          icon={RefreshCw}
          onPress={tapped(onRetry)}
        >
          {retryLabel ?? t('common.tryAgain')}
        </PrimaryButton>
      ) : null}
    </div>
  );
}

/**
 * Unified error state: a warning glyph in a soft red circle, a title, the error
 * message and an optional retry. Always wire `onRetry` to the real refetch.
 */
export function ErrorState({
  message,
  title,
  onRetry,
  retryLabel,
  fullScreen = false,
}: {
  message: string;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  fullScreen?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={clsx(
        'flex flex-col',
        // The native full-screen error paints its own ground (`bg-gray-50` /
        // `bg-zinc-900`) so a failed screen reads as a surface rather than as a
        // hole; `--color-screen` is that same step here.
        fullScreen && 'min-h-0 flex-1 bg-screen',
      )}
    >
      <StateMessage
        fullScreen={fullScreen}
        icon={
          // The disc and the glyph are `danger-surface` / `danger-solid`, not
          // `danger-tint` / `danger`: the alarm red is the same #ef4444 in both
          // themes (the native component hardcodes it), while `--color-danger`
          // lightens in dark so it stays legible as *text*.
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-danger-surface">
            <TriangleAlert size={40} strokeWidth={1.75} className="text-danger-solid" aria-hidden />
          </div>
        }
        title={title ?? t('errors.loadFailedTitle')}
        description={message}
        onRetry={onRetry}
        retryLabel={retryLabel}
      />
    </div>
  );
}

/**
 * Unified empty state: a muted icon, a title and an optional description. Pass
 * the Lucide icon *component* — the size (48) and the muted tint are
 * standardised here so every empty state looks identical. Keep the per-feature
 * semantic icon: the point is one layout, many icons.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  onAction,
  actionLabel,
  fullScreen = false,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  onAction?: () => void;
  actionLabel?: string;
  fullScreen?: boolean;
}) {
  return (
    <StateMessage
      fullScreen={fullScreen}
      icon={Icon ? <Icon size={48} strokeWidth={1.5} className="text-icon-muted" aria-hidden /> : undefined}
      title={title}
      description={description}
      onRetry={onAction}
      retryLabel={actionLabel}
    />
  );
}
