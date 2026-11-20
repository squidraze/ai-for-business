import { Ban, CheckCircle2, ChevronDown, Clock, LoaderCircle, Wrench, XCircle } from 'lucide-react';
import clsx from 'clsx';
import type { ParseKeys } from 'i18next';
import { memo, useState, type ComponentType } from 'react';

import { toolCardName } from '@/chat/toolCalls';
import type { ToolCallRecord, ToolCallStatus } from '@/chat/types';
import { useTranslation } from '@/i18n';
import { isVerbose } from '@/lib/verbose';
import { Fade } from '@/ui/primitives';

/**
 * One reply's tool calls folded into a single line — "Used 3 tools" — the way the
 * web client shows the agent's work (Figma 4769:96468): collapsed by default,
 * "Using 2 tools…" with a spinner while the reply runs, and a card per call
 * inside for whoever wants to see what was called with what.
 *
 * A call waiting on approval is in here too, as "Awaiting approval", but its
 * decision lives on the approval card below — this line only reports.
 */
export type ToolCallsGroupProps = {
  calls: ToolCallRecord[];
  /** The reply is still streaming — the line counts up and spins. */
  live: boolean;
};

function ToolCallsGroupBase({ calls, live }: ToolCallsGroupProps) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  if (calls.length === 0) return null;
  const running = live && calls.some((call) => call.status === 'running');

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1.5 py-1 pr-1 text-left text-[0.875rem] leading-5 font-medium text-label-secondary active:opacity-70"
      >
        {running ? (
          <LoaderCircle size={16} className="shrink-0 animate-spin" aria-hidden />
        ) : (
          <Wrench size={16} className="shrink-0" aria-hidden />
        )}
        <span>
          {running
            ? t('toolCalls.using', { count: calls.length })
            : t('toolCalls.used', { count: calls.length })}
        </span>
        <ChevronDown
          size={16}
          aria-hidden
          className={clsx('shrink-0 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {open ? (
        <Fade enterMs={200} className="flex flex-col gap-2 pt-1">
          {calls.map((call) => (
            <ToolCallCard key={call.id} call={call} />
          ))}
        </Fade>
      ) : null}
    </div>
  );
}

export const ToolCallsGroup = memo(ToolCallsGroupBase);

/* ---------------------------------------------------------------- */
/* One call                                                          */
/* ---------------------------------------------------------------- */

const STATUS: Record<
  ToolCallStatus,
  {
    label: ParseKeys<'chat'>;
    className: string;
    icon: ComponentType<{ size?: number; className?: string }>;
  }
> = {
  // "Pending" takes the neutral colour and a clock, not the design's green: a
  // call that is still running must not read as done.
  running: { label: 'toolCalls.status.running', className: 'text-label-secondary', icon: Clock },
  done: { label: 'toolCalls.status.done', className: 'text-success', icon: CheckCircle2 },
  awaiting: { label: 'toolCalls.status.awaiting', className: 'text-warning', icon: Clock },
  error: { label: 'toolCalls.status.error', className: 'text-danger', icon: XCircle },
  denied: { label: 'toolCalls.status.denied', className: 'text-danger', icon: Ban },
};

/**
 * The backend fences tool output in `<untrusted-data …>` for the model — a
 * prompt-injection guard that means nothing to a person reading it.
 */
function stripUntrustedMarkers(text: string): string {
  return text
    .replace(/<\/?untrusted-data\b[^>]*>/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function Section({ label, value, wrap }: { label: string; value: unknown; wrap?: boolean }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.8125rem] leading-5 font-medium text-label-secondary">{label}</span>
      <pre
        className={clsx(
          'selectable max-h-64 overflow-auto rounded-xl border border-border bg-surface-muted px-3 py-2 text-[0.8125rem] leading-5 text-label',
          wrap ? 'whitespace-pre-wrap break-words' : 'whitespace-pre',
        )}
      >
        {text}
      </pre>
    </div>
  );
}

function ToolCallCard({ call }: { call: ToolCallRecord }) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  const { label, className, icon: Icon } = STATUS[call.status];
  // The raw result is the model's context, not the user's: debug builds only,
  // exactly as on the web.
  const showResult = isVerbose() && call.result !== undefined;

  return (
    <div className="w-full overflow-hidden rounded-[14px] border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-3 text-left active:opacity-70"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Wrench size={18} className="shrink-0 text-label" aria-hidden />
          <span className="truncate text-[0.875rem] leading-5 font-medium text-label">
            {toolCardName(call.tool, call.args)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span
            className={clsx(
              'flex h-6 items-center gap-1 rounded-lg border border-border bg-surface px-1.5 text-[0.75rem] leading-[18px] font-medium',
              className,
            )}
          >
            {t(label)}
            <Icon size={14} className="shrink-0" />
          </span>
          <ChevronDown
            size={18}
            aria-hidden
            className={clsx(
              'shrink-0 text-label transition-transform duration-200',
              open && 'rotate-180',
            )}
          />
        </span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 px-3 pb-3">
          <Section label={t('toolCalls.parameters')} value={call.args} />
          {showResult ? (
            <Section
              label={t('toolCalls.result')}
              value={stripUntrustedMarkers(call.result ?? '')} wrap />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
