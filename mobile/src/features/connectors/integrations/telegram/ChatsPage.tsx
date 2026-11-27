import { MessageCircleMore } from 'lucide-react-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, View } from 'react-native';

import { AsyncState } from '@/components/AsyncState';
import { FeatureBoundary } from '@/components/FeatureBoundary';
import { PageHeader } from '@/components/PageHeader';
import { SearchInput } from '@/components/SearchInput';
import { EmptyView } from '@/components/StateView';
import { errorMessage } from '@/lib/api';
import { useColors } from '@/lib/theme';
import { useDebounced } from '@/lib/useDebounced';

import { NotConnected, RowDivider, SEARCH_CONTAINER } from '../../components';
import { isNotConnectedError } from '../../errors';
import { DialogRow } from './components/DialogRow';
import { TELEGRAM_NAME } from './components/TelegramConnectorCard';
import { useTelegramDialogs } from './telegram.hooks';

const SEARCH_DEBOUNCE_MS = 400;

/** All Telegram chats of the connected account, with search. */
export function TelegramChatsPage() {
  const c = useColors();
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search, SEARCH_DEBOUNCE_MS).trim();
  const isSearchPending = search.trim() !== debouncedSearch;
  const [refreshing, setRefreshing] = useState(false);

  const query = useTelegramDialogs(debouncedSearch);
  const items = query.data ?? [];

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
      <PageHeader title={TELEGRAM_NAME}>
        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder={t('telegram.searchPlaceholder')}
          autoCapitalize="none"
          containerClassName={SEARCH_CONTAINER}
        />
      </PageHeader>
      <FeatureBoundary name="telegram/dialogs" onReset={() => void query.refetch()} fullScreen>
        <AsyncState
          query={query}
          loading={isSearchPending}
          error={(error) =>
            isNotConnectedError(error) ? <NotConnected name={TELEGRAM_NAME} message={errorMessage(error)} /> : null
          }
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
        >
          <FlatList
            data={items}
            keyExtractor={(item) => String(item.id)}
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
            ItemSeparatorComponent={() => <RowDivider inset={76} />}
            ListEmptyComponent={
              <EmptyView
                icon={MessageCircleMore}
                title={debouncedSearch ? t('common.nothingFound') : t('telegram.noChats')}
                description={debouncedSearch ? t('telegram.noMatch', { query: debouncedSearch }) : undefined}
              />
            }
            renderItem={({ item }) => (
              <DialogRow
                dialog={item}
                onPress={() =>
                  router.push({
                    pathname: '/telegram/[chatId]',
                    params: { chatId: item.id, title: item.title, type: item.type },
                  })
                }
              />
            )}
          />
        </AsyncState>
      </FeatureBoundary>
    </View>
  );
}
