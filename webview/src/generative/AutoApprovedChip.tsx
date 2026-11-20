import { Check } from 'lucide-react';

import { useTranslation } from '@/i18n';
import type { AiAutoApprovedArgs } from '@/realtime/aiEvents';

/**
 * A gated call that ran without asking (`ai.action.auto_approved`): the person
 * allowed the tool earlier ("Always allow" / "Allow for this session"), so there
 * was no card. One quiet line in its place — the same words as the web client and
 * the native screen — because an action taken on someone's behalf with nobody
 * asked is exactly the kind they must be able to see happened.
 *
 * Live-only: history keeps the call, not the fact that it was not asked about.
 */
export function AutoApprovedChip({ summary }: AiAutoApprovedArgs) {
  const { t } = useTranslation();
  return (
    <div className="my-1 flex">
      <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[0.75rem] leading-4 text-label-secondary">
        <Check size={14} strokeWidth={2.25} className="shrink-0 text-primary" aria-hidden />
        <span className="truncate">{t('autoApproved.label', { summary })}</span>
      </span>
    </div>
  );
}
