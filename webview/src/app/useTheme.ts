import { useSyncExternalStore } from 'react';

import { on } from '@/bridge/bridge';
import type { Insets, ThemeName } from '@/bridge/protocol';

/**
 * Theme and safe-area insets come from the native host, never from the browser:
 * `env(safe-area-inset-*)` is unreliable inside a WebView and the host is the
 * only side that knows the keyboard height on iOS.
 *
 * Two sinks, one store:
 *  - the theme lands on `documentElement.dataset.theme`, which is what
 *    `[data-theme='dark']` in index.css keys off;
 *  - the insets land on the five `--inset-*` variables the layout reads.
 * The hook exists for the rare case a component needs the numbers in JS
 * (Composer's keyboard offset); anything expressible in CSS should stay in CSS.
 */

export const DEFAULT_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0, keyboard: 0 };

export type ThemeSnapshot = { theme: ThemeName; insets: Insets };

/**
 * The host has not spoken yet, so this is a guess — and the ONLY moment
 * `prefers-color-scheme` is allowed to decide anything. It covers the frames
 * between the bundle painting and `init` landing; without it a dark-mode user
 * gets a white flash, because :root in index.css is the light palette.
 */
function guessTheme(): ThemeName {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let snapshot: ThemeSnapshot = { theme: guessTheme(), insets: DEFAULT_INSETS };

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): ThemeSnapshot {
  return snapshot;
}

/** The host is untrusted input: a NaN would write `--inset-top: NaNpx`. */
function px(value: number): string {
  return `${Number.isFinite(value) ? Math.max(0, value) : 0}px`;
}

export function applyTheme(theme: ThemeName): void {
  const next: ThemeName = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  if (next === snapshot.theme) return;
  snapshot = { ...snapshot, theme: next };
  emit();
}

export function applyInsets(insets: Insets): void {
  const next: Insets = {
    top: insets?.top ?? 0,
    bottom: insets?.bottom ?? 0,
    left: insets?.left ?? 0,
    right: insets?.right ?? 0,
    keyboard: insets?.keyboard ?? 0,
  };
  const root = document.documentElement.style;
  root.setProperty('--inset-top', px(next.top));
  root.setProperty('--inset-bottom', px(next.bottom));
  root.setProperty('--inset-left', px(next.left));
  root.setProperty('--inset-right', px(next.right));
  root.setProperty('--inset-keyboard', px(next.keyboard));
  snapshot = { ...snapshot, insets: next };
  emit();
}

let subscribed = false;

/**
 * Subscribed BEFORE `ready` is posted, so a `theme.set` the host fires while we
 * are still waiting for `init` is not dropped. Idempotent; never torn down —
 * the page lives exactly as long as the screen does.
 */
export function startThemeBridge(): void {
  if (subscribed) return;
  subscribed = true;

  // Paint the guess immediately; `init` overwrites it a moment later.
  applyTheme(snapshot.theme);

  on('theme.set', (payload) => applyTheme(payload.theme));
  on('insets.set', (payload) => applyInsets(payload));
}

export function useTheme(): ThemeSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
