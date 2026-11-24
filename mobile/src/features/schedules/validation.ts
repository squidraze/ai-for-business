/**
 * Client-side rules for the task form, mirroring the backend. Each returns an
 * error code (translated as `validation.<code>` or `errors.<code>`) or null.
 */
import type { ScheduleKind, ScheduleNotify } from './schedules.api';

export const TITLE_MAX = 100;
export const PROMPT_MAX = 4000;
export const INTERVAL_MIN_MINUTES = 60;
export const INTERVAL_MAX_MINUTES = 24 * 60;
/** Interval choices in the form, in hours. */
export const INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

export type ScheduleFormValues = {
  title: string;
  prompt: string;
  kind: ScheduleKind;
  /** "HH:MM". */
  time_of_day: string;
  weekdays: number[];
  interval_minutes: number;
  notify: ScheduleNotify;
  enabled: boolean;
};

/** Form fields that can carry an error; the names match the API fields. */
export type ScheduleField = 'title' | 'prompt' | 'kind' | 'time_of_day' | 'weekdays' | 'interval_minutes' | 'timezone' | 'notify';

export const FIELD_ORDER: ScheduleField[] = [
  'title',
  'prompt',
  'kind',
  'time_of_day',
  'weekdays',
  'interval_minutes',
  'notify',
  'timezone',
];

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateTitle(value: string): string | null {
  const title = value.trim();
  if (!title) return 'required';
  if (title.length > TITLE_MAX) return 'title_too_long';
  return null;
}

export function validatePrompt(value: string): string | null {
  const prompt = value.trim();
  if (!prompt) return 'required';
  if (prompt.length > PROMPT_MAX) return 'prompt_too_long';
  return null;
}

export function validateTime(kind: ScheduleKind, value: string): string | null {
  if (kind === 'interval') return null;
  if (!value) return 'required';
  return TIME_RE.test(value) ? null : 'invalid_time';
}

export function validateWeekdays(kind: ScheduleKind, days: number[]): string | null {
  if (kind !== 'weekly') return null;
  return days.length > 0 ? null : 'weekdays_required';
}

export function validateInterval(kind: ScheduleKind, minutes: number): string | null {
  if (kind !== 'interval') return null;
  if (!Number.isFinite(minutes) || minutes < INTERVAL_MIN_MINUTES) return 'interval_too_short';
  if (minutes > INTERVAL_MAX_MINUTES) return 'interval_too_long';
  return null;
}

export function validateSchedule(values: ScheduleFormValues): Partial<Record<ScheduleField, string>> {
  const errors: Partial<Record<ScheduleField, string>> = {};
  const set = (field: ScheduleField, code: string | null) => {
    if (code) errors[field] = code;
  };
  set('title', validateTitle(values.title));
  set('prompt', validatePrompt(values.prompt));
  set('time_of_day', validateTime(values.kind, values.time_of_day));
  set('weekdays', validateWeekdays(values.kind, values.weekdays));
  set('interval_minutes', validateInterval(values.kind, values.interval_minutes));
  return errors;
}
