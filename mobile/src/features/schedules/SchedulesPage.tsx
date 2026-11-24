import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AsyncState } from '@/components/AsyncState';
import { Button } from '@/components/Button';
import { EmptyView } from '@/components/StateView';
import { useColors } from '@/lib/theme';

import { ScheduleCard, ScheduleListSkeleton } from './components/ScheduleCard';
import { openNewSchedule } from './navigation';
import { invalidateSchedules, useSchedules } from './schedules.hooks';

/** The "Tasks" tab: the user's recurring assistant tasks. */
export function SchedulesPage() {
  const c = useColors();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const query = useSchedules();
  const [refreshing, setRefreshing] = useState(false);

  // The assistant can create tasks from a chat: refresh whenever the tab is shown.
  useFocusEffect(
    useCallback(() => {
      void invalidateSchedules(queryClient);
    }, [queryClient]),
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity
          onPress={openNewSchedule}
          hitSlop={10}
          style={{ marginRight: 16 }}
          accessibilityRole="button"
          accessibilityLabel={t('schedules.create')}
        >
          <Ionicons name="add-circle-outline" size={28} color={c.primary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation, c.primary, t]);

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
    <EmptyView icon="alarm-outline" title={t('schedules.emptyTitle')} description={t('schedules.emptyText')}>
      <View style={[styles.example, { backgroundColor: c.card, borderColor: c.border }]}>
        <Ionicons name="sparkles-outline" size={16} color={c.primary} />
        <Text style={[styles.exampleText, { color: c.muted }]}>{t('schedules.emptyExample')}</Text>
      </View>
      <Button title={t('schedules.create')} icon="add" onPress={openNewSchedule} style={{ marginTop: 16, minWidth: 180 }} />
    </EmptyView>
  );

  return (
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
