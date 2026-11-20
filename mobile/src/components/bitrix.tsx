import { StyleSheet, Text, View } from 'react-native';

import { useColors } from '@/lib/theme';

/** A deal stage or a lead status: a small brand-tinted pill. */
export function StagePill({ label }: { label?: string | null }) {
  const c = useColors();
  if (!label) return null;
  return (
    <View style={[styles.pill, { backgroundColor: `${c.primary}26` }]}>
      <Text style={[styles.text, { color: c.primary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    maxWidth: 200,
  },
  text: { fontSize: 12, fontWeight: '600' },
});
