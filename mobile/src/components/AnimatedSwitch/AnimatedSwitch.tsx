import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { SWITCH_TOGGLE_MS } from '@/lib/config';
import { useColors } from '@/lib/theme';

// iOS system switch colours; the off track has a dark-mode pair.
const TRACK_COLORS = {
  light: { on: '#34C759', off: '#E9E9EA' },
  dark: { on: '#30D158', off: '#39393D' },
} as const;

type AnimatedSwitchProps = {
  /** Current on/off state. */
  value: boolean;
  /** Called with the next value when the switch is pressed. */
  onValueChange: (value: boolean) => void;
  /** Track colours for the off / on states. Defaults to the iOS pair for the running theme. */
  trackColors?: { on: string; off: string };
  /** Thumb colour. */
  thumbColor?: string;
  /** Animation duration in ms. Defaults to EXPO_PUBLIC_SWITCH_TOGGLE_MS. */
  duration?: number;
  /** Greys out and blocks interaction. */
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * iOS-style animated toggle built with Reanimated, following the official
 * react-native-reanimated Switch example. The track and thumb are measured at
 * layout time so the maths fit any size, the track cross-fades between colours
 * and the thumb slides on the UI thread — no JS-thread animation lag.
 *
 * @see https://docs.swmansion.com/react-native-reanimated/examples/switch/
 */
export function AnimatedSwitch({
  value,
  onValueChange,
  trackColors: trackColorsProp,
  thumbColor = '#FFFFFF',
  duration = SWITCH_TOGGLE_MS,
  disabled = false,
  style,
}: AnimatedSwitchProps) {
  const { scheme } = useColors();
  const trackColors = trackColorsProp ?? TRACK_COLORS[scheme];
  // Captured from onLayout so the geometry adapts to whatever size the track
  // is given via `style`, instead of being hard-coded.
  const height = useSharedValue(0);
  const width = useSharedValue(0);

  const trackAnimatedStyle = useAnimatedStyle(() => {
    const color = interpolateColor(Number(value), [0, 1], [trackColors.off, trackColors.on]);
    return {
      backgroundColor: withTiming(color, { duration }),
      borderRadius: height.value / 2,
    };
  });

  const thumbAnimatedStyle = useAnimatedStyle(() => {
    // Travel = inner track width minus thumb diameter, which reduces to
    // (width - height) once the equal top/bottom padding cancels out.
    const moveValue = interpolate(Number(value), [0, 1], [0, width.value - height.value]);
    return {
      transform: [{ translateX: withTiming(moveValue, { duration }) }],
      borderRadius: height.value / 2,
    };
  });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={() => onValueChange(!value)}
      style={disabled ? styles.disabled : undefined}
    >
      <Animated.View
        onLayout={(e) => {
          height.value = e.nativeEvent.layout.height;
          width.value = e.nativeEvent.layout.width;
        }}
        style={[styles.track, style, trackAnimatedStyle]}
      >
        <Animated.View
          style={[styles.thumb, { backgroundColor: thumbColor }, thumbAnimatedStyle]}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 52,
    height: 32,
    padding: 2,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  thumb: {
    height: '100%',
    aspectRatio: 1,
    // Subtle elevation so the thumb reads as floating above the track.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  disabled: {
    opacity: 0.5,
  },
});
