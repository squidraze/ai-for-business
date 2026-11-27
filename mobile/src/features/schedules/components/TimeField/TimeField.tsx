import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { ChevronDown, ChevronUp, Clock } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useColors } from '@/lib/theme';

import { hhmm } from '../../recurrence';

/** "HH:MM" → a Date today at that time (for the picker). */
function toDate(value: string): Date {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10));
  const date = new Date();
  date.setHours(Number.isFinite(hours) ? hours : 9, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return date;
}

/**
 * A pressable field showing "HH:MM". Android opens the system time dialog;
 * iOS shows a spinner under the field.
 */
export function TimeField({
  value,
  onChange,
  invalid,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const c = useColors();
  const { t } = useTranslation();
  const [iosOpen, setIosOpen] = useState(false);

  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: toDate(value),
        mode: 'time',
        is24Hour: true,
        onValueChange: (_event, date) => onChange(hhmm(date)),
      });
    } else {
      setIosOpen((prev) => !prev);
    }
  };

  return (
    <View>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={open}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t('schedules.fields.time')}
        accessibilityValue={{ text: value }}
        accessibilityHint={t('schedules.changeTime')}
        style={[
          styles.field,
          {
            backgroundColor: c.inputBg,
            borderColor: invalid ? c.danger : iosOpen ? c.primary : c.border,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        <Clock size={20} color={c.primary} />
        <Text style={[styles.value, { color: value ? c.text : c.muted }]}>{value || '--:--'}</Text>
        {iosOpen ? <ChevronUp size={18} color={c.muted} /> : <ChevronDown size={18} color={c.muted} />}
      </TouchableOpacity>
      {Platform.OS === 'ios' && iosOpen ? (
        <DateTimePicker
          value={toDate(value)}
          mode="time"
          display="spinner"
          onValueChange={(_event, date) => onChange(hhmm(date))}
          textColor={c.text}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    gap: 10,
  },
  value: { flex: 1, fontSize: 18, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
