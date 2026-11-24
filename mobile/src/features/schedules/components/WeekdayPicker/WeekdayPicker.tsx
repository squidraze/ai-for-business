import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Chip } from '@/components/Chip';

import { WEEKDAY_KEYS, weekdayShort } from '../../recurrence';

/** Mon…Sun multi-select; values are 0 = Monday … 6 = Sunday. */
export function WeekdayPicker({
  value,
  onChange,
  invalid,
  disabled,
}: {
  value: number[];
  onChange: (days: number[]) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const toggle = (day: number) =>
    onChange(
      value.includes(day) ? value.filter((item) => item !== day) : [...value, day].sort((a, b) => a - b),
    );
  return (
    <View style={styles.row}>
      {WEEKDAY_KEYS.map((key, day) => (
        <Chip
          key={key}
          label={weekdayShort(day, t)}
          selected={value.includes(day)}
          onPress={() => toggle(day)}
          invalid={invalid}
          disabled={disabled}
          accessibilityRole="checkbox"
          style={styles.chip}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minWidth: 52, justifyContent: 'center', paddingHorizontal: 10 },
});
