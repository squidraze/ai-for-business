/**
 * Where the WebView chat page comes from (simplified from the Rooler business
 * app's src/features/ai-chat/webchat/bundle.ts).
 *
 * - **dev** — `EXPO_PUBLIC_WEBCHAT_DEV_URL` points at the Vite dev server of
 *   `webview/`; read only under `__DEV__`.
 * - **bundled** — the single-file build at `assets/webchat/index.html`, copied
 *   there by `npm run sync` in `webview/`. Loaded through `expo-asset` so it is a
 *   real `file://` URI. A committed placeholder posts an `error` carrying
 *   {@link WEBCHAT_PLACEHOLDER_MARKER} until the real bundle lands.
 */
import { Asset } from 'expo-asset';
import { useEffect, useState } from 'react';

import { createLogger } from '@/lib/log';

const log = createLogger('webchat.bundle');

export const WEBCHAT_DEV_URL: string | null = __DEV__
  ? (process.env.EXPO_PUBLIC_WEBCHAT_DEV_URL?.trim() ?? '') || null
  : null;

/** How long we wait for the web app's `ready` before calling the load failed. */
export const WEBCHAT_READY_TIMEOUT_MS = 20_000;

/** Posted by the placeholder page in its `error` message. */
export const WEBCHAT_PLACEHOLDER_MARKER = 'WEBCHAT_BUNDLE_PLACEHOLDER';

export const WEBCHAT_MISSING_MESSAGE =
  'The chat bundle is missing. Run "npm run sync" in webview/ and reload the app.';

let bundleModule: number | null = null;
try {
  bundleModule = require('../../../../assets/webchat/index.html') as number;
} catch {
  bundleModule = null;
}

export type WebchatSource =
  | { status: 'loading' }
  | { status: 'ready'; uri: string; isDev: boolean }
  | { status: 'missing'; message: string };

/** The origin (dev) or containing directory (bundled) navigations must stay inside. */
export function navigationBaseOf(source: { uri: string; isDev: boolean }): string {
  if (source.isDev) {
    const match = /^(https?:\/\/[^/]+)/i.exec(source.uri);
    return match ? match[1] : source.uri;
  }
  const lastSlash = source.uri.lastIndexOf('/');
  return lastSlash > 0 ? source.uri.slice(0, lastSlash + 1) : source.uri;
}

/** react-native-webview matches `originWhitelist` against the origin only; `file://` for a file. */
export function originWhitelistOf(source: { uri: string; isDev: boolean }): string[] {
  return source.isDev ? [`${navigationBaseOf(source)}*`] : ['file://*'];
}

const normaliseFileUrl = (url: string) =>
  url.replace(/^file:\/\/\/private\/var\//, 'file:///var/');

export function isInsideNavigationBase(url: string, navigationBase: string): boolean {
  if (!navigationBase) return false;
  return normaliseFileUrl(url).startsWith(normaliseFileUrl(navigationBase));
}

/** Resolve the page to load. `reloadKey` re-runs it (retry / crash remount). */
export function useWebchatSource(reloadKey: number): WebchatSource {
  const [source, setSource] = useState<WebchatSource>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    setSource({ status: 'loading' });

    if (WEBCHAT_DEV_URL) {
      log.info('loading the web chat from the dev server', { url: WEBCHAT_DEV_URL });
      setSource({ status: 'ready', uri: WEBCHAT_DEV_URL, isDev: true });
      return;
    }

    if (bundleModule == null) {
      setSource({ status: 'missing', message: WEBCHAT_MISSING_MESSAGE });
      return;
    }

    void (async () => {
      try {
        const asset = Asset.fromModule(bundleModule);
        // Always download: in dev the asset is served by Metro over http, and the
        // page must run from a file:// URI (localStorage, relative paths).
        if (!asset.localUri || __DEV__) await asset.downloadAsync();
        const uri = asset.localUri ?? asset.uri;
        if (!uri) throw new Error('the web chat asset resolved to no URI');
        if (!active) return;
        log.info('loading the bundled web chat', { uri });
        setSource({ status: 'ready', uri, isDev: /^https?:/i.test(uri) });
      } catch (error) {
        log.error('failed to resolve the web chat bundle', error);
        if (active) setSource({ status: 'missing', message: WEBCHAT_MISSING_MESSAGE });
      }
    })();

    return () => {
      active = false;
    };
  }, [reloadKey]);

  return source;
}
