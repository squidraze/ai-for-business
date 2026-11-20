import { ChevronLeft, Plug } from 'lucide-react';
import clsx from 'clsx';
import { useEffect } from 'react';

import { loadConnectors, toggleConnector, useConnectors } from '@/chat/connectors';
import { send } from '@/bridge/bridge';
import { useTranslation } from '@/i18n';
import { getErrorMessage } from '@/lib/api/errors';
import { EmptyState, ErrorState, Skeleton, useToast } from '@/ui/primitives';

/**
 * The Connectors page of the "+" sheet — one switch per connected app, and the
 * way to the host's Integrations sheet. The rules live in `chat/connectors.ts`;
 * this only draws them, loading → error → empty → data.
 */
export function ConnectorsPanel({
  onBack,
  onManage,
}: {
  onBack: () => void;
  /** Close the sheet, then open the host's Integrations sheet. */
  onManage: () => void;
}) {
  const { status, error, connectors, saving } = useConnectors();
  const { show } = useToast();
  const { t } = useTranslation();

  // Fresh every time the page opens — see `loadConnectors`.
  useEffect(() => {
    void loadConnectors();
  }, []);

  const flip = (id: string, on: boolean) => {
    send('haptic', { style: 'tap' });
    void toggleConnector(id, on).catch((cause: unknown) =>
      show(getErrorMessage(cause, t('connectors.toggleFailed')), { type: 'error' }),
    );
  };

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onBack}
        aria-label={t('common.back')}
        className="flex items-center gap-1 self-start py-2 text-[0.9375rem] font-medium text-label-secondary active:opacity-60"
      >
        <ChevronLeft size={20} aria-hidden />
        {t('connectors.title')}
      </button>

      {status === 'idle' || status === 'loading' ? (
        <div className="flex flex-col">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center justify-between border-b border-border py-4">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-6 w-10 rounded-full" />
            </div>
          ))}
        </div>
      ) : status === 'error' ? (
        <ErrorState
          message={getErrorMessage(error, t('connectors.loadFailed'))}
          onRetry={() => void loadConnectors()}
        />
      ) : connectors.length === 0 ? (
        <EmptyState
          icon={Plug}
          title={t('connectors.emptyTitle')}
          description={t('connectors.emptyDescription')}
          actionLabel={t('connectors.add')}
          onAction={onManage}
        />
      ) : (
        <>
          <p className="pt-1 pb-2 text-[0.8125rem] leading-[1.125rem] text-label-tertiary">
            {t('connectors.subtitle')}
          </p>
          {connectors.map((connector) => (
            <label
              key={connector.id}
              className="flex items-center justify-between gap-3 border-b border-border py-3.5"
            >
              <span className="min-w-0 flex-1 truncate text-base text-label">{connector.name}</span>
              <Switch
                checked={connector.enabled}
                disabled={saving}
                label={connector.name}
                onChange={(on) => flip(connector.id, on)}
              />
            </label>
          ))}
          <button
            type="button"
            onClick={onManage}
            className="self-start py-4 text-[0.9375rem] font-medium text-primary active:opacity-60"
          >
            {t('connectors.manage')}
          </button>
        </>
      )}
    </div>
  );
}

/** An iOS-style switch on the brand fill — the native screen's `Switch`, drawn. */
function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200',
        checked ? 'bg-primary' : 'bg-surface-muted',
        disabled && 'opacity-60',
      )}
    >
      <span
        aria-hidden
        className={clsx(
          'absolute top-[2px] left-[2px] size-[27px] rounded-full bg-white shadow transition-transform duration-200',
          checked && 'translate-x-5',
        )}
      />
    </button>
  );
}
