import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { errorMessage } from '@/lib/api';

import { connectorsApi } from './connectors.api';

export const CONNECTORS_KEY = ['connectors'] as const;

/** Connection status of every integration (the Connectors tab). */
export function useConnectors() {
  return useQuery({ queryKey: CONNECTORS_KEY, queryFn: connectorsApi.list });
}

/** Re-reads the connection status (after connecting, disconnecting, OAuth…). */
export function invalidateConnectors(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: CONNECTORS_KEY });
}

/**
 * Disconnect with a confirmation alert. `confirm()` asks first; the status is
 * re-read on success and a failure is shown in an alert.
 */
export function useDisconnect({ name, disconnect }: { name: string; disconnect: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: disconnect,
    onSuccess: () => invalidateConnectors(queryClient),
    onError: (e) => Alert.alert(t('connectors.disconnectFailed'), errorMessage(e)),
  });
  const { mutate } = mutation;

  const confirm = useCallback(
    () =>
      Alert.alert(t('connectors.disconnectConfirm', { name }), undefined, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('connectors.disconnect'), style: 'destructive', onPress: () => mutate() },
      ]),
    [mutate, name, t],
  );

  return { confirm, isPending: mutation.isPending };
}
