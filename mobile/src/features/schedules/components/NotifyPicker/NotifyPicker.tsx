import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useColors } from '@/lib/theme';

import type { ScheduleNotify } from '../../schedules.api';

const OPTIONS: ScheduleNotify[] = ['approval', 'always', 'never'];

/** When to send a push about a run: radio list with a short explanation each. */
export function NotifyPicker({
  value,
  onChange,
  disabled,
}: {
  value: ScheduleNotify;
  onChange: (value: ScheduleNotify) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const { t } = useTranslation();
  return (
    <View
      style={[styles.box, { backgroundColor: c.card, borderColor: c.border }]}
      accessibilityRole="radiogroup"
    >
      {OPTIONS.map((option, index) => {
        const selected = option === value;
        return (
          <TouchableOpacity
            key={option}
            activeOpacity={0.7}
            disabled={disabled}
            onPress={() => onChange(option)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            accessibilityLabel={t(`schedules.notify.${option}`)}
            style={[
              styles.row,
              index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border },
            ]}
          >
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={22}
              color={selected ? c.primary : c.muted}
            />
            <View style={styles.texts}>
              <Text style={[styles.title, { color: c.text }]}>{t(`schedules.notify.${option}`)}</Text>
              <Text style={[styles.hint, { color: c.muted }]}>{t(`schedules.notify.${option}Hint`)}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  texts: { flex: 1 },
  title: { fontSize: 15, fontWeight: '500' },
  hint: { fontSize: 13, marginTop: 2 },
});
