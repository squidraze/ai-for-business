import { StyleSheet, View } from 'react-native';

import { useColors } from '@/lib/theme';

/** Hairline divider between rows; `inset` indents it from the left. */
export function Separator({ inset = 0 }: { inset?: number }) {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: inset }} />;
}
