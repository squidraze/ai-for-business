import { router } from 'expo-router';
import { Pencil, SquarePen, Mail } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl, TouchableOpacity, View } from 'react-native';

import { AsyncState } from '@/components/AsyncState';
import { FeatureBoundary } from '@/components/FeatureBoundary';
import { PageHeader } from '@/components/PageHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SearchInput } from '@/components/SearchInput';
import { EmptyView } from '@/components/StateView';
import { errorMessage } from '@/lib/api';
import { useLabelColors } from '@/lib/screen';
import { useColors } from '@/lib/theme';
import { useDebounced } from '@/lib/useDebounced';

import { NotConnected, RowDivider, SEARCH_CONTAINER } from '../../components';
import { isNotConnectedError } from '../../errors';
import { GMAIL_NAME } from './components/GmailConnectorCard';
import { ThreadRow } from './components/ThreadRow';
import { useGmailThreads } from './gmail.hooks';

const SEARCH_DEBOUNCE_MS = 500;

const openCompose = () => router.push('/gmail/compose');

/** The Gmail inbox: paged threads, Gmail-query search, compose. */
export function GmailInboxPage() {
  const c = useColors();
  const labelColors = useLabelColors();
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS).trim();
  const isSearchPending = search.trim() !== debouncedSearch;
  const [refreshing, setRefreshing] = useState(false);

  const query = useGmailThreads(debouncedSearch);
  const items = query.data?.pages.flatMap((page) => page.items ?? []) ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <PageHeader
        title={t('gmail.title')}
        action={
          <TouchableOpacity
            onPress={openCompose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('gmail.compose')}
          >
            <SquarePen size={24} color={labelColors.label} />
          </TouchableOpacity>
        }
      >
        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('gmail.searchPlaceholder')}
          autoCapitalize="none"
          containerClassName={SEARCH_CONTAINER}
        />
      </PageHeader>
      <FeatureBoundary name="gmail/threads" onReset={() => void query.refetch()} fullScreen>
        <AsyncState
          query={query}
          loading={isSearchPending}
          error={(error) =>
            isNotConnectedError(error) ? <NotConnected name={GMAIL_NAME} message={errorMessage(error)} /> : null
          }
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
        >
          <FlatList
            data={items}
            keyExtractor={(item) => String(item.id)}
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
              query.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} color={c.primary} /> : undefined
            }
            ItemSeparatorComponent={() => <RowDivider inset={72} />}
            ListEmptyComponent={
              <EmptyView
                icon={Mail}
                title={debouncedSearch ? t('common.nothingFound') : t('gmail.empty')}
                description={debouncedSearch ? t('gmail.noMatch', { query: debouncedSearch }) : undefined}
              />
            }
            renderItem={({ item }) => (
              <ThreadRow
                thread={item}
                onPress={() =>
                  router.push({
                    pathname: '/gmail/[threadId]',
                    params: { threadId: item.id, subject: item.subject ?? '' },
                  })
                }
              />
            )}
          />
        </AsyncState>
      </FeatureBoundary>
      <PrimaryButton
        size="base"
        label={t('gmail.compose')}
        icon={Pencil}
        onPress={openCompose}
        className="absolute bottom-6 right-4 px-5"
      />
    </View>
  );
}
