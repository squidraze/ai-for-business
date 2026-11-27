import { useIsFocused } from 'expo-router';
import { useEffect, type ReactNode } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { SCREEN_FADE_MS } from '@/lib/config';

const EASING = Easing.bezier(0.25, 0.46, 0.45, 0.94);

/**
 * Fades a tab's content in whenever the tab gains focus (ported from rooler
 * business `TabFade`). Used instead of the tabs navigator's `animation: 'fade'`,
 * which renders blank with Fabric + react-native-screens + reanimated: the
 * native container animates but leaves the content detached. Driving opacity on
 * a plain reanimated view sidesteps native screens.
 *
 * The tab must not be frozen on blur (`freezeOnBlur: false`), or the reset to 0
 * never runs and the tab stops fading after the first visit.
 */
export function TabFade({ children }: { children: ReactNode }) {
  const isFocused = useIsFocused();
  // Start invisible so the very first focus fades in too.
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (isFocused) {
      opacity.value = withTiming(1, { duration: SCREEN_FADE_MS, easing: EASING });
    } else {
      // Reset instantly while off-screen so the next focus fades from 0 again.
      opacity.value = 0;
    }
  }, [isFocused, opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[{ flex: 1 }, style]}>{children}</Animated.View>;
}
