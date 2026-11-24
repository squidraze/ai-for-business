import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { AsyncState } from '@/components/AsyncState';
import { SkeletonList } from '@/components/Skeleton';
import { Button, EmptyView, Separator } from '@/components/ui';
import { api, CONVERSATIONS_KEY, errorMessage, type AIConversation } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useColors } from '@/lib/theme';

const PAGE = 30;


type Page = { items: AIConversation[]; total: number };

export default function ChatsScreen() {
  const c = useColors();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const query = useInfiniteQuery({
    queryKey: CONVERSATIONS_KEY,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data } = await api.get<Page>('/api/v1/ai/conversations', {
        params: { limit: PAGE, offset: pageParam },
      });
      return data;
    },
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + (p.items?.length ?? 0), 0);
      return (last.items?.length ?? 0) === PAGE && loaded < (last.total ?? Infinity)
        ? loaded
        : undefined;
    },
  });

  // The WebView creates/titles conversations; refresh whenever we come back.
  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
    }, [queryClient]),
  );

  const remove = useMutation({
    mutationFn: (uuid: string) => api.delete(`/api/v1/ai/conversations/${uuid}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY }),
    onError: (e) => Alert.alert('Delete failed', errorMessage(e)),
  });

  const newChat = useCallback(() => router.push('/chat/new'), []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity onPress={newChat} hitSlop={10} style={{ marginRight: 16 }}>
          <Ionicons name="create-outline" size={26} color={c.primary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, newChat, c.primary]);

  const items = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const confirmDelete = (item: AIConversation) =>
    Alert.alert('Delete chat?', item.title || 'Untitled chat', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(item.uuid) },
    ]);

  const empty = (
    <EmptyView icon="chatbubbles-outline" title={t('chats.emptyTitle')} description={t('chats.emptyText')}>
      <Button title={t('chats.start')} icon="add" onPress={newChat} style={{ marginTop: 16 }} />
    </EmptyView>
  );

  return (
    <AsyncState
      query={query}
      isEmpty={items.length === 0}
      skeleton={<SkeletonList avatar={false} />}
      empty={empty}
      refreshing={refreshing}
      onRefresh={() => void onRefresh()}
    >
      <View style={{ flex: 1 }}>
        <FlatList
          data={items}
          keyExtractor={(item) => item.uuid}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 96 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
          ItemSeparatorComponent={() => <Separator inset={68} />}
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <ActivityIndicator style={{ margin: 16 }} color={c.primary} />
            ) : undefined
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.6}
              onPress={() =>
                router.push({
                  pathname: '/chat/[id]',
                  params: { id: item.uuid, title: item.title ?? '' },
                })
              }
              onLongPress={() => confirmDelete(item)}
              style={[styles.row, { backgroundColor: c.bg }]}
            >
              <View style={[styles.icon, { backgroundColor: c.inputBg }]}>
                <Ionicons name="sparkles-outline" size={20} color={c.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
                  {item.title || 'New chat'}
                </Text>
                <Text style={[styles.time, { color: c.muted }]}>
                  {relativeTime(item.last_message_at ?? item.updated_at ?? item.created_at)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => confirmDelete(item)} hitSlop={10}>
                <Ionicons name="trash-outline" size={20} color={c.muted} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        />
        {items.length > 0 ? (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={newChat}
            style={[styles.fab, { backgroundColor: c.primary }]}
          >
            <Ionicons name="add" size={22} color="#fff" />
            <Text style={styles.fabText}>New chat</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </AsyncState>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  title: { fontSize: 16, fontWeight: '600' },
  time: { fontSize: 13, marginTop: 3 },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 20,
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: '#fff', fontWeight: '600', fontSize: 16, marginLeft: 6 },
});
