import { Image, StyleSheet, Text, View } from 'react-native';

import { initials } from '@/lib/format';

const AVATAR_COLORS = ['#e57373', '#f06292', '#ba68c8', '#7986cb', '#4fc3f7', '#4db6ac', '#81c784', '#ffb74d'];

export interface AvatarProps {
  /** Initials are taken from it; null-safe. */
  name?: string | null;
  size?: number;
  /** Photo drawn over the initials once it loads. */
  uri?: string | null;
  /** Request headers for the photo (e.g. the Bearer token). */
  headers?: Record<string, string>;
  /** Stable key for the background colour (defaults to the name). */
  seed?: string | null;
}

/** A round avatar: coloured initials, with an optional photo on top. */
export function Avatar({ name, size = 48, uri, headers, seed }: AvatarProps) {
  const key = seed ?? name ?? '';
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

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
