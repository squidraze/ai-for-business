/** "now", "5m", "3h", "Yesterday", "Mon", "Mar 4", "Mar 4, 2025". */
export function relativeTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  if (diffMs < 6 * 86400000) return date.toLocaleDateString(undefined, { weekday: 'short' });
  if (date.getFullYear() === now.getFullYear())
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function timeOfDay(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function fullDate(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 12500 + "USD" -> "$12,500"; an unknown currency code is appended ("12,500 XYZ"). */
export function formatMoney(amount?: number | null, currency?: string | null): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '';
  const value = Number(amount);
  if (currency) {
    try {
      return value.toLocaleString(undefined, {
        style: 'currency',
        currency,
        maximumFractionDigits: value % 1 === 0 ? 0 : 2,
      });
    } catch {
      // not an ISO 4217 code — fall through
    }
  }
  const plain = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return currency ? `${plain} ${currency}` : plain;
}

export function initials(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '';
  return (first + second).toUpperCase();
}

/** "Jane Doe <jane@x.com>" -> "Jane Doe". */
export function displayFrom(from?: string | null): string {
  if (!from) return '';
  const match = /^\s*"?([^"<]*?)"?\s*<[^>]+>\s*$/.exec(from);
  return (match && match[1].trim()) || from.replace(/[<>]/g, '');
}

/** "998901234567" -> "+998901234567"; anything that isn't a non-empty string -> "". */
export function formatPhone(phone?: unknown): string {
  if (typeof phone !== 'string' || !phone.trim()) return '';
  const value = phone.trim();
  return value.startsWith('+') ? value : `+${value}`;
}

/** Non-empty strings joined with `separator`; null / undefined / non-strings are skipped. */
export function joinParts(parts: unknown[], separator = ' '): string {
  return parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '').join(separator);
}
