import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from '@/lib/theme';

/** A pill toggle / suggestion: selected chips are filled with the primary color. */
export function Chip({
  label,
  selected = false,
  onPress,
  icon: Icon,
  disabled,
  invalid,
  style,
  accessibilityRole = 'button',
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  /** Red border (the group has a validation error). */
  invalid?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityRole?: 'button' | 'checkbox' | 'radio';
}) {
  const c = useColors();
  const fg = selected ? c.primaryText : c.text;
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={label}
      accessibilityState={{ selected, checked: accessibilityRole === 'button' ? undefined : selected, disabled }}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? c.primary : c.inputBg,
          borderColor: invalid ? c.danger : selected ? c.primary : c.border,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      {Icon ? <Icon size={15} color={selected ? fg : c.primary} style={styles.icon} /> : null}
      <Text style={[styles.text, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
  },
  icon: { marginRight: 6 },
  text: { fontSize: 14, fontWeight: '500', flexShrink: 1 },
});
