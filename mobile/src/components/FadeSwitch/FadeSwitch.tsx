import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { STATE_FADE_MS } from '@/lib/config';

type Layer = { key: string; node: ReactNode };

/**
 * Cross-fades whenever `stateKey` changes: the previous children stay on top
 * and fade out while the new ones fade in. Children of the same key update in
 * place (no animation).
 */
export function FadeSwitch({
  stateKey,
  children,
  duration = STATE_FADE_MS,
  appear = false,
  style,
}: {
  stateKey: string;
  children: ReactNode;
  duration?: number;
  /** Fade the first children in on mount too. */
  appear?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [shownKey, setShownKey] = useState(stateKey);
  const [outgoing, setOutgoing] = useState<Layer | null>(null);
  const lastChildren = useRef<ReactNode>(children);
  const incomingOpacity = useRef(new Animated.Value(appear ? 0 : 1)).current;
  const outgoingOpacity = useRef(new Animated.Value(0)).current;
  const mounted = useRef(false);

  // Key changed: keep a snapshot of what was on screen and swap (derived state).
  if (stateKey !== shownKey) {
    setOutgoing({ key: shownKey, node: lastChildren.current });
    setShownKey(stateKey);
  }

  useEffect(() => {
    lastChildren.current = children;
  });

  useLayoutEffect(() => {
    const first = !mounted.current;
    mounted.current = true;
    if (first && !appear) return;
    incomingOpacity.setValue(0);
    outgoingOpacity.setValue(1);
    const animation = Animated.parallel([
      Animated.timing(incomingOpacity, { toValue: 1, duration, useNativeDriver: true }),
      Animated.timing(outgoingOpacity, { toValue: 0, duration, useNativeDriver: true }),
    ]);
    animation.start(({ finished }) => {
      if (finished) setOutgoing(null);
    });
    return () => animation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);

  return (
    <View style={[styles.container, style]}>
      <Animated.View key={`in-${shownKey}`} style={[styles.layer, { opacity: incomingOpacity }]}>
        {children}
      </Animated.View>
      {outgoing && outgoing.key !== shownKey ? (
        <Animated.View
          key={`out-${outgoing.key}`}
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { opacity: outgoingOpacity }]}
        >
          {outgoing.node}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  layer: { flex: 1 },
});
