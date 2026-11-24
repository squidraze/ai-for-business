import * as AppleAuthentication from 'expo-apple-authentication';
import { Platform } from 'react-native';

import { ClientError } from '@/lib/api';
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from '@/lib/config';

import type { AppleSignInPayload } from './auth.api';

type GoogleModule = typeof import('@react-native-google-signin/google-signin');

let google: GoogleModule | null = null;
let googleConfigured = false;

/** Google sign-in needs the web client id (the backend checks tokens against it). */
export const isGoogleConfigured = GOOGLE_WEB_CLIENT_ID.length > 0;

/**
 * Loaded lazily: the native module only exists after a rebuild
 * (`npx expo run:android`), and a stale dev build must still open.
 */
function loadGoogle(): GoogleModule {
  if (!google) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      google = require('@react-native-google-signin/google-signin') as GoogleModule;
    } catch {
      throw new ClientError('google_failed', 'Google Sign-In native module is missing; rebuild the app');
    }
  }
  if (!googleConfigured) {
    google.GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      ...(GOOGLE_IOS_CLIENT_ID ? { iosClientId: GOOGLE_IOS_CLIENT_ID } : {}),
    });
    googleConfigured = true;
  }
  return google;
}

/** Google id token, or null when the user closed the dialog. */
export async function getGoogleIdToken(): Promise<string | null> {
  if (!isGoogleConfigured) throw new ClientError('google_not_configured');
  const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = loadGoogle();
  try {
    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return null; // cancelled
    if (!response.data.idToken) throw new ClientError('google_failed', 'Google returned no id token');
    return response.data.idToken;
  } catch (error) {
    if (error instanceof ClientError) throw error;
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED || error.code === statusCodes.IN_PROGRESS) {
        return null;
      }
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new ClientError('play_services_unavailable');
      }
    }
    throw new ClientError('google_failed', error instanceof Error ? error.message : undefined);
  }
}

/** Best effort: forget the Google account so the next sign-in shows the picker. */
export async function googleSignOut(): Promise<void> {
  if (!google || !googleConfigured) return;
  try {
    await google.GoogleSignin.signOut();
  } catch {
    // not signed in with Google, or the module is unavailable
  }
}

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Apple credential for the backend, or null when the user cancelled. */
export async function getAppleCredential(): Promise<AppleSignInPayload | null> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) throw new ClientError('apple_failed', 'Apple returned no identity token');
    return {
      identity_token: credential.identityToken,
      // Apple only sends the name on the very first sign-in.
      given_name: credential.fullName?.givenName ?? null,
      family_name: credential.fullName?.familyName ?? null,
    };
  } catch (error) {
    if (error instanceof ClientError) throw error;
    if ((error as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return null;
    throw new ClientError('apple_failed', error instanceof Error ? error.message : undefined);
  }
}
