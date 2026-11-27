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

/** Bottom sheet slide-in, in ms. */
export const SHEET_OPEN_MS = positiveInt(process.env.EXPO_PUBLIC_SHEET_OPEN_MS, 300);

/** Bottom sheet slide-out (close button, backdrop tap, swipe past the threshold), in ms. */
export const SHEET_CLOSE_MS = positiveInt(process.env.EXPO_PUBLIC_SHEET_CLOSE_MS, 250);

/** Centred dialog (PermissionDialog) fade + lift, in ms. */
export const DIALOG_FADE_MS = positiveInt(process.env.EXPO_PUBLIC_DIALOG_FADE_MS, 180);

/** Segmented switch pill slide, in ms. Short on purpose: a control lagging its own tap reads as broken. */
export const SEGMENT_SLIDE_MS = positiveInt(process.env.EXPO_PUBLIC_SEGMENT_SLIDE_MS, 260);

/** On/off toggle (AnimatedSwitch) thumb slide and track colour fade, in ms. */
export const SWITCH_TOGGLE_MS = positiveInt(process.env.EXPO_PUBLIC_SWITCH_TOGGLE_MS, 300);

/** Fade-in of a tab's content on focus (TabFade) and the auth stack's cross-fade, in ms. */
export const SCREEN_FADE_MS = positiveInt(process.env.EXPO_PUBLIC_SCREEN_FADE_MS, 800);

/**
 * Spring a pager tab row settles on after a drag. Physics, not a duration,
 * so it is a constant rather than an env value.
 */
export const PAGE_SETTLE_SPRING = {
  damping: 28,
  stiffness: 260,
  mass: 1,
  overshootClamping: true,
} as const;

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
