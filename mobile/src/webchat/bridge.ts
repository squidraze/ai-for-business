/**
 * The native half of the WebView chat bridge: one typed `post` for
 * native -> web, one typed parser for web -> native. Copied from the Rooler
 * business app (src/features/ai-chat/webchat/bridge.ts).
 */
import type { RefObject } from 'react';
import type WebView from 'react-native-webview';

import { createLogger } from '@/lib/log';

import {
  BRIDGE_PROTOCOL_VERSION,
  isBridgeEnvelope,
  type BridgeEnvelope,
  type HttpMethod,
  type NativeToWebPayload,
  type NativeToWebType,
  type WebToNativeMessage,
  type WebToNativeType,
} from './protocol';

const log = createLogger('webchat.bridge');

/**
 * Send one message to the web app. The payload argument is present exactly when
 * the protocol says that message carries one, so a typo can't compile.
 */
export type BridgePost = <T extends NativeToWebType>(
  type: T,
  ...args: NativeToWebPayload<T> extends undefined ? [] : [payload: NativeToWebPayload<T>]
) => void;

/**
 * Every web → native type, spelled out. `satisfies` keeps the list honest
 * against the protocol union; the `Set` is `string`-keyed because the value we
 * test against it comes off the wire as an arbitrary string.
 */
const WEB_TO_NATIVE_TYPES = [
  'ready',
  'http.request',
  'http.abort',
  'attachment.pick',
  'attachment.upload',
  'attachment.release',
  'attachment.open',
  'attachment.thumbnail.request',
  'clipboard.write',
  'haptic',
  'open.url',
  'open.voice',
  'open.list',
  'open.integrations',
  'report.open',
  'thread.created',
  'thread.titled',
  'thread.changed',
  'nav.consumed',
  'generative.action',
  'log',
  'error',
] as const satisfies readonly WebToNativeType[];

const KNOWN_TYPES = new Set<string>(WEB_TO_NATIVE_TYPES);

/**
 * Bind a `post` to a WebView ref. Posting before the page has loaded is a
 * no-op by design: every native → web message is either a reply to something
 * the web app asked for, or an update it re-reads from `init` anyway.
 */
export function createBridgePost(ref: RefObject<WebView | null>): BridgePost {
  return (type, ...args) => {
    const view = ref.current;
    if (!view) return;

    const envelope: BridgeEnvelope = {
      v: BRIDGE_PROTOCOL_VERSION,
      type,
      ...(args.length > 0 ? { payload: args[0] } : {}),
    };

    try {
      view.postMessage(JSON.stringify(envelope));
    } catch (error) {
      // A serialisation failure or a disposed view must never take the screen
      // down — the web app will re-request whatever it is missing.
      log.warn('failed to post to the web chat', {
        type,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
}

/**
 * Turn one raw `onMessage` string into a typed protocol message, or `null` when
 * it is not ours. Foreign traffic (a stray `window.postMessage` from a library
 * inside the page) is common and is dropped silently; a well-formed envelope
 * with an unknown `type` is logged, because that means the two sides drifted.
 *
 * The payload is *not* validated here — it is untrusted input, and each handler
 * narrows the fields it actually reads.
 */
export function parseWebMessage(raw: string): WebToNativeMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isBridgeEnvelope(parsed)) return null;

  if (!KNOWN_TYPES.has(parsed.type)) {
    log.warn('unknown bridge message from the web chat', { type: parsed.type });
    return null;
  }

  return { type: parsed.type, payload: parsed.payload } as WebToNativeMessage;
}

/* ------------------------------------------------------------------ */
/* Payload guards — everything off the wire is untrusted input.        */
/* ------------------------------------------------------------------ */

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

/** A non-empty string, or `null`. */
export function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** An `http(s)` URL, or `null`. Anything else (`javascript:`, `file:`) is refused. */
export function asHttpUrl(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  return /^https?:\/\//i.test(text) ? text : null;
}

const HTTP_METHODS = [
  'get',
  'post',
  'patch',
  'put',
  'delete',
] as const satisfies readonly HttpMethod[];

/** One of the five methods the contract enumerates, lower-cased, or `null`. */
export function asHttpMethod(value: unknown): HttpMethod | null {
  if (typeof value !== 'string') return null;
  const method = value.toLowerCase();
  return (HTTP_METHODS as readonly string[]).includes(method) ? (method as HttpMethod) : null;
}

/**
 * A raw control character or a DEL — CR/LF in a URL is request splitting.
 * Written as a scan rather than a regex so it needs no `no-control-regex`
 * suppression, and so it reads as the check it is.
 */
function hasControlChars(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * **The security boundary of the HTTP proxy.**
 *
 * The host performs proxied requests with the app's *authenticated* client —
 * the one that attaches the Bearer token and `X-Company-ID`. So the page must
 * never be able to choose the host it is aimed at: a `url` is accepted only as
 * a relative path on our own API, and refused otherwise.
 *
 * What that rules out, and why each check is here rather than "obviously
 * covered by the one above it":
 * - **an absolute URL** — `https://evil.example/api/x`, `//evil.example/api/x`,
 *   `javascript:…`, `file:///…`: none of them start with a single `/api/`.
 * - **traversal** — `/api/../../whatever`, and its `%2e%2e` spelling, which is
 *   checked after decoding — on the path up to the first raw `?`/`#`, so an
 *   encoded `%3f` cannot pass the segments after it off as a query.
 * - **a backslash** — URL parsers normalise `\` to `/`, so `/api/..\..\x` would
 *   walk out of `/api/` while surviving a naive `split('/')`.
 * - **control characters** — CR/LF in a path is request splitting.
 */
export function asApiPath(value: unknown): string | null {
  const text = asText(value);
  if (!text) return null;
  if (!text.startsWith('/api/')) return null;
  if (text.includes('\\') || hasControlChars(text)) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(text);
  } catch {
    return null; // malformed percent-encoding
  }
  if (decoded.includes('\\') || hasControlChars(decoded)) return null;

  // The path ends at the first *raw* `?` or `#`. Splitting the decoded text
  // instead would let an encoded one (`/api/x%3f/../../y`) end the "path" early
  // and hide the real `..` segments after it from this check.
  const path = decodeURIComponent(text.split(/[?#]/)[0]);
  if (path.split('/').some((segment) => segment === '..')) return null;

  return text;
}

/**
 * Query params, narrowed to the scalars the contract allows. Anything else — a
 * nested object, an array, a function that survived `JSON.parse` (it can't, but
 * the guard is what makes that a fact rather than an assumption) — is dropped
 * rather than handed to axios' serialiser.
 */
export function asQueryParams(value: unknown): Record<string, string | number | boolean> | null {
  const record = asRecord(value);
  if (!record) return null;

  const params: Record<string, string | number | boolean> = {};
  const dropped: string[] = [];
  for (const [key, entry] of Object.entries(record)) {
    if (entry === undefined || entry === null) continue;
    if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      params[key] = entry;
    } else {
      dropped.push(key);
    }
  }
  // Keys only — a value is caller data and never reaches the log.
  if (dropped.length > 0) log.warn('dropped non-scalar query params', { keys: dropped });

  return Object.keys(params).length > 0 ? params : null;
}
