import { Check, TriangleAlert, Workflow } from 'lucide-react';
import clsx from 'clsx';
import type { ParseKeys } from 'i18next';

import { useTranslation } from '@/i18n';
import type { AiDelegationArgs, DelegationStatus } from '@/realtime/aiEvents';

/**
 * The model handing work to a subagent (`ai.tool_call` for the `task` tool).
 *
 * A delegation is the one tool call worth drawing besides a generated view: it
 * is where the model stops talking and waits, sometimes for a long time, and
 * without a card the turn looks stalled. The args say who took the work and what
 * it was asked for — `{ subagent_type, description }` — and both are shown, so
 * "it went quiet" becomes "code-runner is building the report".
 *
 * **It has exactly two states, because the stream has exactly two events.**
 * Whatever the subagent does inside — running code, reading and writing files —
 * is opaque to this channel by design; the `ai.tool_call` and its matching
 * `ai.tool_result` are the whole lifecycle. So this is pending → resolved, never
 * a step list, and nothing here waits for progress that is not coming.
 *
 * `failed` is not the subagent's own verdict — nothing on the wire says whether
 * a tool succeeded (see `looksLikeToolFailure`). It means the result read as a
 * failure, or the run ended without the result ever arriving, which the client
 * settles rather than leaving the card spinning forever.
 */
export type DelegationCardProps = AiDelegationArgs;

const STATUS_TEXT: Record<DelegationStatus, ParseKeys<'chat'>> = {
  running: 'delegation.status.running',
  done: 'delegation.status.done',
  failed: 'delegation.status.failed',
};

export function DelegationCard({ subagentType, description, status }: DelegationCardProps) {
  const running = status === 'running';
  const failed = status === 'failed';
  const { t } = useTranslation();
  const title = subagentType
    ? t('delegation.title', { agent: subagentType })
    : t('delegation.titleUnnamed');

  return (
    <div className="my-1 flex w-full items-center gap-3 rounded-card bg-surface px-4 py-3">
      <span
        className={clsx(
          'flex size-9 shrink-0 items-center justify-center rounded-xl',
          failed ? 'bg-danger-tint text-danger' : 'bg-primary/10 text-primary',
        )}
      >
        {failed ? (
          <TriangleAlert size={18} strokeWidth={2} aria-hidden />
        ) : status === 'done' ? (
          <Check size={18} strokeWidth={2.5} aria-hidden />
        ) : (
          <Workflow size={18} strokeWidth={2} aria-hidden />
        )}
      </span>

      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[0.9375rem] leading-5 font-semibold text-label">
          {title}
        </span>
        {/* The model's own words for the job. Clamped: a description can run to a
            paragraph, and this is a status line, not the answer. */}
        {description ? (
          <span className="line-clamp-2 text-[0.8125rem] leading-[1.125rem] text-label-secondary">
            {description}
          </span>
        ) : null}
        <span className="flex items-center gap-1.5 pt-0.5 text-[0.75rem] leading-4 text-label-tertiary">
          {running ? (
            <span
              aria-hidden
              className="rooler-typing-dot size-1.5 shrink-0 rounded-full bg-label-tertiary"
            />
          ) : null}
          {t(STATUS_TEXT[status])}
        </span>
      </span>
    </div>
  );
}
