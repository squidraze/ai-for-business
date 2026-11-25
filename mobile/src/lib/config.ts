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

/**
 * Max wait for one API request, in ms. A hung connection (server down, dev
 * tunnel dropped) turns into an error with Retry instead of an endless skeleton.
 */
export const API_TIMEOUT_MS = positiveInt(process.env.EXPO_PUBLIC_API_TIMEOUT_MS, 15_000);

/** Max wait for a file upload, in ms (large files on slow networks). */
export const UPLOAD_TIMEOUT_MS = positiveInt(process.env.EXPO_PUBLIC_UPLOAD_TIMEOUT_MS, 120_000);

/** After this long on a loading skeleton, show "taking longer than usual", in ms. */
export const SLOW_LOADING_MS = positiveInt(process.env.EXPO_PUBLIC_SLOW_LOADING_MS, 8_000);

/** Google OAuth client ids (empty = Google sign-in unavailable). */
export const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() ?? '';
export const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() ?? '';

/** How often the Tasks tab badge (runs waiting for approval) refreshes while the app is open, in ms. */
export const PENDING_POLL_MS = positiveInt(process.env.EXPO_PUBLIC_PENDING_POLL_MS, 60_000);
