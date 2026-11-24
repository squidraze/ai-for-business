import type { TFunction } from 'i18next';

import { currentLanguage } from '@/lib/i18n';
import { deviceTimeZone } from '@/lib/timezone';

import type { Schedule } from './schedules.api';

export { deviceTimeZone };

/** 0 = Monday … 6 = Sunday, as the backend numbers them. */
export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const pad = (value: number) => String(value).padStart(2, '0');

/** Local "HH:MM" (24 h) of a date. */
export function hhmm(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function weekdayShort(index: number, t: TFunction): string {
  return t(`schedules.weekdaysShort.${WEEKDAY_KEYS[index] ?? 'mon'}`);
}

/** "Every hour", "Every 2 hours", "Every 90 minutes". */
export function formatInterval(minutes: number, t: TFunction): string {
  if (minutes === 60) return t('schedules.recurrence.everyHour');
  if (minutes % 60 === 0) return t('schedules.recurrence.everyHours', { count: minutes / 60 });
  return t('schedules.recurrence.everyMinutes', { count: minutes });
}

type RecurrenceFields = Pick<Schedule, 'kind' | 'time_of_day' | 'weekdays' | 'interval_minutes' | 'timezone'>;

/**
 * "Every day at 10:00", "Mon, Wed, Fri at 09:30", "Weekdays at 09:00",
 * "Every 2 hours". The time zone is added when it differs from the device's.
 */
export function formatRecurrence(schedule: RecurrenceFields, t: TFunction): string {
  const time = schedule.time_of_day ?? '';
  let text: string;
  if (schedule.kind === 'interval') {
    text = formatInterval(schedule.interval_minutes ?? 60, t);
  } else if (schedule.kind === 'weekly') {
    const days = [...new Set(schedule.weekdays ?? [])].sort((a, b) => a - b);
    const key = days.join(',');
    if (days.length === 7) text = t('schedules.recurrence.daily', { time });
    else if (key === '0,1,2,3,4') text = t('schedules.recurrence.weekdays', { time });
    else if (key === '5,6') text = t('schedules.recurrence.weekends', { time });
    else {
      text = t('schedules.recurrence.weekly', {
        days: days.map((day) => weekdayShort(day, t)).join(', '),
        time,
      });
    }
  } else {
    text = t('schedules.recurrence.daily', { time });
  }
  if (schedule.kind !== 'interval' && schedule.timezone && schedule.timezone !== deviceTimeZone()) {
    text = t('schedules.recurrence.withTimeZone', { text, zone: schedule.timezone });
  }
  return text;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "today at 10:00", "tomorrow at 10:00", "yesterday at 10:00", "Fri, Nov 28 at 10:00". */
export function formatWhen(iso: string | null | undefined, t: TFunction, now = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const time = hhmm(date);
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  if (days === 0) return t('schedules.when.today', { time });
  if (days === 1) return t('schedules.when.tomorrow', { time });
  if (days === -1) return t('schedules.when.yesterday', { time });
  let day: string;
  try {
    day = date.toLocaleDateString(currentLanguage(), {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : null),
    });
  } catch {
    day = date.toDateString();
  }
  return t('schedules.when.date', { date: day, time });
}

/** "Next: today at 10:00" / "Paused" / "Not scheduled". */
export function nextRunLabel(schedule: Pick<Schedule, 'enabled' | 'next_run_at'>, t: TFunction): string {
  if (!schedule.enabled) return t('schedules.paused');
  if (!schedule.next_run_at) return t('schedules.notScheduled');
  return t('schedules.nextRun', { when: formatWhen(schedule.next_run_at, t) });
}
