import { parseApiError } from '@/lib/api';

/**
 * The integration isn't connected (or its session is gone): the backend answers
 * 409, or a `<name>_not_connected` code. Screens show "connect it" instead of Retry.
 */
export function isNotConnectedError(error: unknown): boolean {
  const { status, code } = parseApiError(error);
  return status === 409 || code === 'not_connected' || code.endsWith('_not_connected');
}
