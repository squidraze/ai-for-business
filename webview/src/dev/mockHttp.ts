/**
 * The host's HTTP layer, for running this app in a plain browser tab.
 *
 * DEV ONLY — reached only from `src/dev/devHost.ts`, which is itself behind the
 * dead-code-eliminated dynamic import in `src/dev/index.ts`.
 *
 * On a device the web app never touches the network: it posts `http.request`
 * over the bridge and the native host performs the call with the session it
 * already holds, because a page loaded from `file://` has a `null` origin and
 * the API's CORS allowlist refuses it. This module is the harness's half of
 * that: it answers `http.request` with `http.response`, exactly as the host
 * does, so dev exercises the real path rather than a patched `XMLHttpRequest`.
 *
 * Two ways to answer, chosen at install:
 *
 *  - **mock** (the default) — `routeRequest()` in `mockBackend.ts` serves the
 *    reply from fixtures, and nothing leaves the browser;
 *  - **passthrough** (`VITE_DEV_MOCK_API=0`) — a real `fetch` against
 *    `VITE_DEV_BASE_URL` carrying the dev token. Note where the credentials
 *    live: in the *host*, not in the app. That mirrors the device, where the
 *    WebView never sees a token at all.
 *
 * On top of either sits the fault injector, so the offline and error states can
 * be looked at without unplugging anything — see {@link setNetworkMode} and
 * {@link failNextRequest}.
 */

import type { HttpRequest, HttpResponse } from '@/bridge/protocol';

import { routeRequest, type MockReply, type RequestParams } from './mockBackend';

/** Round-trip a request is made to take, so loading states are actually visible. */
const LATENCY_MS = 120;

const REAL_TIMEOUT_MS = 15_000;

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export interface HostHttpConfig {
  /** False when `VITE_DEV_MOCK_API=0` — then every request really goes out. */
  useMock: boolean;
  baseURL: string;
  token: string;
  companyId: string;
}

let config: HostHttpConfig = {
  useMock: true,
  baseURL: 'http://localhost:8000',
  token: 'dev-token',
  companyId: '',
};

export function configureHostHttp(next: HostHttpConfig): void {
  config = next;
}

/* ------------------------------------------------------------------ */
/* Fault injection                                                     */
/* ------------------------------------------------------------------ */

/**
 * `offline` is the failure that moved REST onto the bridge in the first place:
 * every call comes back `ok: false` with `code: 'ERR_NETWORK'` and no status,
 * which is what the app sees when a request never reaches a server.
 */
export type NetworkMode = 'online' | 'offline';

let networkMode: NetworkMode = 'online';
let failNext = false;

export const getNetworkMode = (): NetworkMode => networkMode;

export function setNetworkMode(mode: NetworkMode): void {
  networkMode = mode;
}

export function toggleNetworkMode(): NetworkMode {
  networkMode = networkMode === 'online' ? 'offline' : 'online';
  return networkMode;
}

/** Arm a one-shot failure: the thread stays loaded, the next send does not. */
export function failNextRequest(): void {
  failNext = true;
}

export const isNextRequestArmedToFail = (): boolean => failNext;

function shouldFail(): boolean {
  if (networkMode === 'offline') return true;
  if (!failNext) return false;
  failNext = false;
  return true;
}

const networkFailure = (requestId: string): HttpResponse => ({
  requestId,
  ok: false,
  // No `status`: the request never reached a server, so there is nothing to report.
  code: 'ERR_NETWORK',
  message: 'Network Error',
});

/* ------------------------------------------------------------------ */
/* In flight                                                           */
/* ------------------------------------------------------------------ */

interface InFlight {
  timer: number | null;
  /** Set only in passthrough mode, where there is a real request to abort. */
  controller: AbortController | null;
}

const inFlight = new Map<string, InFlight>();

/* ------------------------------------------------------------------ */
/* Answering                                                           */
/* ------------------------------------------------------------------ */

/** A mock reply is a status plus a body; the bridge wants ok/not-ok. */
function toResponse(requestId: string, reply: MockReply): HttpResponse {
  if (reply.status < 400) {
    return { requestId, ok: true, status: reply.status, data: reply.body };
  }
  const detail = (reply.body as { detail?: unknown } | null)?.detail;
  return {
    requestId,
    ok: false,
    status: reply.status,
    code: reply.status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
    message:
      typeof detail === 'string' && detail.trim()
        ? detail
        : `Request failed with status code ${reply.status}`,
    data: reply.body,
  };
}

function logRequest(request: HttpRequest, response: HttpResponse): void {
  const colour = response.ok ? 'color:#16a34a' : 'color:#f59e0b';
  const outcome = response.ok ? response.status : (response.code ?? response.status ?? 'failed');
  console.info(
    '%c[mock-backend]',
    colour,
    request.method.toUpperCase(),
    request.url,
    '->',
    outcome,
  );
}

/** Serialise `params` the way the host's axios instance would. */
function toQuery(params: RequestParams | undefined): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/** A real request, for `VITE_DEV_MOCK_API=0`. The credentials are the host's. */
async function passthrough(request: HttpRequest, controller: AbortController): Promise<HttpResponse> {
  const { requestId, method, url, params, body } = request;
  const target = `${config.baseURL.replace(/\/$/, '')}${url}${toQuery(params)}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${config.token}`,
  };
  if (config.companyId) headers['X-Company-ID'] = config.companyId;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const response = await fetch(target, {
    method: method.toUpperCase(),
    headers,
    signal: controller.signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (response.ok) return { requestId, ok: true, status: response.status, data };
  return toResponse(requestId, { status: response.status, body: data });
}

/**
 * Answer one `http.request`. `reply` posts the `http.response` back over the
 * bridge; it is never called for a request that was aborted first.
 */
export function answerHttpRequest(
  request: HttpRequest,
  reply: (response: HttpResponse) => void,
): void {
  const { requestId } = request;
  const settle = (response: HttpResponse): void => {
    if (!inFlight.delete(requestId)) return; // aborted while in flight
    logRequest(request, response);
    reply(response);
  };

  if (shouldFail()) {
    const entry: InFlight = { timer: null, controller: null };
    inFlight.set(requestId, entry);
    entry.timer = window.setTimeout(() => settle(networkFailure(requestId)), LATENCY_MS);
    return;
  }

  if (!config.useMock) {
    const controller = new AbortController();
    inFlight.set(requestId, { timer: null, controller });
    const timeout = window.setTimeout(() => controller.abort(), REAL_TIMEOUT_MS);
    void passthrough(request, controller)
      .then(settle)
      .catch((error: unknown) => {
        settle({
          requestId,
          ok: false,
          code: controller.signal.aborted ? 'ECONNABORTED' : 'ERR_NETWORK',
          message: error instanceof Error ? error.message : 'Network Error',
        });
      })
      .finally(() => window.clearTimeout(timeout));
    return;
  }

  // Routed synchronously — a run is scheduled off the POST that accepted it, and
  // the reply is only *delivered* late so loading states are visible.
  const mockReply = routeRequest(request.method, request.url, request.params ?? {}, request.body);
  const entry: InFlight = { timer: null, controller: null };
  inFlight.set(requestId, entry);
  entry.timer = window.setTimeout(() => settle(toResponse(requestId, mockReply)), LATENCY_MS);
}

/**
 * `http.abort`. The host answers an aborted request the way axios reports one —
 * `ERR_CANCELED` — rather than going silent, so a caller that is still waiting
 * always settles.
 */
export function abortHttpRequest(requestId: string, reply: (response: HttpResponse) => void): void {
  const entry = inFlight.get(requestId);
  if (!entry) return;
  inFlight.delete(requestId);
  if (entry.timer !== null) window.clearTimeout(entry.timer);
  entry.controller?.abort();
  reply({ requestId, ok: false, code: 'ERR_CANCELED', message: 'canceled' });
}
