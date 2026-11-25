import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, StyleSheet, Text, TouchableOpacity } from 'react-native';

import { STATE_FADE_MS } from '@/lib/config';
import { useColors } from '@/lib/theme';

/**
 * A refetch failed but older data is still on screen: say so (instead of
 * silently showing stale data) and let the user retry with one tap.
 */
export function StaleDataBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  const c = useColors();
  const { t } = useTranslation();
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, { toValue: 1, duration: STATE_FADE_MS, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View style={[styles.wrap, { opacity }]} accessibilityLiveRegion="polite">
      <TouchableOpacity
        onPress={onRetry}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`${t('states.refreshFailed')} ${t('common.retry')}`}
        style={[styles.banner, { backgroundColor: c.card, borderColor: c.danger }]}
      >
        <Ionicons name="cloud-offline-outline" size={18} color={c.danger} />
        <Text style={[styles.text, { color: c.text }]} numberOfLines={2}>
          {t('states.refreshFailed')} <Text style={{ color: c.muted }}>{message}</Text>
        </Text>
        <Text style={[styles.retry, { color: c.primary }]}>{t('common.retry')}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // in the layout flow (content moves down), opaque: never drawn over the data
  wrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  text: { flex: 1, fontSize: 14 },
  retry: { fontSize: 14, fontWeight: '600' },
});
