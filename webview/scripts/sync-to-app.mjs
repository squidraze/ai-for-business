#!/usr/bin/env node
/**
 * Build the single-file bundle and deliver it to the mobile app (a sibling
 * folder of this one in the forBusiness repo):
 *
 *   dist/index.html        -> ../mobile/assets/webchat/index.html
 *   src/bridge/protocol.ts -> ../mobile/src/features/chat/bridge/protocol.ts
 *
 * The web app owns both files; nothing on the mobile side is edited by hand.
 *
 * Usage:  npm run sync [-- --skip-build]
 * `MOBILE_DIR` overrides the destination (default: ../mobile from this folder).
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE_DIR = resolve(process.env.MOBILE_DIR ?? join(ROOT, '..', 'mobile'));

/** A size budget, so an accidental heavy dependency shows up. */
const SIZE_WARN_BYTES = 3 * 1024 * 1024; // the inlined SF Pro fonts alone are ~1.5 MB

/** A self-contained bundle references nothing off the page: it loads from file://. */
const EXTERNAL_MARKERS = [
  ['src="/', 'a script served from the dev server'],
  ['src="http', 'a remote script'],
  ['href="http', 'a remote stylesheet or link'],
  ['fonts.googleapis', 'Google Fonts'],
  ['@import url(', 'a CSS @import'],
];

const skipBuild = process.argv.slice(2).includes('--skip-build');

const fail = (message, hint) => {
  console.error(`\nsync-to-app: ${message}`);
  if (hint) console.error(hint);
  process.exit(1);
};

if (!existsSync(MOBILE_DIR)) {
  fail(`the mobile app was not found at ${MOBILE_DIR}`, 'Set MOBILE_DIR to point at it.');
}

/* 1. Build ----------------------------------------------------------- */

if (skipBuild) {
  console.log('sync-to-app: --skip-build, using the existing dist/');
} else {
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!existsSync(vite)) fail('vite is not installed', 'Run `npm install` first.');
  console.log('sync-to-app: vite build');
  const build = spawnSync(process.execPath, [vite, 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (build.status !== 0) fail(`vite build failed (exit ${build.status})`);
}

/* 2. Check the bundle ------------------------------------------------ */

const bundle = join(ROOT, 'dist', 'index.html');
if (!existsSync(bundle)) fail('dist/index.html was not produced by the build');

const emitted = readdirSync(join(ROOT, 'dist'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => relative(join(ROOT, 'dist'), join(entry.parentPath ?? entry.path, entry.name)));
if (emitted.length !== 1) {
  fail(`the build emitted ${emitted.length} files, expected exactly one:\n  ${emitted.join('\n  ')}`);
}

const html = readFileSync(bundle, 'utf8');
const external = EXTERNAL_MARKERS.filter(([marker]) => html.includes(marker));
if (external.length > 0) {
  fail(
    `dist/index.html references something outside itself:\n${external
      .map(([marker, what]) => `  ${marker}  (${what})`)
      .join('\n')}`,
  );
}

/* 3. Deliver --------------------------------------------------------- */

const htmlTarget = join(MOBILE_DIR, 'assets', 'webchat', 'index.html');
mkdirSync(dirname(htmlTarget), { recursive: true });
copyFileSync(bundle, htmlTarget);

const PROTOCOL_HEADER = [
  '/* AUTO-GENERATED FILE — DO NOT EDIT.',
  ' *',
  ' * Copied from webview/src/bridge/protocol.ts by `npm run sync` in webview/.',
  ' * Edit it there and sync again; any change made here is overwritten.',
  ' */',
  '',
  '',
].join('\n');

const protocolTarget = join(MOBILE_DIR, 'src', 'features', 'chat', 'bridge', 'protocol.ts');
mkdirSync(dirname(protocolTarget), { recursive: true });
const protocolText = readFileSync(join(ROOT, 'src', 'bridge', 'protocol.ts'), 'utf8').replace(/\r\n/g, '\n');
writeFileSync(protocolTarget, PROTOCOL_HEADER + protocolText, 'utf8');

/* 4. Report ---------------------------------------------------------- */

const bytes = statSync(bundle).size;
console.log('');
console.log(`sync-to-app: ${htmlTarget}  (${(bytes / 1024).toFixed(1)} KB)`);
console.log(`sync-to-app: ${protocolTarget}`);
if (bytes > SIZE_WARN_BYTES) {
  console.warn(`\nsync-to-app: WARNING — the bundle is over ${(SIZE_WARN_BYTES / 1024).toFixed(0)} KB.`);
}
