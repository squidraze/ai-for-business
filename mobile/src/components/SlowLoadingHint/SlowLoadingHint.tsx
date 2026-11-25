import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, Text } from 'react-native';

import { SLOW_LOADING_MS, STATE_FADE_MS } from '@/lib/config';
import { useColors } from '@/lib/theme';

/**
 * Shown over a loading skeleton once it has been on screen for SLOW_LOADING_MS:
 * the user learns the app is still trying (the request then ends in an error
 * with Retry at the latest after API_TIMEOUT_MS).
 */
export function SlowLoadingHint() {
  const c = useColors();
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), SLOW_LOADING_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const animation = Animated.timing(opacity, { toValue: 1, duration: STATE_FADE_MS, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [visible, opacity]);

  if (!visible) return null;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[styles.wrap, { opacity, backgroundColor: c.card, borderColor: c.border }]}
    >
      <Text style={[styles.text, { color: c.muted }]}>{t('states.slow')}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 32,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  text: { fontSize: 14, textAlign: 'center' },
});
