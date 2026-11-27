import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { Dimensions, Keyboard, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  type GestureType,
} from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { SHEET_CLOSE_MS, SHEET_OPEN_MS } from '@/lib/config';
import { useColors } from '@/lib/theme';

const SCREEN_HEIGHT = Dimensions.get('window').height;
// Drag distance / fling velocity past which the sheet closes.
const CLOSE_DISTANCE = 120;
const CLOSE_VELOCITY = 800;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * Lets a scrollable child cooperate with the sheet's pan-to-close gesture.
 * The pan grabs every vertical drag, so a bare RN `ScrollView` placed inside the
 * sheet never scrolls. A child builds its own native-scroll gesture that runs
 * *simultaneously* with the pan (so the pan no longer blocks it) and reports its
 * scroll offset (so the sheet only drags-to-close when at the top).
 *
 * The pan is shared as the **gesture object**, not as a ref. RNGH resolves a
 * relation to a handler tag by reading either `gesture.handlerTag` or
 * `ref.current.handlerTag`, and the ref form is unreliable here: the gesture
 * config is handed to the UI runtime, which converts it to a serializable, so
 * RNGH's later `config.ref.current = this` write is dropped with a
 * "Tried to modify key `current` of an object which has been already passed to a
 * worklet" warning. The tag then resolves to -1, `simultaneousHandlers` comes out
 * empty, and the pan cancels the scroll the moment it activates — the list
 * receives the drag (`onScrollBeginDrag` fires) and then goes nowhere.
 *
 * The gesture object is memoized below and never re-created, so children that
 * mount later still resolve a live tag (RNGH re-runs the relation on mount via
 * its own mount registry).
 */
interface SheetScrollContextValue {
  scrollOffset: SharedValue<number>;
  panGesture: GestureType;
}

const SheetScrollContext = createContext<SheetScrollContextValue | null>(null);

/**
 * Hook for a scrollable child of `SwipeableBottomSheet`. Spread the returned
 * props onto an `Animated.ScrollView`/`Animated.FlatList` and wrap it in a
 * `<GestureDetector gesture={gesture}>` so it scrolls while the sheet stays
 * swipe-to-close.
 */
export const useSheetScrollView = () => {
  const ctx = useContext(SheetScrollContext);
  const onScroll = useAnimatedScrollHandler((event) => {
    if (ctx) ctx.scrollOffset.value = event.contentOffset.y;
  });
  const gesture = useMemo(
    () => (ctx ? Gesture.Native().simultaneousWithExternalGesture(ctx.panGesture) : null),
    [ctx],
  );
  // `bounces: false` is required, not cosmetic. The scroll and the sheet's
  // pan-to-close run *simultaneously*, so on iOS a downward drag at the top would
  // otherwise bounce/overscroll the content (offset goes negative) at the same
  // time the pan drags the sheet down — the content and the sheet appear to move
  // together. Disabling the bounce keeps the offset pinned at 0 so only the sheet
  // moves, and lets `scrollOffset` cleanly report the top. Spread it onto the
  // scroller alongside `onScroll`/`scrollEventThrottle`.
  //
  // `scrollOffset` (null outside a sheet) is the sheet's single live offset,
  // written by whichever scroller scrolled last. The sheet only drags-to-close
  // at <= 0 — so a host that swaps between several scrollers (pager tabs
  // inside a sheet) must re-report the active one's offset on switch, or a
  // hidden tab's stale offset keeps swipe-to-close dead.
  return {
    onScroll,
    scrollEventThrottle: 16,
    gesture,
    bounces: false,
    scrollOffset: ctx?.scrollOffset ?? null,
  };
};

interface SwipeableBottomSheetProps {
  isOpen: boolean;
  /** Called once the slide-out animation finishes (unmount the sheet here). */
  onClose: () => void;
  /**
   * Open the sheet at (almost) the full screen height instead of sizing it to
   * its content. The sheet then keeps a constant height regardless of the
   * content shown, and the keyboard shrinks it from the bottom rather than
   * lifting the whole sheet off-screen.
   */
  fullHeight?: boolean;
  /**
   * Sheet content. Pass a render function to receive `close`, which dismisses
   * the sheet with the slide-out animation (use it for Cancel / action buttons).
   */
  children: React.ReactNode | ((api: { close: () => void }) => React.ReactNode);
}

/**
 * A bottom drawer rendered in a native `Modal` (always on top, no z-index
 * conflicts with other sheets) that can be dismissed by swiping down, tapping
 * the backdrop, or the Android back button. Slide in/out is driven by
 * Reanimated so the exit animation plays before the modal unmounts.
 */
export const SwipeableBottomSheet: React.FC<SwipeableBottomSheetProps> = ({
  isOpen,
  onClose,
  fullHeight = false,
  children,
}) => {
  const { scheme } = useColors();
  const insets = useSafeAreaInsets();
  const isDark = scheme === 'dark';

  // 0 = fully open, SCREEN_HEIGHT = fully off-screen (below the viewport).
  const translateY = useSharedValue(SCREEN_HEIGHT);
  // How far to lift the sheet so the keyboard never covers its content.
  const keyboardOffset = useSharedValue(0);
  // Live scroll offset of the sheet's scrollable child (0 when there is none).
  const scrollOffset = useSharedValue(0);

  // The scroll and pan run simultaneously, so one downward swipe can begin as a
  // list-scroll and only reach the top partway through. `draggingSheet` marks
  // when the pan has actually taken over the sheet; `dragBaseline` is the
  // translation at that moment, so the sheet travels from 0 instead of snapping
  // by the whole accumulated drag (which would slam it closed the instant the
  // list hits the top).
  const draggingSheet = useSharedValue(false);
  const dragBaseline = useSharedValue(0);

  // Slide in whenever the parent opens the sheet.
  useEffect(() => {
    if (isOpen) {
      translateY.value = withTiming(0, { duration: SHEET_OPEN_MS });
    }
  }, [isOpen, translateY]);

  // Lift the sheet above the keyboard while it's visible (no-op for sheets
  // without inputs, since they never raise the keyboard).
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      // The safe-area padding is absorbed by the keyboard, so subtract it.
      const lift = Math.max(0, e.endCoordinates.height - insets.bottom);
      // Follow the keyboard's own animation (iOS reports it; Android reports 0).
      keyboardOffset.value = withTiming(lift, { duration: e.duration || SHEET_CLOSE_MS });
    });
    const hideSub = Keyboard.addListener(hideEvent, (e) => {
      keyboardOffset.value = withTiming(0, { duration: e.duration || SHEET_CLOSE_MS });
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [insets.bottom, keyboardOffset]);

  // Callers almost always pass an inline `onClose`, so it changes identity on
  // every parent render. Route it through a ref: `close` — and therefore the pan
  // gesture built from it — then keeps a stable identity for the sheet's whole
  // life, which is what scrollable children declare themselves simultaneous with.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const notifyClosed = useCallback(() => onCloseRef.current(), []);

  // Animate the sheet out, then unmount the modal via the parent flag.
  const close = useCallback(() => {
    translateY.value = withTiming(SCREEN_HEIGHT, { duration: SHEET_CLOSE_MS }, (done) => {
      if (done) {
        runOnJS(notifyClosed)();
      }
    });
  }, [notifyClosed, translateY]);

  // Run alongside the child's native scroll gesture: only drag the sheet down
  // while the list is scrolled to the top, so mid-list scrolling is untouched.
  //
  // Memoized on purpose. Scrollable children hold on to *this object* to declare
  // themselves simultaneous with it; re-creating it every render would hand them
  // a stale handler tag and the pan would start cancelling their scroll.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onUpdate((event) => {
          if (scrollOffset.value <= 0 && event.translationY > 0) {
            // The list is at the top and the finger is moving down: the pan owns
            // the sheet. Capture the baseline the first time so the sheet starts
            // from 0, then move it by the drag *since* the top was reached.
            if (!draggingSheet.value) {
              draggingSheet.value = true;
              dragBaseline.value = event.translationY;
            }
            translateY.value = Math.max(0, event.translationY - dragBaseline.value);
          } else {
            // Still scrolling the list (not at top), or dragging up — leave the
            // sheet put and drop the baseline so the next top-reach re-captures it.
            draggingSheet.value = false;
            translateY.value = 0;
          }
        })
        .onEnd((event) => {
          // Only travel *after* the pan took over the sheet counts toward closing.
          const traveled = draggingSheet.value ? event.translationY - dragBaseline.value : 0;
          draggingSheet.value = false;
          if (traveled > CLOSE_DISTANCE || (traveled > 0 && event.velocityY > CLOSE_VELOCITY)) {
            runOnJS(close)();
          } else {
            translateY.value = withSpring(0, { damping: 20, stiffness: 200 });
          }
        }),
    [close, dragBaseline, draggingSheet, scrollOffset, translateY],
  );

  // The full-height sheet keeps a constant height anchored to the top of the
  // screen and never reacts to the keyboard — it must always stay full height,
  // so content is expected to sit in the upper area, above the keyboard. The
  // content-sized sheet keeps the original behaviour of lifting itself above
  // the keyboard.
  const topInset = insets.top;
  const sheetStyle = useAnimatedStyle(() => {
    if (fullHeight) {
      return {
        height: SCREEN_HEIGHT - topInset,
        transform: [{ translateY: translateY.value }],
      };
    }
    return {
      transform: [{ translateY: translateY.value - keyboardOffset.value }],
    };
  });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: 1 - translateY.value / SCREEN_HEIGHT,
  }));

  // Keep the full-height sheet's frame at full height, but pad its content up by
  // the keyboard height (plus a 10px gap) so bottom-pinned controls don't sit
  // flush against the keyboard.
  const fullHeightContentStyle = useAnimatedStyle(() => ({
    paddingBottom: keyboardOffset.value > 0 ? keyboardOffset.value + 10 : 0,
  }));

  const scrollContext = useMemo<SheetScrollContextValue>(
    () => ({ scrollOffset, panGesture }),
    [scrollOffset, panGesture],
  );

  return (
    <Modal
      transparent
      visible={isOpen}
      onRequestClose={close}
      animationType="none"
      statusBarTranslucent
    >
        <GestureHandlerRootView style={styles.root}>
          <AnimatedPressable style={[styles.backdrop, backdropStyle]} onPress={close} />

          <GestureDetector gesture={panGesture}>
            <Animated.View
              style={[
                styles.sheet,
                sheetStyle,
                {
                  backgroundColor: isDark ? '#27272a' : '#ffffff',
                  paddingBottom: insets.bottom + 12,
                },
              ]}
            >
              <View style={styles.dragHandleWrapper}>
                <View
                  style={[styles.dragHandle, { backgroundColor: isDark ? '#52525b' : '#e4e4e7' }]}
                />
              </View>

              <SheetScrollContext.Provider value={scrollContext}>
                {fullHeight ? (
                  <Animated.View style={[styles.fullHeightContent, fullHeightContentStyle]}>
                    {typeof children === 'function' ? children({ close }) : children}
                  </Animated.View>
                ) : typeof children === 'function' ? (
                  children({ close })
                ) : (
                  children
                )}
              </SheetScrollContext.Provider>
            </Animated.View>
          </GestureDetector>
        </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  dragHandleWrapper: {
    width: '100%',
    paddingVertical: 8,
    alignItems: 'center',
  },
  fullHeightContent: {
    flex: 1,
  },
  dragHandle: {
    width: 48,
    height: 4,
    borderRadius: 4,
  },
});
