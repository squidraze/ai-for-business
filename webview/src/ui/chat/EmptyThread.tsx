import clsx from 'clsx';
import { useEffect, useMemo } from 'react';

import { send } from '@/bridge/bridge';
import { useAccess } from '@/chat/access';
import { loadAttention, shortTimeAgo, useAttention, type AttentionSeverity } from '@/chat/attention';
import { pickChatStarters } from '@/chat/starters';
import { useChatState } from '@/chat/useChat';
import { useTranslation } from '@/i18n';
import { Fade } from '@/ui/primitives';

/**
 * A conversation with no messages yet — the web client's new-thread screen
 * (Figma 4661:90064) on a phone: the greeting, four starter chips chosen for the
 * person's role (`chat/starters.ts`), and under them the "Needs attention" card
 * (`chat/attention.ts`). A chip, or a row of the card, sends its prompt as the
 * first message.
 *
 * This is reached only when the history actually loaded and was empty — a failed
 * load renders `ErrorState` instead (see MessageList). A load error dressed up
 * as a greeting is the exact bug this ordering exists to prevent.
 *
 * **The chips used to be a fixed list duplicated from the native screen**
 * (`insights.suggestions.ts`). They follow the web client now: the same four for
 * the same person, and none for data they cannot read. The native screen keeps
 * its own list until it is retired.
 *
 * **The greeting is sans, deliberately**: this bundle is one self-contained
 * `index.html` under a CSP that blocks every external request, so a webfont would
 * have to be inlined, and the redesign's frames are sans throughout.
 */
export type EmptyThreadProps = {
  /** Send the chip's prompt as the first message. */
  onSelect: (prompt: string) => void;
  /** True while a run is in flight. */
  disabled?: boolean;
};

/** The time's colour says how urgent a row is — the web card's rule. */
const SEVERITY_CLASS: Record<AttentionSeverity, string> = {
  critical: 'text-danger',
  warning: 'text-warning',
  info: 'text-label-secondary',
};

export function EmptyThread({ onSelect, disabled = false }: EmptyThreadProps) {
  // A custom agent's chat names the agent and offers none of Rooler's own
  // starters or inbox — they are about Rooler, not about what the agent was
  // built for (web client, `ai-agents.md`).
  const { agent } = useChatState();
  const { role, permissions } = useAccess();
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  // `language` is not read inside: `pickChatStarters` translates through the
  // shared instance, and this is what re-picks the text when the host switches it.
  const starters = useMemo(
    () => pickChatStarters(role, permissions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [role, permissions, language],
  );
  const attention = useAttention();

  useEffect(() => {
    if (!agent) void loadAttention();
  }, [agent]);

  const handleSelect = (prompt: string) => {
    send('haptic', { style: 'tap' });
    onSelect(prompt);
  };

  if (agent) {
    return (
      <div className="flex w-full flex-1 flex-col justify-center px-6 pb-16">
        <p className="text-center text-[1.625rem] leading-9 text-label">
          {t('emptyThread.agentTitle', { name: agent.name })}
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col justify-center px-[14px] pt-6 pb-10">
      <p className="mb-6 text-center text-[1.625rem] leading-9 text-label">
        {t('emptyThread.greeting')}
      </p>

      <div className="grid grid-cols-2 gap-2">
        {starters.map((starter) => (
          <button
            key={starter.id}
            type="button"
            disabled={disabled}
            onClick={() => handleSelect(starter.prompt)}
            className="flex min-h-[52px] items-center rounded-card border border-border bg-surface px-3.5 py-2.5 text-left text-[0.875rem] leading-5 font-medium text-label active:opacity-80 disabled:opacity-50"
          >
            {starter.label}
          </button>
        ))}
        {/* Dev-only: renders the mock generative-UI blocks. */}
        {import.meta.env.DEV ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => handleSelect('/ui-demo')}
            className="col-span-2 rounded-card border border-dashed border-border px-3.5 py-2 text-[0.8125rem] text-label-secondary active:opacity-80"
          >
            🧩 UI demo
          </button>
        ) : null}
      </div>

      {attention && attention.total > 0 && attention.items.length > 0 ? (
        <Fade enterMs={250} from="down" className="mt-4">
          <section
            aria-label={t('emptyThread.attention.title')}
            className="flex flex-col gap-2 rounded-[14px] border border-border bg-surface px-3 py-2.5"
          >
            <header className="flex items-center gap-2">
              <h2 className="text-[0.875rem] leading-[18px] font-medium text-label">
                {t('emptyThread.attention.title')}
              </h2>
              <span
                aria-label={t('emptyThread.attention.count', { count: attention.total })}
                className="flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-tint px-1 text-[0.625rem] leading-3 font-semibold text-danger"
              >
                {attention.total > 99 ? '99+' : attention.total}
              </span>
            </header>
            {/* Three and a bit rows, then it scrolls — the web card's 138px. */}
            <ul className="flex max-h-[168px] flex-col gap-1 overflow-y-auto rounded-xl">
              {attention.items.map((item) => (
                <li key={item.uuid} className="shrink-0">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSelect(item.prompt)}
                    className="flex w-full items-end justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2 text-left active:opacity-80 disabled:opacity-50"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-[0.875rem] leading-5 font-medium text-label">
                        {item.title}
                      </span>
                      {item.subtitle ? (
                        <span className="truncate text-[0.75rem] leading-5 text-label-secondary">
                          {item.subtitle}
                        </span>
                      ) : null}
                    </span>
                    <time
                      dateTime={item.occurred_at}
                      className={clsx(
                        'shrink-0 text-[0.75rem] leading-5 font-medium whitespace-nowrap',
                        SEVERITY_CLASS[item.severity],
                      )}
                    >
                      {shortTimeAgo(item.occurred_at)}
                    </time>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </Fade>
      ) : null}
    </div>
  );
}
