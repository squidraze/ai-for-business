import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Keyboard,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AsyncState } from '@/components/AsyncState';
import { SkeletonList } from '@/components/Skeleton';
import { Button, Card, Field } from '@/components/ui';
import {
  api,
  CONNECTORS_KEY,
  errorMessage,
  type BitrixAccount,
  type ConnectorStatus,
  type TelegramAccount,
} from '@/lib/api';
import { useColors } from '@/lib/theme';

const GMAIL_REDIRECT = 'forbusiness://connectors';
const BITRIX_TINT = '#2fc6f6';

type ConnectorId = 'telegram' | 'gmail' | 'bitrix24';

const CONNECTOR_NAMES: Record<ConnectorId, string> = {
  telegram: 'Telegram',
  gmail: 'Gmail',
  bitrix24: 'Bitrix24',
};

const DISCONNECT_PATHS: Record<ConnectorId, string> = {
  telegram: '/api/v1/connectors/telegram/logout',
  gmail: '/api/v1/connectors/gmail/disconnect',
  bitrix24: '/api/v1/connectors/bitrix24/disconnect',
};

const BITRIX_STEPS = [
  'In Bitrix24: Developer resources → Other → Inbound webhook.',
  'Tick the CRM permission (optionally Tasks, Users).',
  'Copy the webhook URL and paste it here.',
];

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
  const bitrix = query.data?.find((item) => item.id === 'bitrix24');
  const [webhookUrl, setWebhookUrl] = useState('');
  // The webhook field is the last thing on the screen, so the keyboard covers it:
  // once the keyboard is up (and the window has resized), bring the field into view.
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const revealWebhookField = useCallback(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      sub.remove();
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    });
    setTimeout(() => sub.remove(), 1500);
  }, []);

  const disconnect = useMutation({
    mutationFn: (id: ConnectorId) => api.post(DISCONNECT_PATHS[id]),
    onSuccess: () => refresh(),
    onError: (e) => Alert.alert('Disconnect failed', errorMessage(e)),
  });

  const connectBitrix = useMutation({
    mutationFn: (url: string) =>
      api.post<{ status: string; account: BitrixAccount }>('/api/v1/connectors/bitrix24/connect', {
        webhook_url: url,
      }),
    onSuccess: () => {
      setWebhookUrl('');
      void refresh();
    },
    onError: (e) => Alert.alert('Bitrix24', errorMessage(e, 'Could not connect the portal')),
  });

  const submitWebhook = () => {
    const url = webhookUrl.trim();
    if (url && !connectBitrix.isPending) connectBitrix.mutate(url);
  };

  const confirmDisconnect = (id: ConnectorId) =>
    Alert.alert(`Disconnect ${CONNECTOR_NAMES[id]}?`, undefined, [
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

  const tg = (telegram?.account ?? null) as TelegramAccount | null;
  const tgName = tg ? [tg.first_name, tg.last_name].filter(Boolean).join(' ') : '';
  const gmailEmail = (gmail?.account as { email?: string } | null)?.email;
  const bx = (bitrix?.account ?? null) as BitrixAccount | null;

  return (
    <AsyncState query={query} skeleton={<SkeletonList count={3} />}>
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
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

        <Card>
          <Header icon="briefcase" tint={BITRIX_TINT} title="Bitrix24" connected={!!bitrix?.connected} />
          {bitrix?.connected ? (
            <>
              <View style={styles.account}>
                <Text style={[styles.accountName, { color: c.text }]}>{bx?.portal || 'Bitrix24 portal'}</Text>
                {bx?.user_name ? (
                  <Text style={[styles.accountLine, { color: c.muted }]}>{bx.user_name}</Text>
                ) : null}
              </View>
              <Button title="Open CRM" icon="briefcase-outline" onPress={() => router.push('/bitrix')} />
              <Button
                title="Disconnect"
                variant="danger"
                onPress={() => confirmDisconnect('bitrix24')}
                loading={disconnect.isPending && disconnect.variables === 'bitrix24'}
                style={{ marginTop: 10 }}
              />
            </>
          ) : (
            <>
              <Text style={[styles.description, { color: c.muted }]}>
                Connect your Bitrix24 portal to browse deals and leads and add comments.
              </Text>
              <View style={[styles.steps, { backgroundColor: c.inputBg }]}>
                <Text style={[styles.stepsTitle, { color: c.text }]}>How to connect</Text>
                {BITRIX_STEPS.map((step, index) => (
                  <View key={step} style={styles.step}>
                    <Text style={[styles.stepNumber, { color: c.muted }]}>{index + 1}.</Text>
                    <Text style={[styles.stepText, { color: c.text }]}>{step}</Text>
                  </View>
                ))}
              </View>
              <Field
                value={webhookUrl}
                onChangeText={setWebhookUrl}
                placeholder="https://yourportal.bitrix24.com/rest/1/…/"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                textContentType="URL"
                returnKeyType="done"
                editable={!connectBitrix.isPending}
                onSubmitEditing={submitWebhook}
                onFocus={revealWebhookField}
              />
              <Button
                title="Connect"
                onPress={submitWebhook}
                disabled={!webhookUrl.trim()}
                loading={connectBitrix.isPending}
              />
            </>
          )}
        </Card>
      </ScrollView>
    </AsyncState>
  );
}

function Header({
  icon,
  tint,
  title,
  connected,
}: {
  icon: 'paper-plane' | 'mail' | 'briefcase';
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
  steps: { borderRadius: 12, padding: 12, marginBottom: 14 },
  stepsTitle: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  step: { flexDirection: 'row', marginTop: 4 },
  stepNumber: { fontSize: 14, width: 20, lineHeight: 20 },
  stepText: { fontSize: 14, flex: 1, lineHeight: 20 },
});
