#!/usr/bin/env node
/**
 * Build the single-file bundle and deliver it to the Expo app.
 *
 *   dist/index.html        -> <app>/assets/webchat/index.html
 *   src/bridge/protocol.ts -> <app>/src/features/ai-chat/webchat/protocol.ts
 *
 * The web repo owns both. Nothing on the app side may be edited by hand.
 *
 * Usage:  node scripts/sync-to-app.mjs [--skip-build] [--force]
 * The destination is `ROOLER_APP_DIR`, defaulting to the checkout below.
 * `--force` skips the check that the destination really is `@rooler/business`.
 *
 * Plain Node, no dependencies — it runs on a dev machine and on a CI worker.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_APP_DIR = 'D:/rooler/mobile-apps/apps/business';

/** Above this the WebView takes visibly longer to parse on a mid-range Android. */
const SIZE_WARN_BYTES = 800 * 1024;

/** A self-contained bundle references nothing off the page: it loads from file://. */
const EXTERNAL_MARKERS = [
  ['src="/', 'a script served from the dev server'],
  ['src="http', 'a remote script'],
  ['href="http', 'a remote stylesheet or link'],
  ['fonts.googleapis', 'Google Fonts'],
  ['fonts.gstatic', 'Google Fonts'],
  ['@import url(', 'a CSS @import'],
];

const args = process.argv.slice(2);
const skipBuild = args.includes('--skip-build');
const force = args.includes('--force');

const fail = (message, hint) => {
  console.error(`\nsync-to-app: ${message}`);
  if (hint) console.error(hint);
  process.exit(1);
};

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

/* 1. Where does it go ------------------------------------------------ */

const appDir = resolve(process.env.ROOLER_APP_DIR ?? DEFAULT_APP_DIR);

if (!existsSync(appDir)) {
  fail(
    `the Expo app was not found at ${appDir}`,
    'Point ROOLER_APP_DIR at the business app, e.g.\n' +
      '  ROOLER_APP_DIR=/path/to/mobile-apps/apps/business npm run sync',
  );
}
const appPackage = join(appDir, 'package.json');
if (!existsSync(appPackage)) {
  fail(
    `${appDir} has no package.json, so it is not the Expo app`,
    'ROOLER_APP_DIR must point at mobile-apps/apps/business itself, not at the monorepo root.',
  );
}
const appName = JSON.parse(readFileSync(appPackage, 'utf8')).name;
if (appName !== '@rooler/business' && !force) {
  fail(
    `${appDir} is the package "${appName}", not "@rooler/business"`,
    'Writing there would scatter an assets/ and a src/features/ tree somewhere they do not\n' +
      'belong. Point ROOLER_APP_DIR at mobile-apps/apps/business, or pass --force if the app\n' +
      'really has been renamed.',
  );
}

/* 2. Build ----------------------------------------------------------- */

if (skipBuild) {
  console.log('sync-to-app: --skip-build, using the existing dist/');
} else {
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) fail('vite is not installed', 'Run `npm install` first.');

  console.log('sync-to-app: vite build');
  const build = spawnSync(process.execPath, [vite, 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (build.status !== 0) fail(`vite build failed (exit ${build.status})`);
}

/* 3. Check the bundle ------------------------------------------------ */

const bundle = join(ROOT, 'dist', 'index.html');
if (!existsSync(bundle)) fail('dist/index.html was not produced by the build');

const emitted = readdirSync(join(ROOT, 'dist'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(join(ROOT, 'dist'), join(entry.parentPath ?? entry.path, entry.name)));

if (emitted.length !== 1) {
  fail(
    `the build emitted ${emitted.length} files, expected exactly one:\n  ${emitted.join('\n  ')}`,
    'The bundle is loaded from file:// and must inline everything — check vite-plugin-singlefile.',
  );
}

const html = readFileSync(bundle, 'utf8');
const external = EXTERNAL_MARKERS.filter(([marker]) => html.includes(marker));
if (external.length > 0) {
  fail(
    `dist/index.html references something outside itself:\n${external
      .map(([marker, what]) => `  ${marker}  (${what})`)
      .join('\n')}`,
    'A file:// page cannot fetch it, and a CDN would break offline use and Play Data Safety.',
  );
}

const bytes = statSync(bundle).size;

/* 4. Deliver --------------------------------------------------------- */

const htmlTarget = join(appDir, 'assets', 'webchat', 'index.html');
mkdirSync(dirname(htmlTarget), { recursive: true });
copyFileSync(bundle, htmlTarget);

const PROTOCOL_HEADER = [
  '/* AUTO-GENERATED FILE — DO NOT EDIT.',
  ' *',
  ' * Copied from the webchat web app (business-app-web-view) by its',
  ' * `npm run sync`. That repo owns the bridge contract: edit',
  ' * `src/bridge/protocol.ts` there and sync again. Any change made here is',
  ' * silently overwritten by the next build.',
  ' */',
  '',
  '',
].join('\n');

const protocolSource = join(ROOT, 'src', 'bridge', 'protocol.ts');
const protocolTarget = join(appDir, 'src', 'features', 'ai-chat', 'webchat', 'protocol.ts');
mkdirSync(dirname(protocolTarget), { recursive: true });
// LF, whatever this checkout uses: on Windows with `core.autocrlf` the working
// copy is CRLF, and the app's `lint:ci` (prettier, `--max-warnings=0`) fails on
// every line of a CRLF copy.
const protocolText = readFileSync(protocolSource, 'utf8').replace(/\r\n/g, '\n');
writeFileSync(protocolTarget, PROTOCOL_HEADER + protocolText, 'utf8');

/* 5. Report ---------------------------------------------------------- */

console.log('');
console.log(`sync-to-app: ${htmlTarget}  (${kb(bytes)})`);
console.log(`sync-to-app: ${protocolTarget}`);

if (bytes > SIZE_WARN_BYTES) {
  console.warn(
    `\nsync-to-app: WARNING — the bundle is ${kb(bytes)}, over the ${kb(SIZE_WARN_BYTES)} budget.` +
      '\nEvery byte is parsed on every cold open of the chat. Check what was added.',
  );
}
