/**
 * A mock of the native host, for running this app in a plain browser tab.
 *
 * DEV ONLY. The module is reached through a dynamic import that is dead-code
 * eliminated in a production build (see `src/dev/index.ts`), so nothing here —
 * including the panel, the mock backend and the HTTP layer it pulls in — ships
 * in `dist/index.html`.
 *
 * It answers the handshake with a full `init`, performs every `http.request` the
 * app posts, holds picked files for `attachment.upload`, and logs every
 * web -> native message so the protocol can be watched while developing.
 *
 * The `init` it sends carries **no token and no baseURL**, exactly like the real
 * host's: the session lives out here now. `http.request` is the only way the app
 * reaches an API, which is the whole point of the transport — a page loaded from
 * `file://` has a `null` origin and the API's CORS allowlist refuses it.
 *
 * The panel lives in `devPanel.ts`, the endpoint table in `mockBackend.ts`, the
 * request/response half in `mockHttp.ts` and the retained files in `hostFiles.ts`.
 */

import { hasNativeHost, receive, setDevHost } from '@/bridge/bridge';
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeEnvelope,
  type HttpRequest,
  type InitPayload,
  type Insets,
  type NativeToWebMessage,
  type ThemeName,
  type ThreadTarget,
  type WebToNativePayload,
} from '@/bridge/protocol';

import { mountDevPanel } from './devPanel';
import { pickFilesAsHost, releaseHeldFile, uploadHeldFile } from './hostFiles';
import {
  abortHttpRequest,
  answerHttpRequest,
  configureHostHttp,
  failNextRequest,
  getNetworkMode,
  toggleNetworkMode,
} from './mockHttp';
import { installMockBackend } from './mockBackend';

const env = import.meta.env as Record<string, string | undefined>;

const read = (key: string, fallback: string): string => {
  const value = env[key];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
};

/**
 * Whether to answer requests from the mock backend. **On by default**: `npm run
 * dev` in a browser tab has no TMS to talk to, and a harness whose whole purpose
 * is to build the chat with no backend must not depend on a `.env.local` that is
 * not in the repo — that is precisely how it came to make real, refused network
 * calls. Set `VITE_DEV_MOCK_API=0` and the host performs each `http.request` for
 * real against `VITE_DEV_BASE_URL`, with the token below.
 */
const mockApiEnabled = (): boolean =>
  !['0', 'false', 'no', 'off'].includes(read('VITE_DEV_MOCK_API', '1').toLowerCase());

/** Keyboard height the panel simulates, in CSS pixels. */
const SIMULATED_KEYBOARD = 320;

/** How long the host takes to "upload" a file it is holding. */
const UPLOAD_MS = 450;

const prefersDark = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches;

const NO_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0, keyboard: 0 };

type DevState = {
  theme: ThemeName;
  insets: Insets;
  appActive: boolean;
};

const state: DevState = {
  theme: read('VITE_DEV_THEME', prefersDark() ? 'dark' : 'light') === 'dark' ? 'dark' : 'light',
  insets: { ...NO_INSETS },
  appActive: true,
};

const companyId = (): string => read('VITE_DEV_COMPANY_ID', '00000000-0000-0000-0000-000000000001');
const userUuid = (): string => read('VITE_DEV_USER_UUID', '00000000-0000-0000-0000-000000000002');

function initPayload(): InitPayload {
  return {
    companyId: companyId(),
    userUuid: userUuid(),
    threadId: read('VITE_DEV_THREAD_ID', 'new'),
    theme: state.theme,
    insets: state.insets,
    locale: read('VITE_DEV_LOCALE', navigator.language || 'en-US'),
    appVersion: read('VITE_DEV_APP_VERSION', '0.0.0-dev'),
    devMode: true,
  };
}

/** Push a native -> web message in, on a timer so it never lands mid-`send()`. */
function push(message: NativeToWebMessage, delayMs = 0): void {
  const envelope: BridgeEnvelope = {
    v: BRIDGE_PROTOCOL_VERSION,
    type: message.type,
    ...(message.payload !== undefined ? { payload: message.payload } : {}),
  };
  window.setTimeout(() => {
    console.info(
      '%c[dev-host] native -> web',
      'color:#8b5cf6',
      envelope.type,
      envelope.payload ?? '',
    );
    receive(envelope);
  }, delayMs);
}

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

/**
 * Open a picker as the host and announce the result. The app only sends
 * `attachment.pick` when it believes it is inside a native host, so in a browser
 * this is normally reached from the DEV panel instead — the composer's own
 * button falls back to `<input type="file">` in the app.
 */
function pickAsHost(): void {
  void pickFilesAsHost()
    .then((files) => {
      if (files.length === 0) {
        push({ type: 'attachment.pick.cancelled' });
        return;
      }
      push({ type: 'attachment.picked', payload: { files } });
    })
    .catch((error: unknown) => {
      console.error('[dev-host] picking failed', error);
      push({ type: 'attachment.pick.cancelled' });
    });
}

/* ------------------------------------------------------------------ */
/* web -> native                                                       */
/* ------------------------------------------------------------------ */

function handle(envelope: BridgeEnvelope): void {
  console.info('%c[dev-host] web -> native', 'color:#1f7bd1', envelope.type, envelope.payload ?? '');

  switch (envelope.type) {
    case 'ready':
      push({ type: 'init', payload: initPayload() }, 16);
      break;

    // Every REST call the app makes arrives here. Nothing else can reach an API.
    case 'http.request': {
      const request = envelope.payload as HttpRequest;
      answerHttpRequest(request, (payload) => push({ type: 'http.response', payload }));
      break;
    }

    case 'http.abort': {
      const { requestId } = envelope.payload as WebToNativePayload<'http.abort'>;
      abortHttpRequest(requestId, (payload) => push({ type: 'http.response', payload }));
      break;
    }

    case 'attachment.pick':
      pickAsHost();
      break;

    case 'attachment.upload': {
      const { id } = envelope.payload as WebToNativePayload<'attachment.upload'>;
      const uuid = uploadHeldFile(id);
      push({ type: 'attachment.uploaded', payload: { id, uuid } }, UPLOAD_MS);
      break;
    }

    case 'attachment.release': {
      const { id } = envelope.payload as WebToNativePayload<'attachment.release'>;
      releaseHeldFile(id);
      break;
    }

    case 'attachment.thumbnail.request': {
      const payload = envelope.payload as
        | WebToNativePayload<'attachment.thumbnail.request'>
        | undefined;
      push(
        {
          type: 'attachment.thumbnail',
          payload: { localId: payload?.localId ?? '', dataUri: null },
        },
        30,
      );
      break;
    }

    case 'open.url':
    case 'attachment.open': {
      const url = (envelope.payload as { url?: string } | undefined)?.url;
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      break;
    }

    case 'clipboard.write': {
      const text = (envelope.payload as { text?: string } | undefined)?.text ?? '';
      void navigator.clipboard?.writeText(text).catch(() => undefined);
      break;
    }

    default:
      // haptic / open.voice / open.list / open.integrations / thread.* / nav.consumed /
      // generative.action / log / error — logged above, nothing to answer.
      break;
  }
}

/* ------------------------------------------------------------------ */

/** What the panel is allowed to do to the host, and nothing more. */
const panelController = {
  theme: (): string => state.theme,
  toggleTheme: (): void => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    push({ type: 'theme.set', payload: { theme: state.theme } });
  },
  keyboardHeight: (): number => state.insets.keyboard,
  toggleKeyboard: (): void => {
    state.insets = { ...state.insets, keyboard: state.insets.keyboard > 0 ? 0 : SIMULATED_KEYBOARD };
    push({ type: 'insets.set', payload: state.insets });
  },
  safeArea: (): boolean => state.insets.bottom > 0,
  toggleSafeArea: (): void => {
    const on = state.insets.bottom > 0;
    state.insets = { ...state.insets, top: on ? 0 : 12, bottom: on ? 0 : 34 };
    push({ type: 'insets.set', payload: state.insets });
  },
  appActive: (): boolean => state.appActive,
  toggleAppState: (): void => {
    state.appActive = !state.appActive;
    push({ type: 'app.state', payload: { active: state.appActive } });
  },
  navBack: (): void => {
    push({ type: 'nav.back' });
  },
  /** The host lost the session and is signing the user out. */
  loseSession: (): void => {
    push({ type: 'session.lost', payload: { message: 'Session expired (dev)' } });
  },
  network: getNetworkMode,
  toggleNetwork: (): void => {
    toggleNetworkMode();
  },
  failNextRequest,
  pickFiles: pickAsHost,
  openThread: (threadId: ThreadTarget): void => {
    push({ type: 'thread.switch', payload: { threadId } });
  },
};

let installed = false;

/** Idempotent. A no-op when a real native host is present. */
export function startDevHost(): void {
  if (!import.meta.env.DEV || installed || hasNativeHost()) return;
  installed = true;

  const useMock = mockApiEnabled();

  // Before anything answers `ready`: `init` starts the API, the realtime
  // connection and the first three requests on the very next tick, and the
  // connection token the first of them returns has to point at the mock socket.
  configureHostHttp({
    useMock,
    baseURL: read('VITE_DEV_BASE_URL', 'http://localhost:8000'),
    token: read('VITE_DEV_TOKEN', 'dev-token'),
    companyId: companyId(),
  });
  if (useMock) installMockBackend(userUuid());
  else console.info('%c[dev-host] VITE_DEV_MOCK_API=0 — talking to a real backend', 'color:#f59e0b');

  setDevHost(handle);
  console.info('%c[dev-host] installed — the app is talking to a mock host', 'color:#1f7bd1');

  const mount = (): void => {
    mountDevPanel(panelController);
  };
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
}
