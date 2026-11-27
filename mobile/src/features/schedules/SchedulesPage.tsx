import { AlarmClock, Plus, Sparkles } from 'lucide-react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AsyncState } from '@/components/AsyncState';
import { HeaderIconButton } from '@/components/HeaderIconButton';
import { PrimaryButton } from '@/components/PrimaryButton';
import { ScreenHeader } from '@/components/ScreenHeader';
import { EmptyView } from '@/components/StateView';
import { useLabelColors } from '@/lib/screen';
import { useColors } from '@/lib/theme';

import { ScheduleCard, ScheduleListSkeleton } from './components/ScheduleCard';
import { openNewSchedule } from './navigation';
import { invalidateSchedules, useSchedules } from './schedules.hooks';

/** The "Tasks" tab: the user's recurring assistant tasks. */
export function SchedulesPage() {
  const c = useColors();
  const { t } = useTranslation();
  const labelColors = useLabelColors();
  const queryClient = useQueryClient();
  const query = useSchedules();
  const [refreshing, setRefreshing] = useState(false);

  // The assistant can create tasks from a chat: refresh whenever the tab is shown.
  useFocusEffect(
    useCallback(() => {
      void invalidateSchedules(queryClient);
    }, [queryClient]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await invalidateSchedules(queryClient);
    } finally {
      setRefreshing(false);
    }
  };

  const items = query.data ?? [];

  const empty = (
    <EmptyView icon={AlarmClock} title={t('schedules.emptyTitle')} description={t('schedules.emptyText')}>
      <View style={[styles.example, { backgroundColor: c.card, borderColor: c.border }]}>
        <Sparkles size={16} color={c.primary} />
        <Text style={[styles.exampleText, { color: c.muted }]}>{t('schedules.emptyExample')}</Text>
      </View>
      <PrimaryButton label={t('schedules.create')} icon={Plus} size="md" onPress={openNewSchedule} className="mt-4 min-w-[180px] px-5" />
    </EmptyView>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: c.bg }}>
      <View className="pt-5">
        <ScreenHeader
          title={t('tabs.schedules')}
          actions={
            <HeaderIconButton onPress={openNewSchedule} accessibilityLabel={t('schedules.create')}>
              <Plus size={20} color={labelColors.label} />
            </HeaderIconButton>
          }
        />
      </View>
      <AsyncState
        query={query}
        isEmpty={items.length === 0}
        skeleton={<ScheduleListSkeleton />}
        empty={empty}
        refreshing={refreshing}
        onRefresh={() => void onRefresh()}
      >
        <FlatList
          data={items}
          keyExtractor={(item) => item.uuid}
          renderItem={({ item }) => <ScheduleCard schedule={item} />}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={c.primary}
              colors={[c.primary]}
            />
          }
        />
      </AsyncState>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 32 },
  example: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginTop: 16,
    gap: 8,
    maxWidth: 340,
  },
  exampleText: { flex: 1, fontSize: 14, lineHeight: 19, fontStyle: 'italic' },
});
