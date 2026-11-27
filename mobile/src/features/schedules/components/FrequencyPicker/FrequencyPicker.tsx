import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { SegmentedSwitch } from '@/components/SegmentedSwitch';

import type { ScheduleKind } from '../../schedules.api';

const KINDS: ScheduleKind[] = ['daily', 'weekly', 'interval'];

/** Daily / weekly / interval — a value, so `SegmentedSwitch` (see CLAUDE.md). */
export function FrequencyPicker({
  value,
  onChange,
  disabled,
}: {
  value: ScheduleKind;
  onChange: (kind: ScheduleKind) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const items = useMemo(
    () => KINDS.map((kind) => ({ value: kind, label: t(`schedules.kinds.${kind}`) })),
    [t],
  );
  return (
    // SegmentedSwitch has no disabled state: block touches and dim while busy.
    <View pointerEvents={disabled ? 'none' : 'auto'} style={disabled ? { opacity: 0.5 } : undefined}>
      <SegmentedSwitch items={items} value={value} onChange={onChange} />
    </View>
  );
}
