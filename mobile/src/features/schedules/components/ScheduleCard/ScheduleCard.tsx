import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';

import { Skeleton } from '@/components/Skeleton';
import { errorMessage } from '@/lib/api';
import { useColors } from '@/lib/theme';

import { openSchedule, openScheduleChat } from '../../navigation';
import { formatRecurrence, nextRunLabel } from '../../recurrence';
import type { Schedule } from '../../schedules.api';
import { useToggleSchedule } from '../../schedules.hooks';
import { StatusChip } from '../StatusChip';

export function ScheduleCard({ schedule }: { schedule: Schedule }) {
  const c = useColors();
  const { t } = useTranslation();
  const toggle = useToggleSchedule();
  const status = schedule.pending_approval ? 'awaiting_approval' : schedule.last_run?.status;

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => openSchedule(schedule.uuid)}
      accessibilityRole="button"
      accessibilityLabel={schedule.title}
      style={[
        styles.card,
        {
          backgroundColor: c.card,
          borderColor: schedule.pending_approval ? c.warning : c.border,
        },
      ]}
    >
      <View style={styles.top}>
        <Text style={[styles.title, { color: schedule.enabled ? c.text : c.muted }]} numberOfLines={2}>
          {schedule.title}
        </Text>
        <Switch
          value={schedule.enabled}
          onValueChange={(enabled) => toggle.mutate({ uuid: schedule.uuid, enabled })}
          trackColor={{ true: c.primary, false: c.border }}
          thumbColor="#ffffff"
          accessibilityLabel={t('schedules.fields.enabled')}
        />
      </View>

      <View style={styles.line}>
        <Ionicons name="repeat" size={15} color={c.muted} />
        <Text style={[styles.lineText, { color: c.muted }]} numberOfLines={1}>
          {formatRecurrence(schedule, t)}
        </Text>
      </View>
      <View style={styles.line}>
        <Ionicons name={schedule.enabled ? 'time-outline' : 'pause-circle-outline'} size={15} color={c.muted} />
        <Text style={[styles.lineText, { color: c.muted }]} numberOfLines={1}>
          {nextRunLabel(schedule, t)}
        </Text>
      </View>

      {status ? (
        <View style={styles.status}>
          <StatusChip
            status={status}
            onPress={status === 'awaiting_approval' ? () => openScheduleChat(schedule) : undefined}
          />
        </View>
      ) : null}

      {toggle.isError ? (
        <Text style={[styles.error, { color: c.danger }]} accessibilityLiveRegion="polite">
          {t('schedules.toggleFailed', { message: errorMessage(toggle.error) })}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

export function ScheduleCardSkeleton() {
  const c = useColors();
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.top}>
        <Skeleton width="60%" height={16} radius={8} />
        <Skeleton width={44} height={24} radius={12} />
      </View>
      <Skeleton width="70%" style={{ marginTop: 6 }} />
      <Skeleton width="45%" style={{ marginTop: 10 }} />
      <Skeleton width={110} height={22} radius={11} style={{ marginTop: 12 }} />
    </View>
  );
}

export function ScheduleListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View style={styles.skeletonList} accessibilityRole="progressbar" accessibilityState={{ busy: true }}>
      {Array.from({ length: count }).map((_, index) => (
        <ScheduleCardSkeleton key={index} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { flex: 1, fontSize: 16, fontWeight: '600' },
  line: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6 },
  lineText: { flex: 1, fontSize: 14 },
  status: { marginTop: 12 },
  error: { fontSize: 13, marginTop: 10 },
  skeletonList: { padding: 16, gap: 12 },
});
