import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/Chip';

import { formatInterval } from '../../recurrence';
import { INTERVAL_HOURS } from '../../validation';

/** Interval choices in hours; the value is in minutes (as the API wants). */
export function IntervalPicker({
  value,
  onChange,
  invalid,
  disabled,
}: {
  value: number;
  onChange: (minutes: number) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const options: number[] = INTERVAL_HOURS.map((hours) => hours * 60);
  // A task created elsewhere (e.g. by the assistant) may use another interval: keep it visible.
  if (!options.includes(value)) options.push(value);
  options.sort((a, b) => a - b);
  return (
    <View style={styles.row}>
      {options.map((minutes) => (
        <Chip
          key={minutes}
          label={
            minutes % 60 === 0
              ? t('schedules.intervalHours', { count: minutes / 60 })
              : formatInterval(minutes, t)
          }
          selected={minutes === value}
          onPress={() => onChange(minutes)}
          invalid={invalid}
          disabled={disabled}
          accessibilityRole="radio"
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
