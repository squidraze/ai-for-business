import { getHostLocale, t } from '@/i18n';

/**
 * When a message was sent, in words — the one line the long-press menu shows.
 *
 * Its own module rather than a helper beside `MessageActions`: the row is a
 * component file, and a non-component export there breaks fast refresh for the
 * whole transcript (the linter says so out loud). It is also no longer the row's
 * business — the action row stopped rendering a timestamp when the menu took it
 * over.
 */

/* ---------------------------------------------------------------- */
/* Time                                                              */
/* ---------------------------------------------------------------- */

/** The host's locale — `init.locale`, then every `locale.set` (`@/i18n`). */
function resolveLocale(): string {
  return getHostLocale();
}

// `Intl.DateTimeFormat` construction is the expensive half, and the menu builds
// its label on every open, so keep one formatter per locale and shape.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(locale: string, options: Intl.DateTimeFormatOptions, key: string): Intl.DateTimeFormat {
  const cacheKey = `${locale}|${key}`;
  const cached = formatters.get(cacheKey);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(locale, options);
  } catch {
    // A malformed locale from the host must not take the transcript down.
    formatter = new Intl.DateTimeFormat('en-US', options);
  }
  formatters.set(cacheKey, formatter);
  return formatter;
}

const isSameDay = (a: Date, b: Date): boolean =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/**
 * "Today, 14:10" / "Yesterday, 14:10" / "12 Aug, 14:10" — what the long-press
 * menu puts above its actions.
 *
 * The clock is the host's locale (24h or 12h follows the device); the day is
 * English, like every other string in this app. `createdAt` is an API value, so
 * an unparseable one renders an em dash rather than "Invalid Date".
 */
export function formatMessageTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  try {
    const locale = resolveLocale();
    const time = formatterFor(locale, { hour: '2-digit', minute: '2-digit' }, 'time').format(date);

    const today = new Date();
    if (isSameDay(date, today)) return t('time.todayAt', { time });

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (isSameDay(date, yesterday)) return t('time.yesterdayAt', { time });

    const day = formatterFor(locale, { day: 'numeric', month: 'short' }, 'day').format(date);
    return t('time.dayAt', { day, time });
  } catch {
    return '—';
  }
}
