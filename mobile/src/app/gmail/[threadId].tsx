import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Card, ErrorView, ListSkeleton } from '@/components/ui';
import { api, errorMessage, type GmailThread } from '@/lib/api';
import { displayFrom, fullDate } from '@/lib/format';
import { useColors } from '@/lib/theme';

export default function GmailThreadScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { threadId, subject } = useLocalSearchParams<{ threadId: string; subject?: string }>();
  const path = `/api/v1/connectors/gmail/threads/${encodeURIComponent(threadId)}`;
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const query = useQuery({
    queryKey: ['gmail', 'thread', threadId],
    queryFn: async () => (await api.get<GmailThread>(path)).data,
  });

  useEffect(() => {
    api
      .post(`${path}/read`)
      .then(() => queryClient.invalidateQueries({ queryKey: ['gmail', 'threads'] }))
      .catch(() => {});
  }, [path, queryClient]);

  const send = async () => {
    const body = reply.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api.post(`${path}/reply`, { body });
      setReply('');
      setReplying(false);
      await query.refetch();
      void queryClient.invalidateQueries({ queryKey: ['gmail', 'threads'] });
    } catch (e) {
      Alert.alert('Reply not sent', errorMessage(e));
    } finally {
      setSending(false);
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

  const title = query.data?.subject || subject || '(no subject)';
  const header = <Stack.Screen options={{ title: '' }} />;

  if (query.isLoading)
    return (
      <>
        {header}
        <ListSkeleton count={3} />
      </>
    );
  if (query.isError && !query.data)
    return (
      <>
        {header}
        <ErrorView message={errorMessage(query.error)} onRetry={() => void query.refetch()} />
      </>
    );

  const messages = query.data?.messages ?? [];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
    >
      {header}
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      >
        <Text style={[styles.subject, { color: c.text }]}>{title}</Text>
        {messages.map((m) => (
          <Card key={m.id}>
            <View style={styles.meta}>
              <Avatar name={displayFrom(m.from)} seed={m.from} size={36} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[styles.from, { color: c.text }]} numberOfLines={1}>
                  {displayFrom(m.from)}
                </Text>
                <Text style={[styles.small, { color: c.muted }]} numberOfLines={1}>
                  to {m.to}
                  {m.cc ? `, cc ${m.cc}` : ''}
                </Text>
              </View>
              <Text style={[styles.small, { color: c.muted }]}>{fullDate(m.date)}</Text>
            </View>
            <Text style={[styles.body, { color: c.text }]} selectable>
              {(m.body_text || m.snippet || '').trim()}
            </Text>
          </Card>
        ))}
      </ScrollView>

      <View
        style={[
          styles.composer,
          { backgroundColor: c.card, borderTopColor: c.border, paddingBottom: Math.max(insets.bottom, 10) },
        ]}
      >
        {replying ? (
          <>
            <TextInput
              value={reply}
              onChangeText={setReply}
              placeholder="Write a reply…"
              placeholderTextColor={c.muted}
              multiline
              autoFocus
              style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
            />
            <View style={styles.actions}>
              <TouchableOpacity onPress={() => setReplying(false)} hitSlop={8}>
                <Text style={{ color: c.muted, fontSize: 15 }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => void send()}
                disabled={!reply.trim() || sending}
                style={[
                  styles.sendButton,
                  { backgroundColor: c.primary, opacity: !reply.trim() || sending ? 0.5 : 1 },
                ]}
              >
                {sending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="send" size={16} color="#fff" />
                    <Text style={styles.sendText}>Send</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <TouchableOpacity
            onPress={() => setReplying(true)}
            style={[styles.replyButton, { borderColor: c.border }]}
          >
            <Ionicons name="arrow-undo-outline" size={18} color={c.text} />
            <Text style={{ color: c.text, fontSize: 15, fontWeight: '600', marginLeft: 8 }}>Reply</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  subject: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  from: { fontSize: 15, fontWeight: '600' },
  small: { fontSize: 12 },
  body: { fontSize: 15, lineHeight: 21 },
  composer: { paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input: {
    minHeight: 80,
    maxHeight: 180,
    borderRadius: 12,
    padding: 12,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 18,
  },
  sendText: { color: '#fff', fontWeight: '600', fontSize: 15, marginLeft: 6 },
  replyButton: {
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
