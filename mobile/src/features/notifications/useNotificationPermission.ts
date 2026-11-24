import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';

import { permissionChanged } from './events';
import { getPermission, requestPermission, type PermissionState } from './push';

/**
 * The notification permission for settings screens. `enable()` asks in-app
 * while the system still allows it, otherwise opens the app's system settings.
 * Refreshes when the app comes back to the foreground.
 */
export function useNotificationPermission() {
  const [state, setState] = useState<PermissionState | null>(null);
  const [canAskAgain, setCanAskAgain] = useState(false);

  const refresh = useCallback(async () => {
    const current = await getPermission();
    setState(current.state);
    setCanAskAgain(current.canAskAgain);
  }, []);

  useEffect(() => {
    void refresh();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const enable = useCallback(async () => {
    if (state !== 'granted' && canAskAgain) {
      await requestPermission();
      await refresh();
      permissionChanged.emit();
      return;
    }
    await Linking.openSettings();
  }, [state, canAskAgain, refresh]);

  return { state, enabled: state === 'granted', enable, refresh };
}
