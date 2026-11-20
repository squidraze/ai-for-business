/**
 * The one entry point into the dev harness.
 *
 * Call it from `src/main.tsx`, before the app renders:
 *
 *   import { installDevHost } from '@/dev';
 *   installDevHost();
 *
 * `import.meta.env.DEV` is replaced with the literal `false` in a production
 * build, so the body below folds to a `return` and rollup drops the dynamic
 * import with it — `src/dev/*` never reaches `dist/index.html`. Keep the guard
 * here, ahead of the import, for that reason.
 */
export function installDevHost(): void {
  if (!import.meta.env.DEV) return;
  void import('./devHost')
    .then(({ startDevHost }) => {
      startDevHost();
    })
    .catch((error: unknown) => {
      console.error('[dev-host] failed to load', error);
    });
}
