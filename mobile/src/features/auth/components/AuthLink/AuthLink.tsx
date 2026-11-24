import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useColors } from '@/lib/theme';

/** "Question? Action" row, or a lone text link when `prompt` is omitted. */
export function AuthLink({
  prompt,
  action,
  onPress,
  disabled,
  align = 'center',
}: {
  prompt?: string;
  action: string;
  onPress: () => void;
  disabled?: boolean;
  align?: 'center' | 'right';
}) {
  const c = useColors();
  return (
    <View style={[styles.row, { justifyContent: align === 'right' ? 'flex-end' : 'center' }]}>
      {prompt ? <Text style={[styles.prompt, { color: c.muted }]}>{prompt} </Text> : null}
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        hitSlop={8}
        accessibilityRole="link"
        accessibilityState={{ disabled: !!disabled }}
      >
        <Text style={[styles.action, { color: disabled ? c.muted : c.primary }]}>{action}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  prompt: { fontSize: 15 },
  action: { fontSize: 15, fontWeight: '600' },
});
