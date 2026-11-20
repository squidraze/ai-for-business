import clsx from 'clsx';

import { useTranslation } from '@/i18n';

/**
 * "The assistant is working": three dots, and nothing else — the same indicator
 * the native chat draws (`ChatScreen/components/TypingIndicator.tsx`).
 *
 * 8px dots, 6px apart, each looping 0.3 -> 1 -> 0.3 over 400ms per half and
 * started 150ms after the one before it, so the three read as a wave. It sits
 * exactly where the reply text will appear (no padding of its own beyond the
 * row's), so nothing moves sideways when the first token lands.
 *
 * Shown only while an assistant turn is `streaming` with no content yet; the
 * caller (`AssistantMessage`) owns the fade in and out.
 */

/** RN: `withDelay(0 | 150 | 300, …)`. */
const DOT_DELAYS_MS = [0, 150, 300];

export function TypingIndicator({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={clsx('flex items-center gap-1.5 py-1', className)}
      role="status"
      aria-label={t('reply.typing')}
    >
      {DOT_DELAYS_MS.map((delay) => (
        <span
          key={delay}
          aria-hidden
          className="rooler-typing-dot h-2 w-2 rounded-full bg-label-tertiary"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}
