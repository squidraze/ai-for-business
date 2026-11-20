import axios, {
  AxiosError,
  AxiosHeaders,
  CanceledError,
  type AxiosAdapter,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';

import { hasNativeHost, on, send } from '@/bridge/bridge';
import type { HttpMethod, HttpRequest, HttpResponse } from '@/bridge/protocol';
import { t } from '@/i18n';
import { logger } from '@/lib/logger';

const log = logger.child('api');

/**
 * WHY this app never touches the network.
 *
 * The page is loaded from `file://`, so its origin is `null` and every API call
 * is cross-origin. The backend runs a strict CORS allowlist with
 * `allow-credentials: true` — which rules out `*` — and answers
 * `400 Disallowed CORS origin` to a `null`-origin preflight. Measured on a
 * device: every request from here fails with ERR_NETWORK while the host's
 * identical request succeeds.
 *
 * So only the *transport* moves. axios stays, with its whole surface intact
 * (typed responses, `signal`, `AxiosError`), and a custom adapter posts
 * `http.request` over the bridge; the host performs it with the session it
 * already holds and answers `http.response`. Nothing downstream — `ai.ts`,
 * `errors.ts`, every caller — changes, which is the point of doing it here.
 *
 * Consequences worth knowing:
 * - No token and no baseURL ever reach the WebView. The host owns both, and it
 *   owns the headers too: the protocol has no field for them on purpose.
 * - Requests go out as **paths** (`/api/v1/…`). The host refuses anything else.
 */

/**
 * Deliberately longer than a plain HTTP timeout: this window covers the bridge
 * hop *plus* the host's own request, and the host reports its own timeout as
 * ECONNABORTED long before this fires. It is a floor, not a policy — its job is
 * that a dropped `http.response` cannot hang a promise forever.
 */
const REQUEST_TIMEOUT_MS = 30_000;

const HTTP_METHODS: readonly HttpMethod[] = ['get', 'post', 'patch', 'put', 'delete'];

/* ------------------------------------------------------------------ */
/* In-flight requests                                                  */
/* ------------------------------------------------------------------ */

type Pending = {
  settle: (result: HttpResponse) => void;
  /** Removes the id, the timer and the abort listener. Runs exactly once. */
  dispose: () => void;
};

const pending = new Map<string, Pending>();

let requestSeq = 0;
const nextRequestId = (): string => `req-${(requestSeq += 1)}`;

let listening = false;

/**
 * Subscribed lazily on the first request: the handler is pure bookkeeping over
 * the map above and has to outlive any one caller.
 */
function listenForResponses(): void {
  if (listening) return;
  listening = true;

  on('http.response', (payload) => {
    const entry = pending.get(payload.requestId);
    // Nothing is waiting, so this is a straggler for a request that already
    // timed out or was aborted. Dropping it is the whole point: it must never
    // resolve a promise its caller has moved on from.
    if (!entry) {
      log.debug('discarding a late http.response', { requestId: payload.requestId });
      return;
    }
    entry.dispose();
    entry.settle(payload);
  });
}

/* ------------------------------------------------------------------ */
/* config -> HttpRequest                                               */
/* ------------------------------------------------------------------ */

function methodOf(config: InternalAxiosRequestConfig): HttpMethod | null {
  const method = (config.method ?? 'get').toLowerCase();
  return HTTP_METHODS.find((candidate) => candidate === method) ?? null;
}

/** Path only — an absolute or protocol-relative URL is a bug, not a request. */
function pathOf(config: InternalAxiosRequestConfig): string | null {
  const url = config.url ?? '';
  if (!url.startsWith('/') || url.startsWith('//')) return null;
  return url;
}

/**
 * The adapter is called before any URL building, so `params` arrives raw and
 * crosses the bridge as its own field. Only JSON-safe scalars survive; the host
 * serialises them.
 */
function paramsOf(config: InternalAxiosRequestConfig): HttpRequest['params'] {
  const raw: unknown = config.params;
  if (typeof raw !== 'object' || raw === null) return undefined;

  const params: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      params[key] = value;
    }
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

/* ------------------------------------------------------------------ */
/* HttpResponse -> AxiosResponse / AxiosError                          */
/* ------------------------------------------------------------------ */

function toResponse(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
): AxiosResponse {
  return { data, status, statusText: '', headers: new AxiosHeaders(), config };
}

const codeForStatus = (status: number): string =>
  status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST;

function statusIsOk(config: InternalAxiosRequestConfig, status: number): boolean {
  return config.validateStatus ? config.validateStatus(status) : status >= 200 && status < 300;
}

/**
 * `errors.ts` reads exactly three things off a failure: `response.status`,
 * `response.data.detail` and `code`. All three are populated here, so a 409 with
 * an `active_run_uuid` still trips `isActiveRunConflict`, an ECONNABORTED still
 * reads as "timed out", and a failure with no `response` at all still reads as
 * "no connection".
 */
function toError(
  config: InternalAxiosRequestConfig,
  failure: Extract<HttpResponse, { ok: false }>,
): AxiosError {
  const response =
    failure.status === undefined ? undefined : toResponse(config, failure.status, failure.data);
  const code =
    failure.code ??
    (response ? codeForStatus(response.status) : AxiosError.ERR_NETWORK);
  return new AxiosError(failure.message || t('errors.requestFailed'), code, config, undefined, response);
}

/* ------------------------------------------------------------------ */
/* The adapter                                                         */
/* ------------------------------------------------------------------ */

const bridgeAdapter: AxiosAdapter = (config) =>
  new Promise<AxiosResponse>((resolve, reject) => {
    const method = methodOf(config);
    const url = pathOf(config);
    if (method === null || url === null) {
      reject(
        new AxiosError(
          `Unsupported request: ${config.method ?? 'get'} ${config.url ?? ''}`,
          AxiosError.ERR_BAD_REQUEST,
          config,
        ),
      );
      return;
    }

    const body: unknown = config.data;
    // A multipart body cannot cross a JSON bridge. Inside the host, attachments
    // go the other way entirely (`attachment.upload`), so this is only reachable
    // by mistake — and a silent `{}` body would be a miserable thing to debug.
    if (hasNativeHost() && typeof FormData !== 'undefined' && body instanceof FormData) {
      reject(
        new AxiosError(
          'A multipart body cannot be sent over the bridge — use attachment.upload.',
          AxiosError.ERR_BAD_REQUEST,
          config,
        ),
      );
      return;
    }

    const signal = config.signal;
    // Already cancelled before we sent anything: there is nothing for the host to
    // abort, so post nothing and reject in the shape `isAbortError` expects.
    if (signal?.aborted === true) {
      reject(new CanceledError(undefined, config));
      return;
    }

    listenForResponses();
    const requestId = nextRequestId();

    // Armed before anything can settle, so `dispose` always has a timer to clear.
    // Its callback only runs later, by which point the hoisted helpers below exist.
    const timeoutMs = config.timeout && config.timeout > 0 ? config.timeout : REQUEST_TIMEOUT_MS;
    const timer = window.setTimeout(() => {
      dispose();
      send('http.abort', { requestId });
      reject(
        new AxiosError(
          `timeout of ${timeoutMs}ms exceeded`,
          AxiosError.ECONNABORTED,
          config,
          undefined,
        ),
      );
    }, timeoutMs);

    function dispose(): void {
      pending.delete(requestId);
      window.clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }

    function onAbort(): void {
      dispose();
      // Tell the host to drop it: an in-flight AI send is stopped this way.
      send('http.abort', { requestId });
      reject(new CanceledError(undefined, config));
    }

    function settle(result: HttpResponse): void {
      if (!result.ok) {
        reject(toError(config, result));
        return;
      }
      const response = toResponse(config, result.status, result.data);
      // The host reports a 4xx/5xx as `ok: false`, but honour `validateStatus`
      // anyway so a status that slips through the wrong door still throws.
      if (statusIsOk(config, result.status)) resolve(response);
      else {
        reject(
          new AxiosError(
            t('errors.requestFailedStatus', { status: result.status }),
            codeForStatus(result.status),
            config,
            undefined,
            response,
          ),
        );
      }
    }

    pending.set(requestId, { settle, dispose });
    signal?.addEventListener?.('abort', onAbort);

    const params = paramsOf(config);
    send('http.request', {
      requestId,
      method,
      url,
      ...(params ? { params } : {}),
      ...(body === undefined ? {} : { body }),
    });
  });

/* ------------------------------------------------------------------ */
/* The instance                                                        */
/* ------------------------------------------------------------------ */

let instance: AxiosInstance | null = null;

/**
 * Nothing from `init` is applied any more — there is no token and no baseURL to
 * apply. This stays a step of the handshake because the gate still matters: a
 * request issued before the host is listening would only ever time out.
 */
export function configureApi(): void {
  instance = axios.create({
    adapter: bridgeAdapter,
    timeout: REQUEST_TIMEOUT_MS,
    // The host owns (de)serialisation: it encodes `body` and hands back already
    // parsed `data`. axios's default transforms would stringify the body here
    // and re-parse the reply — wasted at best, mangling at worst.
    transformRequest: [],
    transformResponse: [],
  });
}

export function api(): AxiosInstance {
  if (!instance) throw new Error('The API client was used before `init` arrived');
  return instance;
}

/** Re-export so callers do not import axios directly just to narrow an error. */
export { AxiosError };
