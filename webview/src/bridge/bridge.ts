import {
  BRIDGE_PROTOCOL_VERSION,
  isBridgeEnvelope,
  type BridgeEnvelope,
  type NativeToWebPayload,
  type NativeToWebType,
  type WebToNativePayload,
  type WebToNativeType,
} from './protocol';

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage: (data: string) => void };
  }
}

type Handler = (payload: unknown) => void;

const handlers = new Map<string, Set<Handler>>();

/** True when this page runs inside the native host rather than a browser tab. */
export const hasNativeHost = (): boolean => typeof window.ReactNativeWebView !== 'undefined';

/**
 * In a plain browser (`npm run dev`) there is no native host. The dev harness
 * installs itself here so the app can run and be styled without a device.
 */
let devHost: ((envelope: BridgeEnvelope) => void) | null = null;

export function setDevHost(host: ((envelope: BridgeEnvelope) => void) | null): void {
  devHost = host;
}

export function send<T extends WebToNativeType>(
  type: T,
  ...args: WebToNativePayload<T> extends undefined ? [] : [payload: WebToNativePayload<T>]
): void {
  const envelope: BridgeEnvelope = {
    v: BRIDGE_PROTOCOL_VERSION,
    type,
    ...(args.length > 0 ? { payload: args[0] } : {}),
  };
  const serialised = JSON.stringify(envelope);

  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(serialised);
    return;
  }
  devHost?.(envelope);
}

export function on<T extends NativeToWebType>(
  type: T,
  handler: (payload: NativeToWebPayload<T>) => void,
): () => void {
  const set = handlers.get(type) ?? new Set<Handler>();
  set.add(handler as Handler);
  handlers.set(type, set);
  return () => {
    set.delete(handler as Handler);
  };
}

/** Wait for one message of `type`, with a timeout so nothing hangs forever. */
export function once<T extends NativeToWebType>(
  type: T,
  timeoutMs = 10_000,
): Promise<NativeToWebPayload<T>> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      off();
      reject(new Error(`Timed out waiting for "${type}" from the host`));
    }, timeoutMs);
    const off = on(type, (payload) => {
      window.clearTimeout(timer);
      off();
      resolve(payload as never);
    });
  });
}

function dispatch(raw: unknown): void {
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return; // Not ours. Never throw on foreign traffic.
    }
  }
  if (!isBridgeEnvelope(parsed)) return;

  const set = handlers.get(parsed.type);
  if (!set || set.size === 0) {
    if (import.meta.env.DEV) console.warn('[bridge] unhandled message', parsed.type);
    return;
  }
  for (const handler of [...set]) {
    try {
      handler(parsed.payload);
    } catch (error) {
      console.error('[bridge] handler threw', parsed.type, error);
    }
  }
}

let listening = false;

/** Idempotent. Call once, before anything subscribes. */
export function startBridge(): void {
  if (listening) return;
  listening = true;

  const listener = (event: MessageEvent) => dispatch(event.data);
  // iOS delivers on window, Android on document — react-native-webview quirk.
  window.addEventListener('message', listener);
  document.addEventListener('message', listener as EventListener);
}

/** Push a message in as if it came from the host. Used by the dev harness. */
export function receive(envelope: BridgeEnvelope): void {
  dispatch(envelope);
}
