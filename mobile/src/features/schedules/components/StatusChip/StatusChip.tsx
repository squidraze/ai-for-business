import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { IconName } from '@/components/Button';
import { useColors, type Colors } from '@/lib/theme';

import type { RunStatus } from '../../schedules.api';

type Look = { icon: IconName; fg: string; bg: string };

export function statusLook(status: RunStatus, c: Colors): Look {
  switch (status) {
    case 'running':
      return { icon: 'sync', fg: c.primary, bg: c.primaryBg };
    case 'awaiting_approval':
      return { icon: 'hand-left-outline', fg: c.warning, bg: c.warningBg };
    case 'completed':
      return { icon: 'checkmark-circle', fg: c.success, bg: c.successBg };
    case 'failed':
      return { icon: 'close-circle', fg: c.danger, bg: c.dangerBg };
    case 'skipped':
      return { icon: 'play-skip-forward-outline', fg: c.muted, bg: c.inputBg };
    default:
      return { icon: 'ban-outline', fg: c.muted, bg: c.inputBg };
  }
}

/** Run status pill; with `onPress` it shows a chevron (e.g. "Needs approval" → chat). */
export function StatusChip({ status, onPress }: { status: RunStatus; onPress?: () => void }) {
  const c = useColors();
  const { t } = useTranslation();
  const look = statusLook(status, c);
  const label = t(`schedules.status.${status}`);
  const body = (
    <View style={[styles.chip, { backgroundColor: look.bg }]}>
      <Ionicons name={look.icon} size={14} color={look.fg} />
      <Text style={[styles.text, { color: look.fg }]} numberOfLines={1}>
        {label}
      </Text>
      {onPress ? <Ionicons name="chevron-forward" size={13} color={look.fg} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={8}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    gap: 4,
  },
  text: { fontSize: 12, fontWeight: '600' },
});
