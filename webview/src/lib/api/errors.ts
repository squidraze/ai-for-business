import { AxiosError } from 'axios';

import { t } from '@/i18n';

/**
 * One place that turns an unknown thrown value into a sentence a user can read.
 * Mirrors `getErrorMessage` in the mobile app's `StateMessage.tsx`.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof AxiosError) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string' && detail.trim()) return detail;
    if (Array.isArray(detail)) {
      const first = detail[0] as { msg?: unknown } | undefined;
      if (first && typeof first.msg === 'string') return first.msg;
    }
    if (error.code === 'ECONNABORTED') return t('errors.timedOut');
    if (!error.response) return t('errors.offline');
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

/** A cancelled request is a user action, not a failure — never show it. */
export function isAbortError(error: unknown): boolean {
  if (error instanceof AxiosError) {
    if (error.code === 'ERR_CANCELED') return true;
    if (error.code === 'ERR_NETWORK' && error.config?.signal?.aborted === true) return true;
  }
  return error instanceof DOMException && error.name === 'AbortError';
}
