import { Centrifuge } from 'centrifuge';

import { getRealtimeConnectionToken } from '@/lib/api/ai';
import { logger } from '@/lib/logger';

const log = logger.child('realtime');

let client: Centrifuge | null = null;
let connecting: Promise<Centrifuge> | null = null;

// Bumped by every disconnectRealtime(). connectRealtime() captures the value at
// the start of its async token fetch and, once the token resolves, aborts the
// just-built connection if the generation has moved on — i.e. a sign-out or
// company switch happened while the token was in flight. Without this, a teardown
// that races an in-flight connect is silently ignored (client is still null, so
// disconnectRealtime() no-ops) and the socket comes up anyway: a live
// authenticated connection after logout, or a stale company-scoped one after a
// switch (the shared `connecting` promise would be handed back for the new
// company).
let generation = 0;

/**
 * Called on every **re**connect (never the first connect). While the socket was
 * down, publications were lost — so the owner re-fetches the REST state of the
 * screens that live on realtime. Registered via {@link setReconnectHandler}; see
 * the Centrifugo contract, "resync after reconnect".
 */
let reconnectHandler: (() => void) | null = null;

export function setReconnectHandler(fn: (() => void) | null): void {
  reconnectHandler = fn;
}

/**
 * Listeners notified when the connection is **deliberately** torn down
 * (`disconnectRealtime` — sign-out or company switch), *before* the socket and its
 * handlers are removed. An in-flight AI run registers here so it can end its stream
 * at once instead of parking on the shared client's now-detached `publication`
 * handler until the 60s idle watchdog fires. This fires only on an intentional
 * teardown, never on a transient socket drop — a blip should let the run keep
 * waiting (the backend run may resume), which is exactly what the watchdog covers.
 */
const teardownListeners = new Set<() => void>();

export function onRealtimeTeardown(fn: () => void): () => void {
  teardownListeners.add(fn);
  return () => {
    teardownListeners.delete(fn);
  };
}

const AI_CHANNEL_PREFIX = 'ai:user-';

/** The granted `ai:user-<id>`, remembered from the connection token. */
let aiChannel: string | null = null;

/**
 * The AI channel this session was granted, or `null` before the first connect.
 *
 * A send learns its channel from the `202`; a run joined after the fact — a
 * reopened conversation whose reply is still being written — has no `202`, and
 * `AIRunRead` carries no channel. The token's own grant is the one place it is
 * written down, so it is read from there rather than built from the user id.
 */
export function getAiChannel(): string | null {
  return aiChannel;
}

/* ------------------------------------------------------------------ */
/* The transport seam                                                  */
/* ------------------------------------------------------------------ */

/**
 * A minted realtime session: what the REST call hands back, and everything the
 * transport needs. That call is now proxied through the host (see
 * `lib/api/client.ts`) — the token no longer comes from the WebView's own
 * network stack.
 */
type RealtimeSession = { token: string; url: string; channels?: string[] };

/**
 * THE ONE PLACE THIS APP OPENS A SOCKET — `openTransport` below, plus
 * `nudgeTransport`. Nothing else in the file (or the app) touches Centrifuge
 * directly.
 *
 * WHY it is fenced off. REST had to move onto the bridge because this page is
 * loaded from `file://`, so its origin is `null` and the API's CORS allowlist
 * rejects it outright. Whether the **websocket** survives a `null` origin is
 * *not yet known*: it could not be determined from outside the device, and a
 * browser does send `Origin: null` on a ws handshake, which a server is free to
 * check the same way. If it turns out it does not, the answer is a bridge-fed
 * event source — the host opens Centrifugo with the session it holds and
 * forwards publications over the bridge.
 *
 * That swap is then contained: reimplement these two functions against the small
 * surface consumers actually use — `.on('publication')`, `.connect()`,
 * `.disconnect()`, `.removeAllListeners()` (see `aiEvents.ts`) — and nothing
 * above or below them changes. It is deliberately NOT built now: it is
 * speculative until the server's behaviour is measured on a device.
 */
function openTransport(session: RealtimeSession, onReconnected: () => void): Centrifuge {
  const { token, url, channels } = session;
  aiChannel = channels?.find((name) => name.startsWith(AI_CHANNEL_PREFIX)) ?? null;

  // Confirm we got a usable wss url, a sane token, and that the server-side
  // subscriptions include the channels we expect. `urlOk` flags the common
  // mistakes behind an instant "transport closed": a non-ws(s) scheme or a
  // missing /connection/websocket path.
  //
  // Not DEV-only any more. `channels` is what decides whether this session can
  // hear its own run at all — a grant missing `ai:user-<id>` produces a chat that
  // sends fine and never answers, and on a device that was previously invisible.
  // `describeToken` returns metadata only (length, `sub`, `exp`), never token
  // material.
  log.info('connection-token', {
    url,
    urlOk: /^wss?:\/\//.test(url ?? ''),
    channels,
    token: describeToken(token),
  });

  // The production bundle ships a CSP with `connect-src wss:` — REST leaves
  // through the host, so the websocket is the only connection the page opens.
  // A cleartext `ws://` endpoint is therefore blocked by the browser, and the
  // only trace is a console line nobody reads on a device. Say it out loud
  // instead: this is a server configuration problem, not a chat bug.
  if (!/^wss:\/\//.test(url ?? '')) {
    log.error('realtime url is not wss — the page CSP will block it', { url });
  }

  const c = new Centrifuge(url, {
    token,
    getToken: () => getRealtimeConnectionToken().then((fresh) => fresh.token),
  });

  // Resync after reconnect (Centrifugo contract): the first `connected` is the
  // initial connect and needs no resync, but every reconnect after a drop
  // means publications were missed while the socket was down — run the
  // registered handler so the owner re-fetches the affected REST state.
  // Attached before connect() so the initial `connected` is reliably the one
  // we skip here.
  let firstConnected = true;
  c.on('connected', (ctx) => {
    // Whether the socket is up when the chat opens is the difference between a
    // reply that streams and a reply that never arrives, so this ships.
    log.info('connected', {
      client: ctx.client,
      transport: ctx.transport,
      reconnect: !firstConnected,
    });
    if (firstConnected) {
      firstConnected = false;
      return;
    }
    log.info('reconnected — resyncing REST state');
    onReconnected();
  });

  // The two ways streaming stops with nothing on screen saying so. One line each,
  // only when it happens — cheap enough to ship.
  c.on('disconnected', (ctx) =>
    log.warn('disconnected', { code: ctx.code, reason: ctx.reason, url }),
  );
  c.on('error', (ctx) =>
    log.warn('error', { code: ctx.error?.code, message: ctx.error?.message, url }),
  );

  if (import.meta.env.DEV) {
    c.on('connecting', (ctx) => log.info('connecting', { code: ctx.code, reason: ctx.reason }));
    // Log every server-side publication (chat:, notifications:, ai:, …) so that
    // traffic is visible in the console / native log bridge. The AI channel is
    // server-side too, so its `ai.*` events show up here as well.
    // Diagnostics only.
    c.on('publication', (ctx) => log.info('publication', { channel: ctx.channel, data: ctx.data }));
  }

  c.connect();
  return c;
}

/** Ask the live transport to reconnect now. A no-op when it is already up. */
function nudgeTransport(): void {
  client?.connect();
}

/**
 * DEV diagnostics: decode a Centrifugo JWT just enough to sanity-check it —
 * shape (3 dot-separated parts), subject, and expiry. A token that's not 3
 * parts, or already expired, explains an instant `transport closed`.
 */
function describeToken(token: string): Record<string, unknown> {
  const parts = token?.split('.') ?? [];
  const info: Record<string, unknown> = { length: token?.length ?? 0, parts: parts.length };
  try {
    if (parts.length === 3) {
      const payload = JSON.parse(atob(parts[1])) as { sub?: string; exp?: number };
      info.sub = payload.sub;
      info.exp = payload.exp;
      if (payload.exp) info.expiresInSec = Math.round(payload.exp - Date.now() / 1000);
    }
  } catch {
    info.decodeError = true;
  }
  return info;
}

/**
 * Single shared Centrifugo connection for the whole client (see the Centrifugo
 * realtime contract, §1).
 *
 * We mint the connection token over REST (`GET /api/v1/realtime/connection-token`):
 * the response returns `token` (Centrifugo JWT), `url` (the wss endpoint) and
 * `channels` — the server-side subscriptions the user's role is allowed to see.
 * These server-side channels need no client-side `subscribe()`: the connection is
 * live on all of them immediately, and their publications arrive at the client
 * level via the `publication` event carrying `ctx.channel`. The AI channel
 * (`ai:user-<id>`) is one of them — it is baked into the token, so `streamAiRun`
 * just filters the client-level `publication` event by channel (see aiEvents.ts),
 * never opening its own `Subscription`.
 *
 * Centrifuge calls `getToken` itself when the current JWT expires (TTL ~1h) or
 * after a drop — we hand it a fresh token via the same REST request, which
 * covers both the initial connect and reconnects.
 */
export function connectRealtime(): Promise<Centrifuge> {
  if (client) return Promise.resolve(client);
  if (connecting) return connecting;

  // Snapshot the generation for this attempt. If disconnectRealtime() runs before
  // the token resolves it bumps `generation`, and we throw away the connection we
  // were about to build instead of leaking a live socket for a superseded session.
  const attemptGeneration = generation;

  connecting = getRealtimeConnectionToken()
    .then((session) => {
      // Torn down (sign-out / company switch) while the token was in flight —
      // don't build or connect. The next connectRealtime() starts a fresh,
      // correctly-scoped attempt.
      if (attemptGeneration !== generation) {
        throw new Error('realtime connect superseded');
      }
      const c = openTransport(session, () => reconnectHandler?.());
      client = c;
      return c;
    })
    .finally(() => {
      // Only clear the slot if it still belongs to this attempt. A superseded
      // attempt (disconnect bumped the generation) must not null out the
      // `connecting` promise a newer attempt has since installed.
      if (attemptGeneration === generation) connecting = null;
    });

  return connecting;
}

export function getRealtimeClient(): Centrifuge | null {
  return client;
}

export function disconnectRealtime(): void {
  // Invalidate any in-flight connect: bumping the generation makes a token fetch
  // that's still pending throw instead of building a socket, and clearing
  // `connecting` frees the next connectRealtime() to start a fresh, correctly
  // company-scoped attempt rather than being handed back this superseded promise.
  generation += 1;
  connecting = null;

  // Let in-flight runs end their streams now (before removeAllListeners() detaches
  // their publication handler), so they don't hang until the idle watchdog. Iterate
  // a copy — a listener may unsubscribe itself in response.
  [...teardownListeners].forEach((fn) => fn());

  if (client) {
    client.removeAllListeners();
    client.disconnect();
    client = null;
  }
}

/**
 * Browser stand-in for the native app's AppState/NetInfo effects, which nudged
 * Centrifuge to reconnect immediately instead of waiting out its backoff. Call it
 * once at startup; the returned function detaches both listeners.
 *
 * Deliberately not a React component: the connection outlives any one screen, and
 * `connect()` on an already-connected client is a no-op, so this is safe to fire
 * on every tab focus. It never *creates* the connection — `connectRealtime()`
 * stays the single entry point — so a nudge before sign-in does nothing.
 *
 * Idempotent: boot can run this twice (a partly-failed `applyInit` that is
 * retried), and a second listener pair would double every nudge and orphan the
 * first unsubscribe. A repeat call hands back the live teardown instead.
 */
let stopLifecycle: (() => void) | null = null;

export function startRealtimeLifecycle(): () => void {
  if (stopLifecycle) return stopLifecycle;

  const onVisible = () => {
    // A WebView/tab that was backgrounded may have had its socket closed by the
    // browser; reconnect as soon as it is on screen again.
    if (document.visibilityState === 'visible') nudgeTransport();
  };
  const onOnline = () => {
    nudgeTransport();
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);

  stopLifecycle = () => {
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', onOnline);
    stopLifecycle = null;
  };
  return stopLifecycle;
}
