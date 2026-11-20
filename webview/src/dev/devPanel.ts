/**
 * The floating DEV panel.
 *
 * DEV ONLY — mounted from `startDevHost()`, which only runs behind the
 * dead-code-eliminated dynamic import in `src/dev/index.ts`.
 *
 * It drives the three things a browser tab cannot produce on its own (the native
 * theme, the keyboard inset and a native file pick) and, when the mock backend
 * is installed, the states a developer otherwise needs a real backend to see: a
 * thread with history, an empty thread, a run that fails, a run that is
 * cancelled and a run that pauses for human approval.
 *
 * The Transport section injects the failures the bridge carries: a request that
 * comes back `ok: false` with `ERR_NETWORK` — the one that moved REST onto the
 * bridge in the first place — and the `session.lost` the host sends when it is
 * signing the user out.
 *
 * It sits **top-right**. It used to sit bottom-right, on top of the composer's
 * send button — the one control you have to click to test anything.
 */

import type { ThreadTarget } from '@/bridge/protocol';

import { MOCK_THREADS, isMockInstalled } from './mockBackend';
import {
  RUN_MODE_LABELS,
  cancelLiveRun,
  cycleRunMode,
  getRunMode,
  hasLiveRun,
} from './mockRuns';

/** Everything the panel needs from the dev host, without reaching into its state. */
export interface DevPanelController {
  theme: () => string;
  toggleTheme: () => void;
  keyboardHeight: () => number;
  toggleKeyboard: () => void;
  safeArea: () => boolean;
  toggleSafeArea: () => void;
  appActive: () => boolean;
  toggleAppState: () => void;
  navBack: () => void;
  loseSession: () => void;
  network: () => string;
  toggleNetwork: () => void;
  failNextRequest: () => void;
  pickFiles: () => void;
  openThread: (threadId: ThreadTarget) => void;
}

/**
 * Inline styles, not classes — but mind the *words*, in the comments too.
 *
 * Tailwind v4 scans every source file it is not told to skip, this one included,
 * and a bare utility name anywhere in it is a candidate. A single CSS
 * declaration in the panel's own styles was enough to put a rule nothing renders
 * into `dist/index.html`. The JS here is dropped from the production build; a
 * class name a stray word generates is not. Measured proof, and how to redo the
 * measurement, is in the harness notes — the build must come out byte-identical
 * to one made with `src/dev` emptied.
 */
const BUTTON_CSS =
  'display:block;width:100%;margin:0 0 4px;padding:6px 8px;border:1px solid #3f3f46;' +
  'border-radius:6px;background:#18181b;color:#fafafa;font:inherit;text-align:left;cursor:pointer';

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.style.cssText = BUTTON_CSS;
  el.addEventListener('click', onClick);
  return el;
}

/** A section label. The rule above it separates sections, so the first has none. */
function heading(text: string, first = false): HTMLDivElement {
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    `margin:${first ? '0' : '8px'} 0 4px;color:#a1a1aa;font-size:10px;letter-spacing:.08em` +
    (first ? '' : ';padding-top:8px;border-top:1px solid #3f3f46');
  return el;
}

export function mountDevPanel(controller: DevPanelController): void {
  const root = document.createElement('div');
  root.id = 'webchat-dev-panel';
  // Top-right, and the column is right-aligned so the toggle keeps its place
  // when the wider body opens under it.
  root.style.cssText =
    'position:fixed;right:8px;top:8px;z-index:2147483647;display:flex;flex-direction:column;' +
    'align-items:flex-end;font:12px/1.4 ui-sans-serif,system-ui,sans-serif';

  const body = document.createElement('div');
  body.style.cssText =
    'display:none;width:208px;margin-top:6px;padding:8px;border:1px solid #3f3f46;' +
    'border-radius:10px;background:rgba(9,9,11,.94);color:#fafafa;' +
    'max-height:78vh;overflow:auto';

  const themeBtn = button('', () => {
    controller.toggleTheme();
    render();
  });
  const keyboardBtn = button('', () => {
    controller.toggleKeyboard();
    render();
  });
  const safeAreaBtn = button('', () => {
    controller.toggleSafeArea();
    render();
  });
  const appStateBtn = button('', () => {
    controller.toggleAppState();
    render();
  });

  const networkBtn = button('', () => {
    controller.toggleNetwork();
    render();
  });

  body.append(
    heading('Native host', true),
    themeBtn,
    keyboardBtn,
    safeAreaBtn,
    appStateBtn,
    button('Send nav.back', controller.navBack),
    button('Pick files (as the host)', controller.pickFiles),
    heading('Transport'),
    networkBtn,
    button('Fail the next request', () => {
      controller.failNextRequest();
      console.info('[dev-panel] the next http.request will fail with ERR_NETWORK');
    }),
    button('Lose the session', controller.loseSession),
  );

  const runModeBtn = button('', () => {
    cycleRunMode();
    render();
  });

  if (isMockInstalled()) {
    body.append(
      heading('Mock backend'),
      runModeBtn,
      button('Cancel the live run', () => {
        if (!cancelLiveRun()) console.info('[dev-panel] no run is in flight');
      }),
      heading('Open a thread'),
      button('Thread with history', () => controller.openThread(MOCK_THREADS.history)),
      button('Empty thread', () => controller.openThread(MOCK_THREADS.empty)),
      button('Agent thread', () => controller.openThread(MOCK_THREADS.agent)),
      button('New thread', () => controller.openThread('new')),
    );
  }

  function render(): void {
    themeBtn.textContent = `Theme: ${controller.theme()}`;
    const keyboard = controller.keyboardHeight();
    keyboardBtn.textContent = `Keyboard: ${keyboard > 0 ? `${keyboard}px` : 'closed'}`;
    safeAreaBtn.textContent = `Safe area: ${controller.safeArea() ? 'on' : 'off'}`;
    appStateBtn.textContent = `App: ${controller.appActive() ? 'active' : 'background'}`;
    networkBtn.textContent = `Network: ${controller.network()}`;
    runModeBtn.textContent = `Next run ${RUN_MODE_LABELS[getRunMode()]}${
      hasLiveRun() ? ' (one is live)' : ''
    }`;
  }

  // Small and half-transparent while closed: it sits over the top of the
  // transcript, and the transcript is the thing being looked at.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = 'DEV';
  toggle.style.cssText =
    'padding:2px 7px;border:1px solid #3f3f46;border-radius:999px;background:#1f7bd1;' +
    'color:#fff;font:600 9px/1.6 ui-sans-serif,system-ui,sans-serif;letter-spacing:.06em;' +
    'cursor:pointer;opacity:.45';
  const setOpacity = (value: string): void => {
    if (body.style.display === 'none') toggle.style.opacity = value;
  };
  toggle.addEventListener('mouseenter', () => setOpacity('1'));
  toggle.addEventListener('mouseleave', () => setOpacity('.45'));
  toggle.addEventListener('click', () => {
    const open = body.style.display === 'none';
    body.style.display = open ? 'block' : 'none';
    toggle.style.opacity = open ? '1' : '.45';
    if (open) render();
  });

  render();
  root.append(toggle, body);
  document.body.append(root);
}
