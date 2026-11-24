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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
  View,
} from 'react-native';

/** Space kept between the keyboard and the target (submit button). */
const KEYBOARD_GAP = 16;

type ViewHandle = ComponentRef<typeof View>;
type TargetRef = { current: ViewHandle | null };
const KeyboardTargetContext = createContext<((ref: TargetRef | null) => void) | null>(null);

/**
 * Wrap the form's submit button: when the keyboard opens, the form scrolls so
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

/**
 * A keyboard-aware scrolling form: avoids the keyboard and keeps the
 * `KeyboardTarget` inside it visible above the keyboard (also when errors
 * appear under fields and push it down).
 */
export function KeyboardAwareForm({
  header,
  contentContainerStyle,
  keyboardVerticalOffset = 0,
  style,
  children,
}: {
  /** Rendered above the scroll view, inside the keyboard-avoiding area. */
  header?: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  /** Height of anything above this view (e.g. a navigation header) on iOS. */
  keyboardVerticalOffset?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={keyboardVerticalOffset}
        style={[{ flex: 1 }, style]}
      >
        {header}
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={contentContainerStyle}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScroll={onScroll}
          scrollEventThrottle={32}
          // Errors appearing under fields push the button down: keep it above the keyboard.
          onContentSizeChange={() => {
            if (Keyboard.isVisible()) revealTarget();
          }}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </KeyboardTargetContext.Provider>
  );
}
