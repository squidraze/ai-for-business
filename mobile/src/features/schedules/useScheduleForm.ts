import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { TextInputRef } from '@/components/TextField';
import { errorCodeMessage, parseApiError } from '@/lib/api';

import type { Schedule, ScheduleInput } from './schedules.api';
import {
  FIELD_ORDER,
  validateSchedule,
  type ScheduleField as Field,
  type ScheduleFormValues,
} from './validation';

export const DEFAULT_VALUES: ScheduleFormValues = {
  title: '',
  prompt: '',
  kind: 'daily',
  time_of_day: '09:00',
  weekdays: [0, 1, 2, 3, 4],
  interval_minutes: 4 * 60,
  notify: 'approval',
  enabled: true,
};

export function valuesFromSchedule(schedule: Schedule): ScheduleFormValues {
  return {
    title: schedule.title,
    prompt: schedule.prompt,
    kind: schedule.kind,
    time_of_day: schedule.time_of_day ?? DEFAULT_VALUES.time_of_day,
    weekdays: schedule.weekdays?.length ? [...schedule.weekdays] : DEFAULT_VALUES.weekdays,
    interval_minutes: schedule.interval_minutes ?? DEFAULT_VALUES.interval_minutes,
    notify: schedule.notify,
    enabled: schedule.enabled,
  };
}

/** Only the fields of the chosen kind are sent; the others are null. */
export function toScheduleInput(values: ScheduleFormValues, timezone: string): ScheduleInput {
  const timed = values.kind !== 'interval';
  return {
    title: values.title.trim(),
    prompt: values.prompt.trim(),
    kind: values.kind,
    time_of_day: timed ? values.time_of_day : null,
    weekdays: values.kind === 'weekly' ? [...new Set(values.weekdays)].sort((a, b) => a - b) : null,
    interval_minutes: values.kind === 'interval' ? values.interval_minutes : null,
    timezone,
    enabled: values.enabled,
    notify: values.notify,
  };
}

/** Which error field a value belongs to (they share names, except `enabled`). */
const ERROR_FIELD: Partial<Record<keyof ScheduleFormValues, Field>> = {
  title: 'title',
  prompt: 'prompt',
  kind: 'kind',
  time_of_day: 'time_of_day',
  weekdays: 'weekdays',
  interval_minutes: 'interval_minutes',
  notify: 'notify',
};

const TEXT_FIELDS = ['title', 'prompt'] as const;
type TextField = (typeof TEXT_FIELDS)[number];

/**
 * State of the task form, like the auth forms: errors show after a field is
 * left (or changed, for pickers) or after the first submit; server errors land
 * on their field (`detail.field` / `detail.fields`) or in the banner.
 */
export function useScheduleForm(initial: ScheduleFormValues) {
  const { t, i18n } = useTranslation();
  const [values, setValues] = useState<ScheduleFormValues>(initial);
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<Field, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const refs = useRef<Partial<Record<TextField, TextInputRef | null>>>({});

  const clientErrors = useMemo(() => validateSchedule(values), [values]);

  const describe = useCallback(
    (code: string) => {
      const key = `validation.${code}`;
      if (i18n.exists(key)) return t(key);
      return errorCodeMessage(code) ?? t('errors.generic');
    },
    [i18n, t],
  );

  const error = (field: Field): string | null => {
    const code = serverErrors[field] ?? (touched[field] || submitted ? (clientErrors[field] ?? null) : null);
    return code ? describe(code) : null;
  };

  const setValue = useCallback(
    <K extends keyof ScheduleFormValues>(key: K, value: ScheduleFormValues[K], { touch = false } = {}) => {
      setValues((prev) => ({ ...prev, [key]: value }));
      const field = ERROR_FIELD[key];
      setServerErrors((prev) => {
        // Switching the kind makes the other kinds' errors irrelevant.
        if (key === 'kind') return {};
        return field && prev[field] ? { ...prev, [field]: undefined } : prev;
      });
      if (touch && field) setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
      setFormError(null);
    },
    [],
  );

  const blur = useCallback((field: Field) => {
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }, []);

  const focusFirst = (errors: Partial<Record<Field, string>>) => {
    const first = FIELD_ORDER.find((field) => errors[field]);
    if (first && (TEXT_FIELDS as readonly string[]).includes(first)) refs.current[first as TextField]?.focus();
  };

  /** Shows all errors; focuses the first invalid text field. Returns validity. */
  const validate = (): boolean => {
    setSubmitted(true);
    setFormError(null);
    if (Object.keys(clientErrors).length === 0) return true;
    focusFirst(clientErrors);
    return false;
  };

  const applyServerError = useCallback(
    (err: unknown) => {
      const parsed = parseApiError(err);
      const isField = (name: string | null): name is Field =>
        !!name && (FIELD_ORDER as string[]).includes(name);
      const next: Partial<Record<Field, string>> = {};
      for (const [name, code] of Object.entries(parsed.fields)) {
        if (isField(name)) next[name] = code;
      }
      if (isField(parsed.field) && !next[parsed.field]) {
        next[parsed.field] = parsed.code === 'validation_error' ? 'invalid' : parsed.code;
      }
      if (Object.keys(next).length > 0) {
        setServerErrors(next);
        focusFirst(next);
      } else {
        setFormError(errorCodeMessage(parsed.code, parsed.extra) ?? parsed.message ?? t('errors.generic'));
      }
      return parsed;
    },
    [t],
  );

  const textRef = (field: TextField) => (input: TextInputRef | null) => {
    refs.current[field] = input;
  };

  const focus = (field: TextField) => refs.current[field]?.focus();

  return { values, setValue, blur, error, validate, applyServerError, formError, textRef, focus };
}
