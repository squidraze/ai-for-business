import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import i18n from '@/lib/i18n';
import { createLogger } from '@/lib/log';

const log = createLogger('push');

/** Android channel for task (schedule) results; the backend sends to this id. */
export const SCHEDULES_CHANNEL_ID = 'schedules';

export type PermissionState = 'granted' | 'denied' | 'undetermined';

let handlerInstalled = false;

/** Foreground pushes still show a banner (the default on Android would hide them). */
export function installForegroundHandler() {
  if (handlerInstalled) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Creates/updates the Android channel (its name follows the app language). */
export async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(SCHEDULES_CHANNEL_ID, {
      name: i18n.t('notifications.channelName'),
      description: i18n.t('notifications.channelDescription'),
      importance: Notifications.AndroidImportance.HIGH,
    });
  } catch (error) {
    log.warn('could not create the notification channel', error);
  }
}

function toState(status: Notifications.NotificationPermissionsStatus): PermissionState {
  if (status.granted) return 'granted';
  // iOS "provisional" also lets notifications through quietly.
  if (status.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  return status.status === 'denied' ? 'denied' : 'undetermined';
}

export async function getPermission(): Promise<{ state: PermissionState; canAskAgain: boolean }> {
  try {
    const status = await Notifications.getPermissionsAsync();
    return { state: toState(status), canAskAgain: status.canAskAgain };
  } catch (error) {
    log.warn('could not read the notification permission', error);
    return { state: 'undetermined', canAskAgain: false };
  }
}

/** Asks for the permission if the system still allows asking (Android 13+, iOS). */
export async function requestPermission(): Promise<PermissionState> {
  const current = await getPermission();
  if (current.state === 'granted' || !current.canAskAgain) return current.state;
  try {
    // Android 13+ shows the POST_NOTIFICATIONS prompt only once a channel exists.
    await ensureChannel();
    return toState(await Notifications.requestPermissionsAsync());
  } catch (error) {
    log.warn('could not request the notification permission', error);
    return current.state;
  }
}

let tokenFailureLogged = false;

/**
 * The native device token (FCM on Android, APNs on iOS), or null. Without
 * Firebase (`google-services.json`) this throws on Android: log once, keep going.
 */
export async function getNativeToken(): Promise<string | null> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return null;
  if (Platform.OS === 'ios' && !Device.isDevice) return null; // no APNs on the simulator
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    return typeof token.data === 'string' && token.data ? token.data : null;
  } catch (error) {
    if (!tokenFailureLogged) {
      tokenFailureLogged = true;
      log.warn(
        'push token unavailable (is Firebase configured? see google-services.json in README)',
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  }
}

export function currentPlatform(): 'android' | 'ios' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}
