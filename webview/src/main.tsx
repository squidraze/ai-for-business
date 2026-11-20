import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { startBoot } from '@/app/boot';
import { startBridge } from '@/bridge/bridge';
import { reportFatal } from '@/lib/logger';

import App from './App.tsx';
import './index.css';

/**
 * The entry point does four things, in this order:
 *   1. open the bridge — nothing may subscribe before the listener exists;
 *   2. install the crash reporter — a throw during step 3 or 4 must still reach
 *      Sentry through the native logger, not die in a WebView console nobody
 *      reads;
 *   3. in DEV only, install the harness that plays the native host;
 *   4. post `ready` and mount.
 */

startBridge();

// `addEventListener`, not `window.onerror =`: assigning would silently replace
// whatever the runtime (or a future dev overlay) has already installed.
window.addEventListener('error', (event) => {
  reportFatal(event.error ?? event.message, {
    source: 'window.onerror',
    filename: event.filename,
    line: event.lineno,
    column: event.colno,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  reportFatal(event.reason, { source: 'unhandledrejection' });
});

function start(): void {
  // Before React: the sooner `ready` goes out, the sooner the host's skeleton
  // can cross-fade away.
  startBoot();

  const container = document.getElementById('root');
  if (!container) throw new Error('#root is missing from index.html');

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

if (import.meta.env.DEV) {
  // The harness answers `ready` with an `init`, so it has to be listening before
  // `ready` goes out. `installDevHost()` returns before its own dynamic import
  // settles, so we await that module too: both resolve the same module record,
  // and the harness registered its continuation first, so by the time this one
  // runs the host is installed. Without it the first `ready` is dropped and dev
  // waits out the 3s re-post on every reload.
  // `import.meta.env.DEV` is statically false in a build, so neither the branch
  // nor `src/dev/*` reaches the production bundle.
  void import('@/dev')
    .then(async (module) => {
      module.installDevHost();
      await import('@/dev/devHost');
    })
    .catch((error: unknown) => reportFatal(error, { source: 'dev-host' }))
    .finally(start);
} else {
  start();
}
