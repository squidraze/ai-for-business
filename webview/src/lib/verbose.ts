/**
 * Verbatim diagnostics: log the payloads themselves, not a description of them.
 *
 * Everything else this app logs is deliberately content-free — roles, uuids and
 * lengths — because those lines cross the bridge into the native log file and
 * into Sentry breadcrumbs, and an AI answer is the last thing that belongs
 * there. That rule stands.
 *
 * This is the exception, and it is gated rather than removed: some questions
 * ("why did one answer come back as three?") cannot be answered from shapes
 * alone, you have to read the rows. So the verbatim dump is switched on by the
 * host's `devMode` — true in a debug build, false in anything a user installs —
 * and nothing turns it on in a release build. `import.meta.env.DEV` cannot serve
 * here: the bundle the app ships is a production Vite build even while the app
 * around it is a debug one.
 */
let verbose = false;

/** Called once from the boot handshake with the host's `devMode`. */
export function setVerbose(on: boolean): void {
  verbose = on;
}

export function isVerbose(): boolean {
  return verbose;
}

/**
 * How much of one value a verbatim line may carry. Generous — the point is to
 * read the row — but not unbounded: a single 100 KB tool result would be one
 * bridge message and one unreadable log line.
 */
const MAX_CHARS = 4000;

/**
 * A value as text, cut at {@link MAX_CHARS} with the overflow named rather than
 * silently dropped — a truncated dump that does not say it was truncated is how
 * you conclude the backend sent half a message.
 */
export function verbatim(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text === undefined) return null;
  if (text.length <= MAX_CHARS) return text;
  return `${text.slice(0, MAX_CHARS)}… [+${text.length - MAX_CHARS} more chars]`;
}
