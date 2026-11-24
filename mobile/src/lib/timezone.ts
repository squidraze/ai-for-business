import { getCalendars } from 'expo-localization';

export const FALLBACK_TIME_ZONE = 'Asia/Tashkent';

/** The device's IANA time zone (e.g. "Asia/Tashkent"). */
export function deviceTimeZone(): string {
  try {
    const zone = getCalendars()[0]?.timeZone;
    if (zone) return zone;
  } catch {
    // fall through
  }
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone) return zone;
  } catch {
    // fall through
  }
  return FALLBACK_TIME_ZONE;
}
