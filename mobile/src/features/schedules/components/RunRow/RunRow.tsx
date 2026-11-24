import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Skeleton } from '@/components/Skeleton';
import { useColors } from '@/lib/theme';

import { formatWhen } from '../../recurrence';
import type { ScheduleRun } from '../../schedules.api';
import { StatusChip, statusLook } from '../StatusChip';

/** One entry of the run history. */
export function RunRow({ run }: { run: ScheduleRun }) {
  const c = useColors();
  const { t } = useTranslation();
  const look = statusLook(run.status, c);
  const detail =
    run.status === 'skipped' && run.skip_reason
      ? t(`schedules.skipReason.${run.skip_reason}`, { defaultValue: t('schedules.status.skipped') })
      : run.summary;
  return (
    <View style={styles.row}>
      <View style={[styles.icon, { backgroundColor: look.bg }]}>
        <Ionicons name={look.icon} size={18} color={look.fg} />
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={[styles.time, { color: c.text }]} numberOfLines={1}>
            {formatWhen(run.started_at, t)}
          </Text>
          <StatusChip status={run.status} />
        </View>
        <Text style={[styles.trigger, { color: c.muted }]}>{t(`schedules.trigger.${run.trigger}`)}</Text>
        {detail ? (
          <Text style={[styles.summary, { color: c.muted }]} numberOfLines={4}>
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function RunRowSkeleton() {
  return (
    <View style={styles.row}>
      <Skeleton width={36} height={36} radius={18} />
      <View style={styles.body}>
        <View style={styles.top}>
          <Skeleton width="45%" height={14} />
          <Skeleton width={80} height={20} radius={10} />
        </View>
        <Skeleton width="30%" style={{ marginTop: 8 }} />
        <Skeleton width="85%" style={{ marginTop: 8 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingVertical: 12, gap: 12 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  time: { flex: 1, fontSize: 15, fontWeight: '600' },
  trigger: { fontSize: 13, marginTop: 2 },
  summary: { fontSize: 14, marginTop: 6, lineHeight: 19 },
});
