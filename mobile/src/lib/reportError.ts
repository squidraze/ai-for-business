import { createLogger } from '@/lib/log';

const log = createLogger('error');

/**
 * Single place to report unexpected errors (render crashes caught by error
 * boundaries, etc.). Today it only logs to the console; plug Sentry or another
 * crash reporter in here later so every caller gets it for free.
 */
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  log.error(error instanceof Error ? error.message : String(error), { error, ...context });
}
