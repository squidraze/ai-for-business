import Constants from 'expo-constants';

/** Backend base URL, no trailing slash. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL?.trim() || 'http://localhost:8000').replace(
  /\/+$/,
  '',
);

/** The demo backend has one fake company. */
export const COMPANY_ID = '1';

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw?.trim() ?? '', 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Cross-fade between loading / error / empty / content, in ms. */
export const STATE_FADE_MS = positiveInt(process.env.EXPO_PUBLIC_STATE_FADE_MS, 800);

/** One pass of the skeleton shimmer, in ms. */
export const SKELETON_SHIMMER_MS = positiveInt(process.env.EXPO_PUBLIC_SKELETON_SHIMMER_MS, 1200);

/** Google OAuth client ids (empty = Google sign-in unavailable). */
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? '';
