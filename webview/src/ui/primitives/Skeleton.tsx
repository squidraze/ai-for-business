import clsx from 'clsx';

import { useTranslation } from '@/i18n';

/**
 * Async content loads behind a skeleton, never a spinner — see CLAUDE.md
 * "Loading state". A skeleton must mirror the real layout it replaces so nothing
 * jumps when the data arrives; a spinner is only right for in-place feedback on
 * an action (a button, pull-to-refresh).
 *
 * The pulse is `rooler-pulse` (700ms each way) rather than Tailwind's
 * `animate-pulse` (a 2s cycle): the native host draws its *own* skeleton over
 * this WebView until the page posts `ready`, so for the first moments of every
 * cold start the two are on screen one after the other. Two different breathing
 * rates there read as two different apps.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  /** Only for a width a class cannot carry — a percentage computed by the caller. */
  style?: React.CSSProperties;
}) {
  return (
    <div aria-hidden style={style} className={clsx('rooler-pulse rounded-md bg-skeleton', className)} />
  );
}

/**
 * One assistant turn: a full-width text block, same padding as a real message.
 * `px-[14px]` is the transcript's own inset (MessageList) — 16px here shifted
 * every row by 2px the moment the history landed, which is the exact jump a
 * skeleton exists to prevent.
 */
function AssistantBlock({ widths }: { widths: string[] }) {
  return (
    <div className="flex flex-col gap-2.5">
      {widths.map((width, i) => (
        <Skeleton key={i} className="h-4" style={{ width }} />
      ))}
    </div>
  );
}

/** One user turn: a right-aligned bubble at the real bubble radius. */
function UserBubble({ width }: { width: string }) {
  return (
    <div className="flex justify-end">
      <Skeleton className="h-10 rounded-bubble" style={{ width }} />
    </div>
  );
}

/**
 * Transcript placeholder: alternating assistant text and user bubbles.
 *
 * Bottom-aligned, and in that order, because the native `ChatSkeleton` is
 * (`justify-end`, assistant first). The host paints that one over this WebView
 * until the page is ready, so an inverted, top-aligned placeholder here made the
 * boot look like two different loading screens handing over. The line widths are
 * the native ones too.
 */
export function ChatSkeleton() {
  const { t } = useTranslation();
  return (
    <div
      className="flex min-h-full flex-1 flex-col justify-end gap-5 px-[14px] py-4"
      role="status"
      aria-label={t('chat.loading')}
    >
      <AssistantBlock widths={['92%', '98%', '64%']} />
      <UserBubble width="60%" />
      <AssistantBlock widths={['88%', '72%']} />
      <UserBubble width="45%" />
    </div>
  );
}
