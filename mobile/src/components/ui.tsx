import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';

import { initials } from '@/lib/format';
import { useColors } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const bg = variant === 'primary' ? c.primary : variant === 'danger' ? 'transparent' : c.inputBg;
  const fg = variant === 'primary' ? c.primaryText : variant === 'danger' ? c.danger : c.text;
  const inactive = disabled || loading;
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      disabled={inactive}
      style={[
        styles.button,
        { backgroundColor: bg, opacity: inactive ? 0.6 : 1 },
        variant === 'danger' && { borderWidth: 1, borderColor: c.danger },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 8 }} /> : null}
          <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

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

export function CenterView({ children }: { children: ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

export function LoadingView() {
  const c = useColors();
  return (
    <CenterView>
      <ActivityIndicator color={c.primary} size="large" />
    </CenterView>
  );
}

/** Placeholder rows mirroring a list of avatar + two lines. */
export function ListSkeleton({ count = 8, avatar = true }: { count?: number; avatar?: boolean }) {
  const c = useColors();
  return (
    <View style={{ paddingTop: 8 }}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={[styles.skeletonRow]}>
          {avatar ? <View style={[styles.skeletonAvatar, { backgroundColor: c.skeleton }]} /> : null}
          <View style={{ flex: 1 }}>
            <View style={[styles.skeletonLine, { width: '55%', backgroundColor: c.skeleton }]} />
            <View style={[styles.skeletonLine, { width: '85%', backgroundColor: c.skeleton, marginTop: 8 }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export function ErrorView({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const c = useColors();
  return (
    <CenterView>
      <Ionicons name="cloud-offline-outline" size={44} color={c.muted} />
      <Text style={[styles.stateTitle, { color: c.text }]}>Couldn't load</Text>
      <Text style={[styles.stateText, { color: c.muted }]}>{message}</Text>
      {onRetry ? <Button title="Retry" onPress={onRetry} style={{ marginTop: 16, minWidth: 140 }} /> : null}
    </CenterView>
  );
}

export function EmptyView({
  icon,
  title,
  description,
  children,
}: {
  icon: IconName;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  const c = useColors();
  return (
    <CenterView>
      <Ionicons name={icon} size={44} color={c.muted} />
      <Text style={[styles.stateTitle, { color: c.text }]}>{title}</Text>
      {description ? <Text style={[styles.stateText, { color: c.muted }]}>{description}</Text> : null}
      {children}
    </CenterView>
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
  row: { flexDirection: 'row', alignItems: 'center' },
  button: {
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  buttonText: { fontSize: 16, fontWeight: '600' },
  label: { fontSize: 13, marginBottom: 6, fontWeight: '500' },
  input: { height: 48, borderRadius: 12, paddingHorizontal: 14, fontSize: 16 },
  card: { borderRadius: 16, padding: 16, borderWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  stateTitle: { fontSize: 17, fontWeight: '600', marginTop: 12 },
  stateText: { fontSize: 14, marginTop: 6, textAlign: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  skeletonAvatar: { width: 48, height: 48, borderRadius: 24, marginRight: 12 },
  skeletonLine: { height: 12, borderRadius: 6 },
});
