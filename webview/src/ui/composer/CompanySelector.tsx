import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import clsx from 'clsx';

import { send } from '@/bridge/bridge';
import { selectCompany, useCompanies } from '@/chat/companies';
import { useTranslation } from '@/i18n';
import { BottomSheet } from '@/ui/primitives';

/**
 * The composer's company pill, where the model pill used to be.
 *
 * Drawn only while the host has several companies selected ("All companies"):
 * then a new thread has to say which company owns it, and the pill is that
 * choice (see `chat/companies.ts`). In an existing thread the company is the
 * conversation's own, so the pill shows it and cannot be opened. With one
 * company selected there is nothing to say and nothing is drawn.
 */

/** Figma: 36px tall, 12px padding, 6px gap, fully rounded — the model pill's metrics. */
const PILL = 'h-9 rounded-full bg-surface-muted px-3';
const PILL_LABEL =
  'min-w-0 max-w-[160px] truncate text-[0.875rem] leading-[1.375rem] font-medium text-label-secondary';

function CompanyRow({
  label,
  isActive,
  isLast,
  onPress,
}: {
  label: string;
  isActive: boolean;
  isLast: boolean;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-checked={isActive}
      role="menuitemradio"
      onClick={() => {
        send('haptic', { style: 'tap' });
        onPress();
      }}
      className={clsx(
        'flex w-full items-center gap-3 py-4 text-left active:opacity-60',
        !isLast && 'border-b border-border',
      )}
    >
      <span className="min-w-0 flex-1 truncate text-base text-label">{label}</span>
      {isActive ? (
        <Check size={22} strokeWidth={2} className="shrink-0 text-primary" aria-hidden />
      ) : null}
    </button>
  );
}

export function CompanySelector({ isNewThread }: { isNewThread: boolean }) {
  const { choices, selectedId, conversationCompany } = useCompanies();
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const { t } = useTranslation();

  // One company (or an older host that sends none): the header decides.
  if (choices.length < 2) return null;

  if (!isNewThread) {
    // The thread exists, so its company is settled. Shown once known — the
    // record arrives a beat after the history — and never a control.
    if (!conversationCompany) return null;
    return (
      <span
        className={clsx(PILL, 'inline-flex min-w-0 items-center')}
        aria-label={t('company.current', { name: conversationCompany.name })}
      >
        <span className={PILL_LABEL}>{conversationCompany.name || '—'}</span>
      </span>
    );
  }

  const selected = choices.find((c) => c.uuid === selectedId) ?? choices[0];

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isSheetOpen}
        aria-label={t('company.change', { name: selected.name })}
        onClick={() => {
          send('haptic', { style: 'tap' });
          setIsSheetOpen(true);
        }}
        className={clsx(
          PILL,
          'inline-flex min-w-0 items-center gap-1.5 transition-opacity duration-100 active:opacity-70',
        )}
      >
        {/* Truncated, not wrapped: the pill shares one 36px row with the attach
            and send buttons, so a long company name must never grow the row. */}
        <span className={PILL_LABEL}>{selected.name || '—'}</span>
        <ChevronDown size={20} strokeWidth={2} className="shrink-0 text-label-secondary" aria-hidden />
      </button>

      <BottomSheet
        isOpen={isSheetOpen}
        onClose={() => setIsSheetOpen(false)}
        title={t('company.select')}
      >
        {({ close }) => (
          <div className="px-5 pb-6" role="menu" aria-label={t('company.select')}>
            {choices.map((company, index) => (
              <CompanyRow
                key={company.uuid}
                label={company.name || '—'}
                isActive={company.uuid === selected.uuid}
                isLast={index === choices.length - 1}
                onPress={() => {
                  selectCompany(company.uuid);
                  close();
                }}
              />
            ))}
          </div>
        )}
      </BottomSheet>
    </>
  );
}
