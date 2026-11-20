/* Minimal console logger with the same shape the reference host uses. */
type Level = 'debug' | 'info' | 'warn' | 'error';

function write(level: Level, scope: string, message: string, context?: unknown) {
  if (!__DEV__ && level === 'debug') return;
  const line = `[${scope}] ${message}`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  if (context === undefined) fn(line);
  else fn(line, context);
}

export function createLogger(scope: string) {
  return {
    debug: (message: string, context?: unknown) => write('debug', scope, message, context),
    info: (message: string, context?: unknown) => write('info', scope, message, context),
    warn: (message: string, context?: unknown) => write('warn', scope, message, context),
    error: (message: string, context?: unknown) => write('error', scope, message, context),
  };
}
