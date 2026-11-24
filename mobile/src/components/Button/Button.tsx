import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useColors } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerSolid' | 'ghost';

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  icon,
  style,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: ButtonVariant;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const c = useColors();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.primaryText },
    secondary: { bg: c.inputBg, fg: c.text },
    danger: { bg: 'transparent', fg: c.danger, border: c.danger },
    dangerSolid: { bg: c.danger, fg: '#ffffff' },
    ghost: { bg: 'transparent', fg: c.primary },
  };
  const { bg, fg, border } = palette[variant];
  const inactive = !!disabled || !!loading;
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      style={[
        styles.button,
        { backgroundColor: bg, opacity: disabled && !loading ? 0.5 : 1 },
        border ? { borderWidth: 1, borderColor: border } : null,
        style,
      ]}
    >
      {/* Keep the label laid out while loading so the button doesn't change size. */}
      <View style={[styles.row, loading && styles.hidden]}>
        {icon ? <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 8 }} /> : null}
        <Text style={[styles.text, { color: fg }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
      {loading ? <ActivityIndicator color={fg} style={StyleSheet.absoluteFill} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  hidden: { opacity: 0 },
  text: { fontSize: 16, fontWeight: '600' },
});
