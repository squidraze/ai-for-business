import { useTranslation } from 'react-i18next';

import { SegmentedControl } from '@/components/SegmentedControl';

import type { ScheduleKind } from '../../schedules.api';

const KINDS: ScheduleKind[] = ['daily', 'weekly', 'interval'];

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
  return (
    <SegmentedControl
      options={KINDS.map((kind) => ({ value: kind, label: t(`schedules.kinds.${kind}`) }))}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
