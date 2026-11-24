import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  type DimensionValue,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { SKELETON_SHIMMER_MS } from '@/lib/config';
import { useColors } from '@/lib/theme';

type SkeletonProps = {
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * A placeholder block with a moving highlight. Every block starts its loop on
 * mount, so blocks that mount together shimmer in sync.
 */
export function Skeleton({ width = '100%', height = 12, radius = 6, style }: SkeletonProps) {
  const c = useColors();
  const [blockWidth, setBlockWidth] = useState(0);
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: SKELETON_SHIMMER_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const onLayout = (event: LayoutChangeEvent) => setBlockWidth(event.nativeEvent.layout.width);
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-blockWidth, blockWidth],
  });

  return (
    <View
      onLayout={onLayout}
      style={[
        { width, height, borderRadius: radius, backgroundColor: c.skeleton, overflow: 'hidden' },
        style,
      ]}
    >
      {blockWidth > 0 ? (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX }] }]}>
          <LinearGradient
            colors={['transparent', c.skeletonHighlight, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Placeholder rows mirroring a list of (optional) avatar + two lines. */
export function SkeletonList({ count = 8, avatar = true }: { count?: number; avatar?: boolean }) {
  return (
    <View style={styles.list} accessibilityRole="progressbar" accessibilityState={{ busy: true }}>
      {Array.from({ length: count }).map((_, index) => (
        <View key={index} style={styles.row}>
          {avatar ? <Skeleton width={48} height={48} radius={24} style={styles.avatar} /> : null}
          <View style={{ flex: 1 }}>
            <Skeleton width="55%" />
            <Skeleton width="85%" style={{ marginTop: 8 }} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Full-screen placeholder for the app start (auth check): logo + list rows. */
export function SplashSkeleton({ logo }: { logo?: ReactNode }) {
  const c = useColors();
  return (
    <View style={[styles.splash, { backgroundColor: c.bg }]}>
      <View style={styles.splashHeader}>
        {logo}
        <Skeleton width={160} height={20} radius={8} style={{ marginTop: 16 }} />
        <Skeleton width={220} height={12} style={{ marginTop: 10 }} />
      </View>
      <SkeletonList count={5} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  avatar: { marginRight: 12 },
  splash: { flex: 1, paddingTop: 96 },
  splashHeader: { alignItems: 'center', marginBottom: 24 },
});
