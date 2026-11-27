import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { AsyncState } from '@/components/AsyncState';
import { Avatar, EmptyView, Field, Separator } from '@/components/ui';
import { api, type GmailThreadPage } from '@/lib/api';
import { displayFrom, relativeTime } from '@/lib/format';
import { useDebounced } from '@/lib/useDebounced';
import { useColors } from '@/lib/theme';

export { ErrorBoundary } from '@/components/ErrorBoundary';

export default function GmailInboxScreen() {
  const c = useColors();
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim(), 500);
  const pending = search.trim() !== debounced;
  const [refreshing, setRefreshing] = useState(false);

  const query = useInfiniteQuery({
    queryKey: ['gmail', 'threads', debounced],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<GmailThreadPage>('/api/v1/connectors/gmail/threads', {
          params: {
            label: 'INBOX',
            ...(debounced ? { q: debounced } : {}),
            ...(pageParam ? { page_token: pageParam } : {}),
          },
        })
      ).data,
    getNextPageParam: (last) => last.next_page_token || null,
  });

  const items = query.data?.pages.flatMap((p) => p.items ?? []) ?? [];

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
      icon="mail-outline"
      title={debounced ? t('common.nothingFound') : t('gmail.empty')}
      description={debounced ? t('gmail.noMatch', { query: debounced }) : undefined}
    />
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <TouchableOpacity onPress={() => router.push('/gmail/compose')} hitSlop={10}>
              <Ionicons name="create-outline" size={24} color={c.primary} />
            </TouchableOpacity>
          ),
        }}
      />
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Field
          value={search}
          onChangeText={setSearch}
          placeholder="Search mail (Gmail query, e.g. from:bob)"
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
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 90 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            query.isFetchingNextPage ? (
              <ActivityIndicator style={{ margin: 16 }} color={c.primary} />
            ) : undefined
          }
          ItemSeparatorComponent={() => <Separator inset={72} />}
          renderItem={({ item }) => {
            const from = displayFrom(item.from);
            const weight = item.unread ? '700' : '400';
            return (
              <TouchableOpacity
                activeOpacity={0.6}
                style={styles.row}
                onPress={() =>
                  router.push({
                    pathname: '/gmail/[threadId]',
                    params: { threadId: item.id, subject: item.subject ?? '' },
                  })
                }
              >
                <Avatar name={from} seed={item.from} size={44} />
                <View style={styles.body}>
                  <View style={styles.line}>
                    <Text
                      style={[styles.from, { color: c.text, fontWeight: weight }]}
                      numberOfLines={1}
                    >
                      {from || '(unknown)'}
                      {item.message_count > 1 ? (
                        <Text style={{ color: c.muted, fontWeight: '400' }}>
                          {`  ${item.message_count}`}
                        </Text>
                      ) : null}
                    </Text>
                    <Text
                      style={[
                        styles.date,
                        { color: item.unread ? c.primary : c.muted, fontWeight: weight },
                      ]}
                    >
                      {relativeTime(item.date)}
                    </Text>
                  </View>
                  <Text
                    style={[styles.subject, { color: c.text, fontWeight: item.unread ? '700' : '500' }]}
                    numberOfLines={1}
                  >
                    {item.subject || '(no subject)'}
                  </Text>
                  <Text style={[styles.snippet, { color: c.muted }]} numberOfLines={2}>
                    {item.snippet}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      </AsyncState>
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={() => router.push('/gmail/compose')}
        style={[styles.fab, { backgroundColor: c.primary }]}
      >
        <Ionicons name="pencil" size={18} color="#fff" />
        <Text style={styles.fabText}>Compose</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: 14, paddingVertical: 12 },
  body: { flex: 1, marginLeft: 12 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  from: { fontSize: 15, flex: 1, marginRight: 8 },
  date: { fontSize: 12 },
  subject: { fontSize: 14, marginTop: 2 },
  snippet: { fontSize: 13, marginTop: 2 },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: 24,
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
  fabText: { color: '#fff', fontWeight: '600', fontSize: 16, marginLeft: 8 },
});
