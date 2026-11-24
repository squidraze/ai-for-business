import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errorCodeMessage, parseApiError, type ApiError } from '@/lib/api';

import type { TextInputRef } from './components/TextField';

type Values<F extends string> = Record<F, string>;
type Validators<F extends string> = Record<F, (values: Values<F>) => string | null>;

/**
 * Form state for the auth screens:
 * - field errors show after the field loses focus or after the first submit,
 *   and disappear as soon as the value becomes valid;
 * - submit focuses the first invalid field;
 * - server errors land on their field (`detail.field` / `detail.fields`) or in
 *   the form banner.
 */
export function useAuthForm<F extends string>(initial: Values<F>, validators: Validators<F>) {
  const { t, i18n } = useTranslation();
  const order = useMemo(() => Object.keys(initial) as F[], [initial]);
  const [values, setValues] = useState<Values<F>>(initial);
  const [touched, setTouched] = useState<Partial<Record<F, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Partial<Record<F, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const refs = useRef<Partial<Record<F, TextInputRef | null>>>({});

  const clientErrors = useMemo(() => {
    const result: Partial<Record<F, string>> = {};
    for (const field of order) {
      const code = validators[field](values);
      if (code) result[field] = code;
    }
    return result;
  }, [order, validators, values]);

  /** A code from `validation.*` or `errors.*` → text. */
  const describe = useCallback(
    (code: string) => {
      const key = `validation.${code}`;
      if (i18n.exists(key)) return t(key);
      return errorCodeMessage(code) ?? t('errors.generic');
    },
    [i18n, t],
  );

  const errorCode = (field: F): string | null =>
    serverErrors[field] ?? (touched[field] || submitted ? (clientErrors[field] ?? null) : null);

  const setValue = useCallback((field: F, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setServerErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
    setFormError(null);
  }, []);

  /** Marks all fields as submitted; focuses the first invalid one. Returns validity. */
  const validate = useCallback((): boolean => {
    setSubmitted(true);
    setFormError(null);
    const first = order.find((field) => clientErrors[field]);
    if (first) {
      refs.current[first]?.focus();
      return false;
    }
    return true;
  }, [order, clientErrors]);

  /** Puts a server error on its field(s) or in the banner. Returns the parsed error. */
  const applyServerError = useCallback(
    (error: unknown): ApiError => {
      const parsed = parseApiError(error);
      const isField = (name: string | null): name is F => !!name && order.includes(name as F);
      const next: Partial<Record<F, string>> = {};
      for (const [name, code] of Object.entries(parsed.fields)) {
        if (isField(name)) next[name] = code;
      }
      // 422 also names the first invalid field in `field`; its code is in `fields`.
      if (isField(parsed.field) && !next[parsed.field]) {
        next[parsed.field] = parsed.code === 'validation_error' ? 'invalid' : parsed.code;
      }
      const fields = Object.keys(next) as F[];
      if (fields.length > 0) {
        setServerErrors(next);
        refs.current[order.find((field) => next[field]) as F]?.focus();
      } else {
        setFormError(
          errorCodeMessage(parsed.code, parsed.extra) ?? parsed.message ?? t('errors.generic'),
        );
      }
      return parsed;
    },
    [order, t],
  );

  /** Props for a TextField. */
  const field = (name: F) => {
    const code = errorCode(name);
    return {
      value: values[name],
      onChangeText: (value: string) => setValue(name, value),
      onBlur: () => setTouched((prev) => (prev[name] ? prev : { ...prev, [name]: true })),
      ref: (input: TextInputRef | null) => {
        refs.current[name] = input;
      },
      error: code ? describe(code) : null,
    };
  };

  const focus = (name: F) => refs.current[name]?.focus();

  return {
    values,
    setValue,
    field,
    focus,
    validate,
    applyServerError,
    formError,
    setFormError,
    isValid: Object.keys(clientErrors).length === 0,
  };
}
