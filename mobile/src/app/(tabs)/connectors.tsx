import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  AppState,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button, Card, ErrorView, ListSkeleton } from '@/components/ui';
import {
  api,
  CONNECTORS_KEY,
  errorMessage,
  type ConnectorStatus,
  type TelegramAccount,
} from '@/lib/api';
import { useColors } from '@/lib/theme';

const GMAIL_REDIRECT = 'forbusiness://connectors';

function useConnectors() {
  return useQuery({
    queryKey: CONNECTORS_KEY,
    queryFn: async () => (await api.get<ConnectorStatus[]>('/api/v1/connectors')).data,
  });
}

export default function ConnectorsScreen() {
  const c = useColors();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ gmail?: string }>();
  const query = useConnectors();
  const [refreshing, setRefreshing] = useState(false);
  const [gmailBusy, setGmailBusy] = useState(false);

  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: CONNECTORS_KEY }),
    [queryClient],
  );

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  // Coming back from the OAuth browser (or the deep link) — re-read the status.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (params.gmail) void refresh();
  }, [params.gmail, refresh]);

  const telegram = query.data?.find((item) => item.id === 'telegram');
  const gmail = query.data?.find((item) => item.id === 'gmail');

  const disconnect = useMutation({
    mutationFn: (id: 'telegram' | 'gmail') =>
      api.post(
        id === 'telegram' ? '/api/v1/connectors/telegram/logout' : '/api/v1/connectors/gmail/disconnect',
      ),
    onSuccess: () => refresh(),
    onError: (e) => Alert.alert('Disconnect failed', errorMessage(e)),
  });

  const confirmDisconnect = (id: 'telegram' | 'gmail') =>
    Alert.alert(`Disconnect ${id === 'telegram' ? 'Telegram' : 'Gmail'}?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => disconnect.mutate(id) },
    ]);

  const connectGmail = async () => {
    setGmailBusy(true);
    try {
      const { data } = await api.get<{ url: string }>('/api/v1/connectors/gmail/auth-url');
      await WebBrowser.openAuthSessionAsync(data.url, GMAIL_REDIRECT);
    } catch (e) {
      Alert.alert('Gmail', errorMessage(e, 'Could not start Google sign-in'));
    } finally {
      setGmailBusy(false);
      void refresh();
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  if (query.isLoading) return <ListSkeleton count={3} />;
  if (query.isError && !query.data)
    return <ErrorView message={errorMessage(query.error)} onRetry={() => void query.refetch()} />;

  const tg = (telegram?.account ?? null) as TelegramAccount | null;
  const tgName = tg ? [tg.first_name, tg.last_name].filter(Boolean).join(' ') : '';
  const gmailEmail = (gmail?.account as { email?: string } | null)?.email;

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 16 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={c.primary}
          colors={[c.primary]}
        />
      }
    >
      <Text style={{ color: c.muted, fontSize: 14 }}>
        Connected apps are available to you here and to the AI assistant in chats.
      </Text>

      <Card>
        <Header
          icon="paper-plane"
          tint="#29a9eb"
          title="Telegram"
          connected={!!telegram?.connected}
        />
        {telegram?.connected ? (
          <>
            <View style={styles.account}>
              <Text style={[styles.accountName, { color: c.text }]}>{tgName || 'Telegram account'}</Text>
              {tg?.username ? (
                <Text style={[styles.accountLine, { color: c.muted }]}>@{tg.username}</Text>
              ) : null}
              {tg?.phone ? (
                <Text style={[styles.accountLine, { color: c.muted }]}>
                  {tg.phone.startsWith('+') ? tg.phone : `+${tg.phone}`}
                </Text>
              ) : null}
            </View>
            <Button title="Open chats" icon="chatbubbles-outline" onPress={() => router.push('/telegram')} />
            <Button
              title="Disconnect"
              variant="danger"
              onPress={() => confirmDisconnect('telegram')}
              loading={disconnect.isPending && disconnect.variables === 'telegram'}
              style={{ marginTop: 10 }}
            />
          </>
        ) : (
          <>
            <Text style={[styles.description, { color: c.muted }]}>
              Sign in with your Telegram account to read and send messages.
            </Text>
            <Button title="Connect Telegram" onPress={() => router.push('/telegram/connect')} />
          </>
        )}
      </Card>

      <Card>
        <Header icon="mail" tint="#ea4335" title="Gmail" connected={!!gmail?.connected} />
        {gmail?.connected ? (
          <>
            <View style={styles.account}>
              <Text style={[styles.accountName, { color: c.text }]}>{gmailEmail || 'Gmail account'}</Text>
            </View>
            <Button title="Open inbox" icon="mail-open-outline" onPress={() => router.push('/gmail')} />
            <Button
              title="Disconnect"
              variant="danger"
              onPress={() => confirmDisconnect('gmail')}
              loading={disconnect.isPending && disconnect.variables === 'gmail'}
              style={{ marginTop: 10 }}
            />
          </>
        ) : (
          <>
            <Text style={[styles.description, { color: c.muted }]}>
              Connect your Google account to read, send and reply to email.
            </Text>
            <Button title="Connect Gmail" onPress={() => void connectGmail()} loading={gmailBusy} />
          </>
        )}
      </Card>
    </ScrollView>
  );
}

function Header({
  icon,
  tint,
  title,
  connected,
}: {
  icon: 'paper-plane' | 'mail';
  tint: string;
  title: string;
  connected: boolean;
}) {
  const c = useColors();
  return (
    <View style={styles.header}>
      <View style={[styles.logo, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={20} color="#fff" />
      </View>
      <Text style={[styles.title, { color: c.text }]}>{title}</Text>
      <View
        style={[
          styles.pill,
          { backgroundColor: connected ? 'rgba(34,197,94,0.15)' : c.inputBg },
        ]}
      >
        <Text style={{ color: connected ? '#16a34a' : c.muted, fontSize: 12, fontWeight: '600' }}>
          {connected ? 'Connected' : 'Not connected'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  logo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  title: { fontSize: 18, fontWeight: '700', flex: 1 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  description: { fontSize: 14, marginBottom: 14 },
  account: { marginBottom: 14 },
  accountName: { fontSize: 16, fontWeight: '600' },
  accountLine: { fontSize: 14, marginTop: 2 },
});
