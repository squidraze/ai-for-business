import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { useColors } from '@/lib/theme';

/** Banner for errors that don't belong to a single field. */
export function FormError({ message }: { message: string | null | undefined }) {
  const c = useColors();
  if (!message) return null;
  return (
    <View
      style={[styles.banner, { backgroundColor: c.dangerBg, borderColor: c.danger }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Ionicons name="alert-circle" size={18} color={c.danger} />
      <Text style={[styles.text, { color: c.danger }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginBottom: 14,
  },
  text: { flex: 1, fontSize: 14, marginLeft: 8, lineHeight: 19 },
});
