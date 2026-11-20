import { useSyncExternalStore } from 'react';

import { startPickerListener } from '@/attachments';
import { on, send } from '@/bridge/bridge';
import type { InitPayload } from '@/bridge/protocol';
import { getChatState, initCompanies, openThread, recoverRuns, refreshOpenThread } from '@/chat';
import { loadAccess } from '@/chat/access';
import { configureApi } from '@/lib/api/client';
import { logger } from '@/lib/logger';
import { setVerbose } from '@/lib/verbose';
import {
  connectRealtime,
  disconnectRealtime,
  setReconnectHandler,
  startRealtimeLifecycle,
} from '@/realtime';

import { startLocaleBridge } from '@/i18n';

import { applyInsets, applyTheme, startThemeBridge } from './useTheme';

/**
 * The handshake. Nothing in this app may run before `init` lands: requests have
 * nowhere to go, realtime has no session and the store has no thread until the
 * host says so.
 *
 * No token is applied here any more — there is none to apply. Every REST call
 * goes out through the host over `http.request`, which holds the session itself
 * (see `lib/api/client.ts`).
 *
 * Order matters and is asymmetric — we subscribe first and only then announce
 * ourselves, because the host may answer `ready` on the very next tick.
 */

const log = logger.child('boot');

/** Injected at build time; a dev server without the var still has to post something. */
const APP_VERSION = String(import.meta.env.VITE_APP_VERSION ?? '0.0.0');

/**
 * The WebView can finish loading before the host has attached its `onMessage`
 * handler, in which case our first `ready` is shouted into the void. Re-posting
 * costs one tiny message and is the difference between a working screen and a
 * permanent skeleton.
 */
const READY_RETRY_MS = 3_000;
const READY_TIMEOUT_MS = 15_000;
const MAX_READY_ATTEMPTS = Math.ceil(READY_TIMEOUT_MS / READY_RETRY_MS);

export type BootStatus = 'waiting' | 'ready' | 'failed';

export type BootState = {
  status: BootStatus;
  init: InitPayload | null;
  error: string | null;
};

export type Boot = BootState & { retry: () => void };

let state: BootState = { status: 'waiting', init: null, error: null };

const listeners = new Set<() => void>();

function setState(next: BootState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): BootState {
  return state;
}

/* ---------------------------------------------------------------- */
/* ready -> init                                                     */
/* ---------------------------------------------------------------- */

let started = false;
let attempts = 0;
let readyTimer: number | undefined;

function clearReadyTimer(): void {
  if (readyTimer !== undefined) window.clearTimeout(readyTimer);
  readyTimer = undefined;
}

function postReady(): void {
  attempts += 1;
  log.info(`posting ready (attempt ${attempts})`, { version: APP_VERSION });

  // Arm the retry BEFORE announcing. A host that answers on the same tick — the
  // dev harness does, and a WebView could — would otherwise have its `init` clear
  // a timer that does not exist yet, leaving the retry running over an
  // already-booted chat until it wrongly declared failure.
  readyTimer = window.setTimeout(() => {
    if (state.init) {
      clearReadyTimer();
      return;
    }
    if (attempts >= MAX_READY_ATTEMPTS) {
      clearReadyTimer();
      log.error('the host never sent init');
      setState({
        status: 'failed',
        init: null,
        error: 'The chat could not start. Check your connection and try again.',
      });
      return;
    }
    postReady();
  }, READY_RETRY_MS);

  send('ready', { version: APP_VERSION });
}

/**
 * Idempotent, and deliberately not a React effect: `ready` is posted before the
 * first render so the host can drop its skeleton as early as possible.
 */
export function startBoot(): void {
  if (started) return;
  started = true;

  // Subscribe before announcing: `init` can arrive on the next tick.
  startThemeBridge();
  startLocaleBridge();
  on('init', (payload) => {
    if (state.init) {
      // A second `init` would mean the host re-handshook without reloading the
      // page. Nothing below is re-entrant, so refuse rather than half-apply it.
      log.warn('ignoring a second init');
      return;
    }
    clearReadyTimer();
    applyInit(payload);
  });

  postReady();
}

export function retryBoot(): void {
  if (state.init) return;
  clearReadyTimer();
  attempts = 0;
  setState({ status: 'waiting', init: null, error: null });
  postReady();
}

/* ---------------------------------------------------------------- */
/* Everything init configures                                        */
/* ---------------------------------------------------------------- */

/** Detaches the realtime reconnect nudges. Held so `session.lost` can stop them. */
let stopRealtimeLifecycle: (() => void) | null = null;

function applyInit(init: InitPayload): void {
  try {
    // 0. Before anything that can log: in a debug build every payload this screen
    //    receives is dumped verbatim, and the flag has to be set before the first
    //    of them arrives. Nothing turns this on in a release build.
    setVerbose(init.devMode);

    // 1. The API first: every step below it can issue a request.
    configureApi();

    // 2. Appearance, before the first paint of real content.
    applyTheme(init.theme);
    applyInsets(init.insets);

    // 3. Realtime. A dropped socket loses the events that would have updated the
    //    transcript, so a reconnect re-reads the thread rather than trusting it.
    setReconnectHandler(() => {
      // Then join what is still live: a run that paused or kept writing while the
      // socket was down published to nobody.
      void refreshOpenThread().then(() => recoverRuns('reconnect'));
    });
    stopRealtimeLifecycle = startRealtimeLifecycle();
    void connectRealtime().catch((error: unknown) => {
      // Not fatal: history and sending are REST. Streaming degrades, the screen lives.
      log.error('realtime failed to connect', error);
    });

    // 4. Native pickers answer over the bridge; the listener must exist before
    //    the user can reach the composer.
    startPickerListener();

    // 5. Host messages that only make sense once there is a configured API.
    subscribeToHostEvents();
    // The company pill's choices: only sent while the host has several companies
    // selected, defaulting to the company the host acts for.
    initCompanies(init.companies, init.companyId);
    // The role and permissions behind the new-chat screen's starter chips. Its
    // failure hides nothing — the chips just stay unfiltered.
    void loadAccess(init.companyId);

    // 6. The thread itself.
    void openThread(init.threadId);

    setState({ status: 'ready', init, error: null });
    // The whole handshake, not just two fields of it. This is the only record of
    // what the screen was configured with, and a wrong `companyId` or a stale
    // `threadId` explains an empty or foreign-looking chat in one line. There is
    // no token in `InitPayload` by design (see `bridge/protocol.ts`), so the
    // payload is safe to print as it stands.
    log.info('boot complete', {
      threadId: init.threadId,
      devMode: init.devMode,
      companyId: init.companyId,
      userUuid: init.userUuid,
      locale: init.locale,
      appVersion: init.appVersion,
      webVersion: APP_VERSION,
      theme: init.theme,
      insets: init.insets,
    });
  } catch (error) {
    log.error('boot failed', error);
    setState({
      status: 'failed',
      init: null,
      error: error instanceof Error ? error.message : 'The chat could not start.',
    });
  }
}

let subscribedToHost = false;

function subscribeToHostEvents(): void {
  if (subscribedToHost) return;
  subscribedToHost = true;

  // The host owns the conversation list; switching threads never remounts us.
  on('thread.switch', (payload) => {
    void openThread(payload.threadId);
  });

  // The voice overlay writes its turns server-side, so the only way to see them
  // is to re-import the thread once it closes.
  on('voice.ended', (payload) => {
    log.debug('voice ended', payload);
    const { conversationUuid } = payload;
    // Voice may have created a conversation (started from 'new') or continued a
    // different one than the screen is on. Following it is the only way the user
    // sees the turns they just spoke; refreshing here would show the wrong thread.
    if (conversationUuid && conversationUuid !== getChatState().conversationUuid) {
      void openThread(conversationUuid);
      return;
    }
    void refreshOpenThread();
  });

  // The session is gone and the host is running its own sign-out. REST needs
  // nothing from us — the host fails those itself — but the websocket is opened
  // from here, so close it and stop the reconnect nudges: it would otherwise keep
  // retrying with a Centrifugo token nobody can mint any more.
  on('session.lost', (payload) => {
    log.warn('session lost — closing realtime', { message: payload.message });
    disconnectRealtime();
    stopRealtimeLifecycle?.();
    stopRealtimeLifecycle = null;
  });

  // Visibility (the socket) is handled inside `startRealtimeLifecycle`. Coming
  // back to the foreground is also when a run may have moved on without us — an
  // approval raised, or a reply still being written — so check for one.
  on('app.state', (payload) => {
    log.debug(`app ${payload.active ? 'active' : 'backgrounded'}`);
    if (payload.active) void recoverRuns('foreground');
  });

  on('nav.back', () => {
    const consumed = dismissTopOverlay();
    send('nav.consumed', { consumed });
  });
}

/**
 * Android hardware back closes what sits on top of the chat before it leaves the
 * screen. There is no overlay registry to consult — sheets and the image viewer
 * are portalled by components this module does not own — so we ask the DOM the
 * same question a screen reader would, and dismiss the same way a keyboard user
 * would. Every overlay in this app closes on Escape; one that does not is a bug
 * in that overlay, not here.
 */
function dismissTopOverlay(): boolean {
  // `:not(.pointer-events-none)` skips a sheet that is already playing its
  // slide-out — it is still in the DOM for ~260ms, and consuming back for it
  // would eat a press that should have left the screen.
  const overlay = document.querySelector(
    '[role="dialog"][aria-modal="true"]:not(.pointer-events-none), [data-overlay="open"]',
  );
  if (!overlay) return false;
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return true;
}

/* ---------------------------------------------------------------- */
/* Hook                                                              */
/* ---------------------------------------------------------------- */

export function useBoot(): Boot {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { ...snapshot, retry: retryBoot };
}
