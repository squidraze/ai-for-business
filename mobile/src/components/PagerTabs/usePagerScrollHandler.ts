import { useEvent, useHandler } from 'react-native-reanimated';

/** nativeEvent shape emitted by react-native-pager-view's `onPageScroll`. */
export interface PagerScrollEvent {
  /** Index of the page currently on the left edge. */
  position: number;
  /** Fraction (0..1) scrolled towards the next page. */
  offset: number;
}

type Handlers = {
  onPageScroll: (event: PagerScrollEvent, context: Record<string, unknown>) => void;
};

/**
 * Bridges react-native-pager-view's `onPageScroll` into a Reanimated worklet so
 * the tab indicator can follow the swipe on the UI thread (Instagram-style),
 * instead of only snapping after the page settles.
 *
 * Returns a handler to pass straight to `<AnimatedPagerView onPageScroll={...} />`.
 */
export function usePagerScrollHandler(handlers: Handlers, dependencies?: unknown[]) {
  const { context, doDependenciesDiffer } = useHandler(handlers, dependencies);

  return useEvent<PagerScrollEvent>(
    (event) => {
      'worklet';
      const { onPageScroll } = handlers;
      if (onPageScroll && event.eventName.endsWith('onPageScroll')) {
        onPageScroll(event, context);
      }
    },
    ['onPageScroll'],
    doDependenciesDiffer,
  );
}
