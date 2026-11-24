import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { AsyncState, resolveAsyncState } from '@/components/AsyncState';
import { Button } from '@/components/Button';
import { FadeSwitch } from '@/components/FadeSwitch';
import { Skeleton } from '@/components/Skeleton';
import { EmptyView, ErrorView } from '@/components/StateView';
import { Separator } from '@/components/ui';
import { errorMessage, parseApiError } from '@/lib/api';
import { useColors } from '@/lib/theme';

import { RunRow, RunRowSkeleton } from './components/RunRow';
import { ScheduleNotFound } from './components/ScheduleNotFound';
import { StatusChip } from './components/StatusChip';
import { openScheduleChat, openScheduleEdit } from './navigation';
import { formatRecurrence, formatWhen, nextRunLabel } from './recurrence';
import type { Schedule } from './schedules.api';
import { useRunSchedule, useSchedule, useScheduleRuns, useToggleSchedule } from './schedules.hooks';

/** Distance from the bottom (px) at which the next page of runs loads. */
const LOAD_MORE_OFFSET = 300;

/** `/schedules/[id]`: the task, its actions and the run history. */
export function ScheduleDetailPage() {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { t } = useTranslation();
  const navigation = useNavigation();
  const query = useSchedule(id);
  const schedule = query.data;

  useLayoutEffect(() => {
    navigation.setOptions({
      title: schedule?.title ?? '',
      headerRight: schedule
        ? () => (
            <TouchableOpacity
              onPress={() => openScheduleEdit(schedule.uuid)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('schedules.edit')}
            >
              <Ionicons name="create-outline" size={24} color={c.primary} />
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [navigation, schedule, c.primary, t]);

  return (
    <AsyncState
      query={query}
      skeleton={<DetailSkeleton />}
      error={(error, retry) =>
        parseApiError(error).status === 404 ? (
          <ScheduleNotFound />
        ) : (
          <ErrorView message={errorMessage(error)} onRetry={retry} />
        )
      }
    >
      {() => (schedule ? <DetailContent schedule={schedule} refetch={query.refetch} /> : null)}
    </AsyncState>
  );
}

function DetailContent({ schedule, refetch }: { schedule: Schedule; refetch: () => Promise<unknown> }) {
  const c = useColors();
  const { t } = useTranslation();
  const toggle = useToggleSchedule();
  const run = useRunSchedule(schedule.uuid);
  const runs = useScheduleRuns(schedule.uuid, { poll: schedule.last_run?.status === 'running' });
  const [refreshing, setRefreshing] = useState(false);
  const [runMessage, setRunMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const items = runs.data?.pages.flatMap((page) => page.items) ?? [];
  const runsState = resolveAsyncState(runs, { isEmpty: items.length === 0 });

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetch(), runs.refetch()]);
    } finally {
      setRefreshing(false);
    }
  };

  const onScroll = ({ nativeEvent }: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
    const nearEnd = layoutMeasurement.height + contentOffset.y >= contentSize.height - LOAD_MORE_OFFSET;
    if (nearEnd && runs.hasNextPage && !runs.isFetchingNextPage) void runs.fetchNextPage();
  };

  const runNow = () => {
    setRunMessage(null);
    run.mutate(undefined, {
      onSuccess: () => setRunMessage({ ok: true, text: t('schedules.runStarted') }),
      onError: (error) => setRunMessage({ ok: false, text: errorMessage(error) }),
    });
  };

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      onScroll={onScroll}
      scrollEventThrottle={100}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void onRefresh()}
          tintColor={c.primary}
          colors={[c.primary]}
        />
      }
    >
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.cardTop}>
          <Text style={[styles.title, { color: c.text }]}>{schedule.title}</Text>
          <Switch
            value={schedule.enabled}
            onValueChange={(enabled) => toggle.mutate({ uuid: schedule.uuid, enabled })}
            trackColor={{ true: c.primary, false: c.border }}
            thumbColor="#ffffff"
            accessibilityLabel={t('schedules.fields.enabled')}
          />
        </View>
        <InfoLine icon="repeat" text={formatRecurrence(schedule, t)} />
        <InfoLine icon={schedule.enabled ? 'time-outline' : 'pause-circle-outline'} text={nextRunLabel(schedule, t)} />
        {schedule.last_run_at ? (
          <InfoLine icon="checkmark-done-outline" text={t('schedules.lastRun', { when: formatWhen(schedule.last_run_at, t) })} />
        ) : null}
        <InfoLine icon="notifications-outline" text={t(`schedules.notify.${schedule.notify}`)} />
        {schedule.pending_approval ? (
          <View style={{ marginTop: 12 }}>
            <StatusChip status="awaiting_approval" onPress={() => openScheduleChat(schedule)} />
          </View>
        ) : null}
        {toggle.isError ? (
          <Text style={[styles.message, { color: c.danger }]}>
            {t('schedules.toggleFailed', { message: errorMessage(toggle.error) })}
          </Text>
        ) : null}
        <Text style={[styles.prompt, { color: c.muted, borderTopColor: c.border }]} numberOfLines={6}>
          {schedule.prompt}
        </Text>
      </View>

      <View style={styles.actions}>
        <Button title={t('schedules.openChat')} icon="chatbubbles-outline" onPress={() => openScheduleChat(schedule)} />
        <View style={styles.actionRow}>
          <Button
            title={t('schedules.runNow')}
            icon="play"
            variant="secondary"
            onPress={runNow}
            loading={run.isPending}
            style={{ flex: 1 }}
          />
          <Button
            title={t('schedules.edit')}
            icon="create-outline"
            variant="secondary"
            onPress={() => openScheduleEdit(schedule.uuid)}
            style={{ flex: 1 }}
          />
        </View>
        {runMessage ? (
          <Text
            style={[styles.message, { color: runMessage.ok ? c.success : c.danger, textAlign: 'center' }]}
            accessibilityLiveRegion="polite"
          >
            {runMessage.text}
          </Text>
        ) : null}
      </View>

      <Text style={[styles.section, { color: c.muted }]}>{t('schedules.history')}</Text>
      <FadeSwitch stateKey={runsState} style={styles.history}>
        {runsState === 'loading' ? (
          <View>
            <RunRowSkeleton />
            <RunRowSkeleton />
            <RunRowSkeleton />
          </View>
        ) : runsState === 'error' ? (
          <ErrorView message={errorMessage(runs.error)} onRetry={() => void runs.refetch()} />
        ) : runsState === 'empty' ? (
          <EmptyView icon="time-outline" title={t('schedules.noRuns')} description={t('schedules.noRunsText')} />
        ) : (
          <View>
            {items.map((item, index) => (
              <View key={item.uuid}>
                {index > 0 ? <Separator inset={48} /> : null}
                <RunRow run={item} />
              </View>
            ))}
            {runs.isFetchingNextPage ? <ActivityIndicator style={{ margin: 16 }} color={c.primary} /> : null}
          </View>
        )}
      </FadeSwitch>
    </ScrollView>
  );
}

function InfoLine({ icon, text }: { icon: 'repeat' | 'time-outline' | 'pause-circle-outline' | 'checkmark-done-outline' | 'notifications-outline'; text: string }) {
  const c = useColors();
  return (
    <View style={styles.line}>
      <Ionicons name={icon} size={16} color={c.muted} />
      <Text style={[styles.lineText, { color: c.text }]}>{text}</Text>
    </View>
  );
}

function DetailSkeleton() {
  const c = useColors();
  return (
    <View style={styles.container} accessibilityRole="progressbar" accessibilityState={{ busy: true }}>
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={styles.cardTop}>
          <Skeleton width="55%" height={20} radius={8} />
          <Skeleton width={44} height={24} radius={12} />
        </View>
        <Skeleton width="70%" style={{ marginTop: 12 }} />
        <Skeleton width="50%" style={{ marginTop: 10 }} />
        <Skeleton width="60%" style={{ marginTop: 10 }} />
        <Skeleton width="95%" style={{ marginTop: 18 }} />
        <Skeleton width="80%" style={{ marginTop: 8 }} />
      </View>
      <View style={styles.actions}>
        <Skeleton height={48} radius={12} />
        <View style={styles.actionRow}>
          <Skeleton height={48} radius={12} style={{ flex: 1 }} />
          <Skeleton height={48} radius={12} style={{ flex: 1 }} />
        </View>
      </View>
      <Skeleton width={90} height={13} style={{ marginTop: 24, marginBottom: 4 }} />
      <RunRowSkeleton />
      <RunRowSkeleton />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 },
  title: { flex: 1, fontSize: 19, fontWeight: '700' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  lineText: { flex: 1, fontSize: 15 },
  prompt: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actions: { marginTop: 16, gap: 10 },
  actionRow: { flexDirection: 'row', gap: 10 },
  message: { fontSize: 14, marginTop: 8 },
  section: { fontSize: 13, fontWeight: '600', marginTop: 24, textTransform: 'uppercase', letterSpacing: 0.5 },
  history: { minHeight: 220 },
});
