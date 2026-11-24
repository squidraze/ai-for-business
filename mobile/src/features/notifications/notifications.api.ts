import { api } from '@/lib/api';

export type DevicePlatform = 'android' | 'ios';

export const notificationsApi = {
  /** Registers (or refreshes) this device's native push token (FCM on Android, APNs on iOS). */
  /** `timezone` (IANA) is the default for tasks the assistant creates from a chat. */
  registerDevice: async (body: {
    token: string;
    platform: DevicePlatform;
    locale: string;
    timezone: string;
  }) => {
    await api.post('/api/v1/notifications/devices', body);
  },
  unregisterDevice: async (token: string) => {
    await api.delete('/api/v1/notifications/devices', { data: { token } });
  },
};
