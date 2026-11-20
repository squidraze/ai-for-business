import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The bundle stamps its own version into the `ready` handshake, so a device log
// says which build is running. Read from package.json rather than an env var a
// build worker would have to remember to set.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * The production page is loaded from file:// inside a WebView, where there are no
 * response headers, so the policy has to travel in the document.
 *
 * Injected at BUILD time only: the dev server serves real script files, and a policy
 * written for the inlined single-file bundle blocks them (which is exactly how this
 * was caught). https:/wss: stay open rather than pinned to one origin because the API
 * origin arrives at runtime in the `init` bridge message — one bundle serves every
 * environment. Everything else is denied, so a prompt-injected link has no scheme left
 * to exfiltrate through. `frame-ancestors` is omitted deliberately: it is ignored in a
 * meta tag and only produces a console error.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  'font-src data:',
  // REST leaves through the host over `http.request`, so the page itself opens
  // exactly one connection: the Centrifugo websocket. `https:` is deliberately
  // NOT here any more — with nothing left to fetch, allowing it would only widen
  // where a prompt-injected string could try to send data. `blob:`/`data:` serve
  // the browser-only attachment fallback, which never runs inside the host.
  // forBusiness demo: Centrifugo runs on cleartext ws://localhost:8001 (adb reverse),
  // so `ws:` is allowed too.
  'connect-src ws: wss: blob: data:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const contentSecurityPolicy = (): Plugin => ({
  name: 'webchat-csp',
  apply: 'build',
  transformIndexHtml: (html) =>
    html.replace(
      '<meta charset="UTF-8" />',
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
    ),
});

// The production build is ONE self-contained index.html: it is copied into the
// Expo app's assets and loaded from file://, so it can reference nothing.
// Dev keeps the normal multi-file server so HMR works over EXPO_PUBLIC_WEBCHAT_DEV_URL.
export default defineConfig(({ command }) => ({
  base: './',
  define: { 'import.meta.env.VITE_APP_VERSION': JSON.stringify(version) },
  plugins: [
    react(),
    tailwindcss(),
    ...(command === 'build' ? [contentSecurityPolicy(), viteSingleFile()] : []),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    // Android System WebView is the device's, not ours, and can be several years old.
    target: 'es2020',
    cssTarget: 'chrome80',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 4096,
  },
  server: {
    host: true,
    port: 5173,
  },
}));
