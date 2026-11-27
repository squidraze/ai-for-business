import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AsyncState } from '@/components/AsyncState';
import { SkeletonList } from '@/components/Skeleton';
import { Avatar, EmptyView, type IconName } from '@/components/ui';
import { api, dialogPhotoSource, errorMessage, type TelegramMessage } from '@/lib/api';
import { timeOfDay } from '@/lib/format';
import { useColors } from '@/lib/theme';

export { ErrorBoundary } from '@/components/ErrorBoundary';

const PAGE = 50;

const MEDIA: Record<NonNullable<TelegramMessage['media']>, { icon: IconName; label: string }> = {
  photo: { icon: 'image-outline', label: 'Photo' },
  video: { icon: 'videocam-outline', label: 'Video' },
  document: { icon: 'document-outline', label: 'File' },
  voice: { icon: 'mic-outline', label: 'Voice message' },
  sticker: { icon: 'happy-outline', label: 'Sticker' },
};

function mergeMessages(...lists: TelegramMessage[][]): TelegramMessage[] {
  const byId = new Map<number, TelegramMessage>();
  for (const list of lists) for (const m of list) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

export default function TelegramChatScreen() {
  const c = useColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { chatId, title, type } = useLocalSearchParams<{
    chatId: string;
    title?: string;
    type?: string;
  }>();
  const isGroup = type === 'group' || type === 'channel';
  const path = `/api/v1/connectors/telegram/dialogs/${encodeURIComponent(chatId)}`;

  const latest = useQuery({
    queryKey: ['telegram', 'messages', chatId],
    queryFn: async () =>
      (await api.get<TelegramMessage[]>(`${path}/messages`, { params: { limit: PAGE } })).data,
    refetchInterval: 5_000,
  });

  const [older, setOlder] = useState<TelegramMessage[]>([]);
  const [sent, setSent] = useState<TelegramMessage[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const messages = useMemo(
    () => mergeMessages(older, latest.data ?? [], sent),
    [older, latest.data, sent],
  );

  // Mark read on open, and again whenever new messages arrive while it's open.
  const newestId = latest.data?.[0]?.id;
  useEffect(() => {
    if (!chatId) return;
    api
      .post(`${path}/read`)
      .then(() => queryClient.invalidateQueries({ queryKey: ['telegram', 'dialogs'] }))
      .catch(() => {});
  }, [chatId, newestId, path, queryClient]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || reachedStart || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[messages.length - 1].id;
      const { data } = await api.get<TelegramMessage[]>(`${path}/messages`, {
        params: { limit: PAGE, offset_id: oldest },
      });
      if (data.length === 0) setReachedStart(true);
      setOlder((prev) => mergeMessages(prev, data));
    } catch {
      // ignore; the user can scroll again
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, reachedStart, messages, path]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const { data } = await api.post<TelegramMessage>(`${path}/messages`, { text });
      setDraft('');
      if (data && typeof data.id === 'number') setSent((prev) => [...prev, data]);
      void latest.refetch();
    } catch (e) {
      Alert.alert('Not sent', errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const header = (
    <Stack.Screen
      options={{
        headerTitle: () => (
          <View style={styles.headerTitle}>
            <Avatar name={title || '?'} seed={chatId} size={32} {...dialogPhotoSource(chatId)} />
            <Text style={[styles.headerText, { color: c.text }]} numberOfLines={1}>
              {title || 'Chat'}
            </Text>
          </View>
        ),
      }}
    />
  );

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}
    >
      {header}
      <AsyncState
        query={latest}
        isEmpty={messages.length === 0}
        skeleton={<SkeletonList avatar={false} />}
        empty={<EmptyView icon="chatbubble-outline" title={t('telegram.noMessages')} />}
      >
        <FlatList
          inverted
          data={messages}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8, flexGrow: 1 }}
          onEndReached={() => void loadOlder()}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            loadingOlder ? <ActivityIndicator style={{ margin: 12 }} color={c.primary} /> : undefined
          }
          renderItem={({ item, index }) => {
            const above = messages[index + 1];
            const showSender =
              isGroup && !item.out && !!item.sender_name && above?.sender_id !== item.sender_id;
            const media = item.media ? MEDIA[item.media] : null;
            const fg = item.out ? c.bubbleOutText : c.text;
            return (
              <View style={[styles.bubbleRow, { justifyContent: item.out ? 'flex-end' : 'flex-start' }]}>
                <View
                  style={[
                    styles.bubble,
                    item.out
                      ? { backgroundColor: c.bubbleOut, borderBottomRightRadius: 4 }
                      : {
                          backgroundColor: c.bubbleIn,
                          borderBottomLeftRadius: 4,
                          borderColor: c.border,
                          borderWidth: StyleSheet.hairlineWidth,
                        },
                  ]}
                >
                  {showSender ? (
                    <Text style={[styles.sender, { color: c.primary }]} numberOfLines={1}>
                      {item.sender_name}
                    </Text>
                  ) : null}
                  {media ? (
                    <View style={styles.media}>
                      <Ionicons name={media.icon} size={16} color={fg} />
                      <Text style={[styles.mediaText, { color: fg }]}>{media.label}</Text>
                    </View>
                  ) : null}
                  {item.text ? <Text style={[styles.text, { color: fg }]}>{item.text}</Text> : null}
                  <Text
                    style={[
                      styles.time,
                      { color: item.out ? 'rgba(255,255,255,0.75)' : c.muted },
                    ]}
                  >
                    {timeOfDay(item.date)}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      </AsyncState>
      <View
        style={[
          styles.composer,
          {
            backgroundColor: c.card,
            borderTopColor: c.border,
            paddingBottom: Math.max(insets.bottom, 8),
          },
        ]}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={c.muted}
          multiline
          style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
        />
        <TouchableOpacity
          onPress={() => void send()}
          disabled={!draft.trim() || sending}
          style={[
            styles.send,
            { backgroundColor: c.primary, opacity: !draft.trim() || sending ? 0.5 : 1 },
          ]}
        >
          {sending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="arrow-up" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  headerTitle: { flexDirection: 'row', alignItems: 'center', maxWidth: 260 },
  headerText: { fontSize: 17, fontWeight: '600', marginLeft: 10, flexShrink: 1 },
  bubbleRow: { flexDirection: 'row', marginVertical: 2 },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7 },
  sender: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  text: { fontSize: 16, lineHeight: 21 },
  time: { fontSize: 11, alignSelf: 'flex-end', marginTop: 2 },
  media: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  mediaText: { fontSize: 14, fontStyle: 'italic', marginLeft: 5 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});
