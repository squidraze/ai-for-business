import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth, useBeforeSignOut } from '@/features/auth';
import i18n, { currentLanguage } from '@/lib/i18n';
import { createLogger } from '@/lib/log';
import { deviceTimeZone } from '@/lib/timezone';

import { permissionChanged, pushReceived, type PushData } from './events';
import { notificationsApi } from './notifications.api';
import {
  currentPlatform,
  ensureChannel,
  getNativeToken,
  getPermission,
  installForegroundHandler,
  requestPermission,
} from './push';

const log = createLogger('push');

installForegroundHandler();

/** Where a tapped push leads: the conversation it is about, else the task. */
function routeForPush(data: PushData): Href | null {
  const conversation = data.conversation_uuid;
  if (typeof conversation === 'string' && conversation) {
    return { pathname: '/chat/[id]', params: { id: conversation } };
  }
  const schedule = data.schedule_uuid;
  if (data.type === 'schedule_run' && typeof schedule === 'string' && schedule) {
    return { pathname: '/schedules/[id]', params: { id: schedule } };
  }
  return null;
}

/**
 * Push notifications for the signed-in user. Mount once, inside the navigator
 * root (`navReady` = the root navigator is mounted and can navigate):
 * - after sign-in: Android channel, permission prompt, token registration;
 * - re-registers on token refresh, language change and when the permission
 *   gets granted later (in-app or in system settings);
 * - unregisters the token before sign-out / account deletion;
 * - opens the related chat when a push is tapped (also on cold start).
 */
export function usePushNotifications({ navReady }: { navReady: boolean }) {
  const { status } = useAuth();
  const signedIn = status === 'signedIn';
  const registeredToken = useRef<string | null>(null);

  const register = useCallback(async (token?: string) => {
    const value = token ?? (await getNativeToken());
    if (!value) return;
    try {
      await notificationsApi.registerDevice({
        token: value,
        platform: currentPlatform(),
        locale: currentLanguage(),
        timezone: deviceTimeZone(),
      });
      registeredToken.current = value;
    } catch (error) {
      log.warn('could not register the push token', error);
    }
  }, []);

  // Sign-in (or app start with a saved session): ask once, then register.
  useEffect(() => {
    if (!signedIn) {
      registeredToken.current = null;
      return;
    }
    void (async () => {
      await ensureChannel();
      if ((await requestPermission()) === 'granted') await register();
    })();
  }, [signedIn, register]);

  // The OS rotated the token.
  useEffect(() => {
    if (!signedIn) return;
    const subscription = Notifications.addPushTokenListener((token) => {
      if (typeof token.data === 'string' && token.data) void register(token.data);
    });
    return () => subscription.remove();
  }, [signedIn, register]);

  // Pushes are localized by the backend: send the new locale; rename the channel.
  useEffect(() => {
    if (!signedIn) return;
    const onLanguage = () => {
      void ensureChannel();
      if (registeredToken.current) void register(registeredToken.current);
    };
    i18n.on('languageChanged', onLanguage);
    return () => i18n.off('languageChanged', onLanguage);
  }, [signedIn, register]);

  // Permission granted later (Profile → enable, or system settings): register then.
  useEffect(() => {
    if (!signedIn) return;
    const retry = async () => {
      if (registeredToken.current) return;
      if ((await getPermission()).state === 'granted') await register();
    };
    const unsubscribe = permissionChanged.subscribe(() => void retry());
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void retry();
    });
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, [signedIn, register]);

  const unregister = useCallback(async () => {
    const token = registeredToken.current;
    registeredToken.current = null;
    if (token) await notificationsApi.unregisterDevice(token);
  }, []);
  useBeforeSignOut(unregister);

  // Foreground pushes: let other features refresh their data.
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener((notification) => {
      pushReceived.emit(notification.request.content.data ?? {});
    });
    return () => subscription.remove();
  }, []);

  // Taps: open the related screen once we are signed in and can navigate.
  const ready = signedIn && navReady;
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const handled = useRef(new Set<string>());
  const pending = useRef<Notifications.NotificationResponse | null>(null);

  const open = useCallback((response: Notifications.NotificationResponse) => {
    const id = response.notification.request.identifier;
    if (handled.current.has(id)) return;
    handled.current.add(id);
    const data = response.notification.request.content.data ?? {};
    pushReceived.emit(data);
    const route = routeForPush(data);
    if (route) router.push(route);
    Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (readyRef.current) open(response);
      else pending.current = response;
    });
    return () => subscription.remove();
  }, [open]);

  useEffect(() => {
    if (!ready) return;
    if (pending.current) {
      open(pending.current);
      pending.current = null;
    }
    // Cold start: the app was launched by tapping a push.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) open(response);
      })
      .catch(() => undefined);
  }, [ready, open]);
}
