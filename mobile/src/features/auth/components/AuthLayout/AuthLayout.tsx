import { Ionicons } from '@expo/vector-icons';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ComponentRef,
  type ReactNode,
} from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColors } from '@/lib/theme';

/** Space kept between the keyboard and the submit button. */
const KEYBOARD_GAP = 16;

type ViewHandle = ComponentRef<typeof View>;
type TargetRef = { current: ViewHandle | null };
const KeyboardTargetContext = createContext<((ref: TargetRef | null) => void) | null>(null);

/**
 * Wrap the form's submit button: when the keyboard opens, the layout scrolls so
 * this stays visible above it. (Android 15+ draws edge-to-edge, so
 * `adjustResize` no longer shrinks the window — we have to do it ourselves.)
 */
export function KeyboardTarget({ children }: { children: ReactNode }) {
  const register = useContext(KeyboardTargetContext);
  const ref = useRef<ViewHandle>(null);
  useEffect(() => {
    register?.(ref);
    return () => register?.(null);
  }, [register]);
  return (
    <View ref={ref} collapsable={false}>
      {children}
    </View>
  );
}

/** Logo, title and a keyboard-aware scroll for every auth screen. */
export function AuthLayout({
  title,
  subtitle,
  onBack,
  backLabel,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Shows a back arrow in the top-left corner. */
  onBack?: () => void;
  backLabel?: string;
  /** Pinned under the form (links, server info). */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const c = useColors();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollY = useRef(0);
  const target = useRef<TargetRef | null>(null);
  const register = useCallback((ref: TargetRef | null) => {
    target.current = ref;
  }, []);

  const revealTarget = useCallback(() => {
    const node = target.current?.current;
    const keyboardTop = Keyboard.metrics()?.screenY;
    if (!node || !keyboardTop) return;
    node.measureInWindow((_x, y, _w, height) => {
      const overlap = y + height + KEYBOARD_GAP - keyboardTop;
      if (overlap > 0) {
        scrollRef.current?.scrollTo({ y: scrollY.current + overlap, animated: true });
      }
    });
  }, []);

  useEffect(() => {
    // Wait a frame or two for KeyboardAvoidingView to apply its padding first.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(revealTarget, 120);
    };
    const show = Keyboard.addListener('keyboardDidShow', schedule);
    // Focus moving between fields while the keyboard stays open.
    const change = Keyboard.addListener('keyboardDidChangeFrame', schedule);
    return () => {
      clearTimeout(timer);
      show.remove();
      change.remove();
    };
  }, [revealTarget]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = e.nativeEvent.contentOffset.y;
  };

  return (
    <KeyboardTargetContext.Provider value={register}>
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          {onBack ? (
            <View style={styles.header}>
              <TouchableOpacity
                onPress={onBack}
                hitSlop={10}
                style={styles.back}
                accessibilityRole="button"
                accessibilityLabel={backLabel}
              >
                <Ionicons name="chevron-back" size={26} color={c.text} />
              </TouchableOpacity>
            </View>
          ) : null}
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[styles.container, onBack ? styles.containerWithHeader : null]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScroll={onScroll}
            scrollEventThrottle={32}
            // Errors appearing under fields push the button down: keep it above the keyboard.
            onContentSizeChange={() => {
              if (Keyboard.isVisible()) revealTarget();
            }}
          >
            <View style={[styles.logo, { backgroundColor: c.primary }]}>
              <Ionicons name="sparkles" size={30} color="#fff" />
            </View>
            <Text style={[styles.title, { color: c.text }]} accessibilityRole="header">
              {title}
            </Text>
            {subtitle ? <Text style={[styles.subtitle, { color: c.muted }]}>{subtitle}</Text> : null}
            <View style={styles.body}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </KeyboardTargetContext.Provider>
  );
}

const styles = StyleSheet.create({
  header: { height: 48, justifyContent: 'center', paddingHorizontal: 12 },
  back: { padding: 4, alignSelf: 'flex-start' },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 56 },
  containerWithHeader: { paddingTop: 8 },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 26, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 15, textAlign: 'center', marginTop: 6, lineHeight: 21 },
  body: { marginTop: 28 },
  footer: { marginTop: 24, gap: 14 },
});
