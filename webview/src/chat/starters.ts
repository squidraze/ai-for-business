/**
 * The starter prompts of the new-chat screen: four generic business chips
 * about the two connectors the assistant has — Telegram and Gmail.
 *
 * Label ≠ prompt: the chip says the short thing, the prompt is what is sent as
 * the user's first message. `{{today}}` becomes the date when the chip is picked.
 * Both halves are translated; the pool stores keys and the text is looked up
 * at call time.
 */

import type { ParseKeys } from 'i18next';

import { t } from '@/i18n';

type StarterKey = ParseKeys<'chat'>;

export type ChatStarter = {
  id: string;
  /** What the chip says. */
  label: string;
  /** What is actually sent. */
  prompt: string;
};

export const STARTERS_SHOWN = 4;

const POOL: { id: string; label: StarterKey; prompt: StarterKey }[] = [
  { id: 'telegram_unread', label: 'starters.telegramUnread.label', prompt: 'starters.telegramUnread.prompt' },
  { id: 'emails_today', label: 'starters.emailsToday.label', prompt: 'starters.emailsToday.prompt' },
  { id: 'draft_reply', label: 'starters.draftReply.label', prompt: 'starters.draftReply.prompt' },
  { id: 'telegram_search', label: 'starters.telegramSearch.label', prompt: 'starters.telegramSearch.prompt' },
];

/** Today as `YYYY-MM-DD` in the device's own time zone. */
function localToday(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The chips, translated in the current UI language at call time — a caller
 * that memoises the result keys it on the language too.
 */
export function pickChatStarters(now: Date = new Date()): ChatStarter[] {
  const today = localToday(now);
  return POOL.slice(0, STARTERS_SHOWN).map(({ id, label, prompt }) => ({
    id,
    label: t(label),
    prompt: t(prompt, { today }),
  }));
}
