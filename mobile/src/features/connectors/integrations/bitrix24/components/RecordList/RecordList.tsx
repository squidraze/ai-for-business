import { Briefcase, UserPlus } from 'lucide-react-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, RefreshControl } from 'react-native';

import { AsyncState } from '@/components/AsyncState';
import { FeatureBoundary } from '@/components/FeatureBoundary';
import { SkeletonList } from '@/components/Skeleton';
import { EmptyView } from '@/components/StateView';
import { errorMessage } from '@/lib/api';
import { useColors } from '@/lib/theme';

import { NotConnected, RowDivider } from '../../../../components';
import { isNotConnectedError } from '../../../../errors';
import type { BitrixEntity } from '../../bitrix24.api';
import { useBitrixList } from '../../bitrix24.hooks';
import { BITRIX24_NAME } from '../Bitrix24ConnectorCard';
import { RecordRow } from '../RecordRow';

/** One page of the CRM pager: deals or leads matching `search`. */
export function RecordList({
  entity,
  search,
  searchPending,
}: {
  entity: BitrixEntity;
  /** Debounced, trimmed query. */
  search: string;
  /** The typed query hasn't been debounced yet: show the skeleton right away. */
  searchPending: boolean;
}) {
  const c = useColors();
  const { t } = useTranslation();
  const [refreshing, setRefreshing] = useState(false);
  const query = useBitrixList(entity, search);
  const items = query.data?.pages.flatMap((page) => page.items ?? []) ?? [];
  const isDeals = entity === 'deals';

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <FeatureBoundary name={`bitrix24/${entity}`} onReset={() => void query.refetch()} fullScreen>
      <AsyncState
        query={query}
        loading={searchPending}
        skeleton={<SkeletonList avatar={false} />}
        error={(error) =>
          isNotConnectedError(error) ? <NotConnected name={BITRIX24_NAME} message={errorMessage(error)} /> : null
        }
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
      >
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
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
          ItemSeparatorComponent={() => <RowDivider inset={16} />}
          ListEmptyComponent={
            <EmptyView
              icon={isDeals ? Briefcase : UserPlus}
              title={search ? t('common.nothingFound') : isDeals ? t('bitrix.noDeals') : t('bitrix.noLeads')}
              description={
                search ? t(isDeals ? 'bitrix.noDealsMatch' : 'bitrix.noLeadsMatch', { query: search }) : undefined
              }
            />
          }
          renderItem={({ item }) => (
            <RecordRow
              entity={entity}
              record={item}
              onPress={() =>
                router.push({ pathname: '/bitrix/[entity]/[id]', params: { entity, id: item.id } })
              }
            />
          )}
        />
      </AsyncState>
    </FeatureBoundary>
  );
}
