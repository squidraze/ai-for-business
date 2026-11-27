import * as SecureStore from 'expo-secure-store';
import { colorScheme } from 'nativewind';
import { useSyncExternalStore } from 'react';

import { reportError } from '@/lib/reportError';

/** What the user picked in Profile → Theme. `system` follows the device. */
export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODES: readonly ThemeMode[] = ['system', 'dark', 'light'];

const THEME_MODE_KEY = 'forbusiness_theme_mode';

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

let mode: ThemeMode = 'system';
const listeners = new Set<() => void>();

// NativeWind forces the scheme onto RN `Appearance`, so `dark:` classes and
// `useColors()` (RN `useColorScheme`) switch together.
function apply(next: ThemeMode) {
  mode = next;
  try {
    colorScheme.set(next);
  } catch (e) {
    reportError(e, { where: 'themeMode.apply' });
  }
  listeners.forEach((listener) => listener());
}

// A theme picked earlier wins over the device scheme. Read once at startup.
void (async () => {
  try {
    const saved = await SecureStore.getItemAsync(THEME_MODE_KEY);
    if (isThemeMode(saved) && saved !== mode) apply(saved);
  } catch {
    // keep following the device
  }
})();

export async function setThemeMode(next: ThemeMode): Promise<void> {
  apply(next);
  try {
    await SecureStore.setItemAsync(THEME_MODE_KEY, next);
  } catch {
    // the choice still applies for this session
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The picked mode (not the resolved scheme — that is `useColors().scheme`). */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, () => mode);
}
