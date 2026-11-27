import { View } from 'react-native';

import { DIVIDER_FILL } from '@/lib/screen';

/** Hairline between list rows, optionally indented past an avatar. */
export function RowDivider({ inset = 0 }: { inset?: number }) {
  return <View className={`h-px ${DIVIDER_FILL}`} style={{ marginLeft: inset }} />;
}
