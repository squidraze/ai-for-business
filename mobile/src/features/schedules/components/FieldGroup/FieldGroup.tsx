import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useColors } from '@/lib/theme';

/** Label + a non-text control (pickers, chips) + its inline error / hint. */
export function FieldGroup({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null;
  hint?: string;
  children: ReactNode;
}) {
  const c = useColors();
  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: error ? c.danger : c.muted }]}>{label}</Text>
      {children}
      {error ? (
        <Text style={[styles.below, { color: c.danger }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text style={[styles.below, { color: c.muted }]}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: { fontSize: 13, marginBottom: 8, fontWeight: '500' },
  below: { fontSize: 13, marginTop: 6 },
});
