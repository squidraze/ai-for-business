import type { ReactNode } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { initials } from '@/lib/format';
import { useColors } from '@/lib/theme';

// Moved into their own component folders; re-exported so existing screens keep working.
export { AsyncState } from './AsyncState';
export { Button, type IconName } from './Button';
export { FadeSwitch } from './FadeSwitch';
export { Skeleton, SkeletonList, SkeletonList as ListSkeleton, SplashSkeleton } from './Skeleton';
export { CenterView, EmptyView, ErrorView, LoadingView } from './StateView';

export function Field(props: TextInputProps & { label?: string }) {
  const c = useColors();
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginBottom: 12 }}>
      {label ? <Text style={[styles.label, { color: c.muted }]}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.muted}
        {...rest}
        style={[styles.input, { backgroundColor: c.inputBg, color: c.text }, style]}
      />
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = useColors();
  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, style]}>{children}</View>
  );
}

const AVATAR_COLORS = ['#e57373', '#f06292', '#ba68c8', '#7986cb', '#4fc3f7', '#4db6ac', '#81c784', '#ffb74d'];

export function Avatar({
  name,
  size = 48,
  uri,
  headers,
  seed,
}: {
  name: string;
  size?: number;
  uri?: string | null;
  headers?: Record<string, string>;
  seed?: string;
}) {
  const key = seed ?? name;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  const bg = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  const round = { width: size, height: size, borderRadius: size / 2 };
  return (
    <View style={[round, styles.avatar, { backgroundColor: bg }]}>
      <Text style={{ color: '#fff', fontWeight: '600', fontSize: size * 0.38 }}>{initials(name)}</Text>
      {uri ? <Image source={{ uri, headers }} style={[round, StyleSheet.absoluteFill]} /> : null}
    </View>
  );
}

export function Separator({ inset = 0 }: { inset?: number }) {
  const c = useColors();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: c.border, marginLeft: inset }} />;
}

const styles = StyleSheet.create({
  label: { fontSize: 13, marginBottom: 6, fontWeight: '500' },
  input: { height: 48, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  card: { borderRadius: 16, padding: 16, borderWidth: StyleSheet.hairlineWidth },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
