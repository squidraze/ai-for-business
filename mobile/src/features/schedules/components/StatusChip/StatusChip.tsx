import {
  Ban,
  ChevronRight,
  CircleCheck,
  CircleX,
  Hand,
  RefreshCw,
  SkipForward,
  type LucideIcon,
} from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useColors, type Colors } from '@/lib/theme';

import type { RunStatus } from '../../schedules.api';

type Look = { icon: LucideIcon; fg: string; bg: string };

export function statusLook(status: RunStatus, c: Colors): Look {
  switch (status) {
    case 'running':
      return { icon: RefreshCw, fg: c.primary, bg: c.primaryBg };
    case 'awaiting_approval':
      return { icon: Hand, fg: c.warning, bg: c.warningBg };
    case 'completed':
      return { icon: CircleCheck, fg: c.success, bg: c.successBg };
    case 'failed':
      return { icon: CircleX, fg: c.danger, bg: c.dangerBg };
    case 'skipped':
      return { icon: SkipForward, fg: c.muted, bg: c.inputBg };
    default:
      return { icon: Ban, fg: c.muted, bg: c.inputBg };
  }
}

/** Run status pill; with `onPress` it shows a chevron (e.g. "Needs approval" → chat). */
export function StatusChip({ status, onPress }: { status: RunStatus; onPress?: () => void }) {
  const c = useColors();
  const { t } = useTranslation();
  const look = statusLook(status, c);
  const label = t(`schedules.status.${status}`);
  const Icon = look.icon;
  const body = (
    <View style={[styles.chip, { backgroundColor: look.bg }]}>
      <Icon size={14} color={look.fg} />
      <Text style={[styles.text, { color: look.fg }]} numberOfLines={1}>
        {label}
      </Text>
      {onPress ? <ChevronRight size={13} color={look.fg} /> : null}
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
