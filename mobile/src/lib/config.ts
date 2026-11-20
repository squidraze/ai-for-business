import Constants from 'expo-constants';

/** Backend base URL, no trailing slash. */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL?.trim() || 'http://localhost:8000').replace(
  /\/+$/,
  '',
);

/** The demo backend has one fake company. */
export const COMPANY_ID = '1';

export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';
