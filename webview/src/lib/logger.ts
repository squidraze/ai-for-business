import { send } from '@/bridge/bridge';
import type { LogLevel } from '@/bridge/protocol';

/**
 * Everything the web app logs is forwarded to the native logger
 * so one Sentry trail covers a session. Never log a token.
 */
function emit(level: LogLevel, scope: string, message: string, context?: unknown): void {
  // `debug` is a development aid only. Forwarding it from a production build
  // would put every verbose line into the native log file and Sentry breadcrumbs.
  if (level === 'debug' && !import.meta.env.DEV) return;

  const line = `[${scope}] ${message}`;
  if (import.meta.env.DEV) {
    const method = level === 'debug' ? 'log' : level;
    console[method](line, context ?? '');
  }
  send('log', { level, message: line, context });
}

export type Logger = {
  debug: (message: string, context?: unknown) => void;
  info: (message: string, context?: unknown) => void;
  warn: (message: string, context?: unknown) => void;
  error: (message: string, context?: unknown) => void;
  child: (scope: string) => Logger;
};

export function createLogger(scope: string): Logger {
  return {
    debug: (message, context) => emit('debug', scope, message, context),
    info: (message, context) => emit('info', scope, message, context),
    warn: (message, context) => emit('warn', scope, message, context),
    error: (message, context) => emit('error', scope, message, context),
    child: (child) => createLogger(`${scope}.${child}`),
  };
}

export const logger = createLogger('webchat');

/** A render-time crash: report it with the stack, not just a message. */
export function reportFatal(error: unknown, context?: unknown): void {
  const err = error instanceof Error ? error : new Error(String(error));
  send('error', { message: err.message, stack: err.stack, context });
  if (import.meta.env.DEV) console.error('[webchat] fatal', err, context ?? '');
}
