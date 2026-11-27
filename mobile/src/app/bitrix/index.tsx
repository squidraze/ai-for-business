import { useInfiniteQuery } from '@tanstack/react-query';
import axios from 'axios';
import { router } from 'expo-router';
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

import { StagePill } from '@/components/bitrix';
import { AsyncState } from '@/components/AsyncState';
import { SkeletonList } from '@/components/Skeleton';
import { Button, EmptyView, Field, Separator } from '@/components/ui';
import {
  api,
  errorMessage,
  type BitrixDeal,
  type BitrixEntity,
  type BitrixLead,
  type BitrixPage,
} from '@/lib/api';
import { formatMoney, relativeTime } from '@/lib/format';
import { useDebounced } from '@/lib/useDebounced';
import { useColors } from '@/lib/theme';

export { ErrorBoundary } from '@/components/ErrorBoundary';

type Row = BitrixDeal | BitrixLead;

const TABS: { key: BitrixEntity; label: string }[] = [
  { key: 'deals', label: 'Deals' },
  { key: 'leads', label: 'Leads' },
];

export default function BitrixCrmScreen() {
  const c = useColors();
  const { t } = useTranslation();
  const [entity, setEntity] = useState<BitrixEntity>('deals');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search.trim(), 400);
  const pending = search.trim() !== debounced;
  const [refreshing, setRefreshing] = useState(false);

  const query = useInfiniteQuery({
    queryKey: ['bitrix', entity, 'list', debounced],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) =>
      (
        await api.get<BitrixPage<Row>>(`/api/v1/connectors/bitrix24/${entity}`, {
          params: { start: pageParam, ...(debounced ? { q: debounced } : {}) },
        })
      ).data,
    getNextPageParam: (last) => last.next ?? null,
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

  const noun = entity === 'deals' ? 'deals' : 'leads';

  const empty = (
    <EmptyView
      icon={entity === 'deals' ? 'briefcase-outline' : 'person-add-outline'}
      title={
        debounced
          ? t('common.nothingFound')
          : entity === 'deals'
            ? t('bitrix.noDeals')
            : t('bitrix.noLeads')
      }
      description={
        debounced
          ? t(entity === 'deals' ? 'bitrix.noDealsMatch' : 'bitrix.noLeadsMatch', { query: debounced })
          : undefined
      }
    />
  );

  // 409 = the portal isn't connected: offer the Connectors tab instead of "retry".
  const notConnected = (error: unknown) =>
    axios.isAxiosError(error) && error.response?.status === 409 ? (
      <EmptyView icon="briefcase-outline" title={t('bitrix.notConnected')} description={errorMessage(error)}>
        <Button
          title={t('bitrix.openConnectors')}
          onPress={() => router.navigate('/connectors')}
          style={{ marginTop: 16, minWidth: 180 }}
        />
      </EmptyView>
    ) : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <View style={[styles.segments, { backgroundColor: c.inputBg }]}>
          {TABS.map((tab) => {
            const active = tab.key === entity;
            return (
              <TouchableOpacity
                key={tab.key}
                activeOpacity={0.7}
                onPress={() => setEntity(tab.key)}
                style={[styles.segment, active && { backgroundColor: c.card }]}
              >
                <Text
                  style={[
                    styles.segmentText,
                    { color: active ? c.text : c.muted, fontWeight: active ? '600' : '500' },
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Field
          value={search}
          onChangeText={setSearch}
          placeholder={`Search ${noun} by title`}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
      </View>
      <AsyncState
        query={query}
        loading={pending}
        isEmpty={items.length === 0}
        skeleton={<SkeletonList avatar={false} />}
        empty={empty}
        error={notConnected}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
      >
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
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
            query.isFetchingNextPage ? (
              <ActivityIndicator style={{ margin: 16 }} color={c.primary} />
            ) : undefined
          }
          ItemSeparatorComponent={() => <Separator inset={16} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              activeOpacity={0.6}
              style={styles.row}
              onPress={() =>
                router.push({
                  pathname: '/bitrix/[entity]/[id]',
                  params: { entity, id: item.id },
                })
              }
            >
              {entity === 'deals' ? (
                <DealRow deal={item as BitrixDeal} />
              ) : (
                <LeadRow lead={item as BitrixLead} />
              )}
            </TouchableOpacity>
          )}
        />
      </AsyncState>
    </View>
  );
}

function DealRow({ deal }: { deal: BitrixDeal }) {
  const c = useColors();
  const amount = formatMoney(deal.opportunity, deal.currency);
  const party = [deal.contact_name, deal.company_title].filter(Boolean).join(' · ');
  return (
    <>
      <View style={styles.line}>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
          {deal.title || '(untitled deal)'}
        </Text>
        <Text style={[styles.date, { color: c.muted }]}>{relativeTime(deal.date_modify)}</Text>
      </View>
      <View style={[styles.line, styles.meta]}>
        <View style={{ flexShrink: 1, marginRight: 8 }}>
          <StagePill label={deal.stage_name || deal.stage_id} />
        </View>
        {amount ? <Text style={[styles.amount, { color: c.text }]}>{amount}</Text> : null}
      </View>
      {party ? (
        <Text style={[styles.sub, { color: c.muted }]} numberOfLines={1}>
          {party}
        </Text>
      ) : null}
    </>
  );
}

function LeadRow({ lead }: { lead: BitrixLead }) {
  const c = useColors();
  const person = [lead.name, lead.phone].filter(Boolean).join(' · ');
  return (
    <>
      <View style={styles.line}>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
          {lead.title || '(untitled lead)'}
        </Text>
        <Text style={[styles.date, { color: c.muted }]}>
          {relativeTime(lead.date_modify ?? lead.date_create)}
        </Text>
      </View>
      <View style={[styles.line, styles.meta]}>
        <StagePill label={lead.status_name || lead.status_id} />
      </View>
      {person ? (
        <Text style={[styles.sub, { color: c.muted }]} numberOfLines={1}>
          {person}
        </Text>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', borderRadius: 12, padding: 3, marginBottom: 12 },
  segment: { flex: 1, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segmentText: { fontSize: 15 },
  row: { paddingHorizontal: 16, paddingVertical: 12 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { marginTop: 6 },
  title: { fontSize: 15, fontWeight: '600', flex: 1, marginRight: 8 },
  date: { fontSize: 12 },
  amount: { fontSize: 14, fontWeight: '600' },
  sub: { fontSize: 13, marginTop: 6 },
});
