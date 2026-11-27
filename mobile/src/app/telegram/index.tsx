import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { AsyncState } from '@/components/AsyncState';
import { Avatar, EmptyView, Field, Separator } from '@/components/ui';
import { api, dialogPhotoSource, type TelegramDialog } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useDebounced } from '@/lib/useDebounced';
import { useColors } from '@/lib/theme';

export { ErrorBoundary } from '@/components/ErrorBoundary';

export default function TelegramDialogsScreen() {
  const c = useColors();
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim(), 400);
  const pending = search.trim() !== debounced;
  const [refreshing, setRefreshing] = useState(false);

  const query = useQuery({
    queryKey: ['telegram', 'dialogs', debounced],
    queryFn: async () =>
      (
        await api.get<TelegramDialog[]>('/api/v1/connectors/telegram/dialogs', {
          params: { limit: 50, ...(debounced ? { q: debounced } : {}) },
        })
      ).data,
    refetchInterval: 15_000,
  });

  const items = query.data ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const empty = (
    <EmptyView
      icon="chatbubble-ellipses-outline"
      title={debounced ? t('common.nothingFound') : t('telegram.noChats')}
      description={debounced ? t('telegram.noMatch', { query: debounced }) : undefined}
    />
  );

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Field
          value={search}
          onChangeText={setSearch}
          placeholder="Search chats"
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>
      <AsyncState
        query={query}
        loading={pending}
        isEmpty={items.length === 0}
        empty={empty}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
      >
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
          ItemSeparatorComponent={() => <Separator inset={76} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.6}
              style={styles.row}
              onPress={() =>
                router.push({
                  pathname: '/telegram/[chatId]',
                  params: { chatId: item.id, title: item.title, type: item.type },
                })
              }
            >
              <Avatar name={item.title} seed={item.id} size={52} {...dialogPhotoSource(item.id)} />
              <View style={styles.body}>
                <View style={styles.topLine}>
                  <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
                    {item.title || 'Unnamed'}
                  </Text>
                  <Text style={[styles.time, { color: c.muted }]}>
                    {relativeTime(item.last_message?.date)}
                  </Text>
                </View>
                <View style={styles.topLine}>
                  <Text style={[styles.preview, { color: c.muted }]} numberOfLines={1}>
                    {item.last_message
                      ? `${item.last_message.out ? 'You: ' : ''}${item.last_message.text || 'Media'}`
                      : ' '}
                  </Text>
                  {item.unread_count > 0 ? (
                    <View style={[styles.badge, { backgroundColor: c.badge }]}>
                      <Text style={styles.badgeText}>
                        {item.unread_count > 999 ? '999+' : item.unread_count}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      </AsyncState>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  body: { flex: 1, marginLeft: 12 },
  topLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '600', flex: 1, marginRight: 8 },
  time: { fontSize: 12 },
  preview: { fontSize: 14, flex: 1, marginTop: 3, marginRight: 8 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 3,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
