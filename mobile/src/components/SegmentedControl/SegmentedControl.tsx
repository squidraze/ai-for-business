import { StyleSheet, Text, TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from '@/lib/theme';

export type SegmentOption<T extends string> = { value: T; label: string };

/** A row of mutually exclusive options (like iOS UISegmentedControl). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  disabled,
  style,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <View
      style={[styles.track, { backgroundColor: c.inputBg, borderColor: c.border }, style]}
      accessibilityRole="radiogroup"
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <TouchableOpacity
            key={option.value}
            activeOpacity={0.7}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected, disabled }}
            style={[styles.segment, selected && { backgroundColor: c.card }, selected && styles.selected]}
          >
            <Text
              style={[styles.text, { color: selected ? c.text : c.muted }, selected && styles.textSelected]}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
  },
  segment: {
    flex: 1,
    height: 38,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  selected: {
    elevation: 1,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  text: { fontSize: 14, fontWeight: '500' },
  textSelected: { fontWeight: '600' },
});
