import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import PagerView, { type PagerViewOnPageSelectedEvent } from 'react-native-pager-view';
import Animated, { useSharedValue } from 'react-native-reanimated';

import { PagerTabs, type PagerTab } from './PagerTabs';
import { usePagerScrollHandler } from './usePagerScrollHandler';

// Reanimated-driven native pager, so the tab pill follows the swipe on the UI
// thread instead of only snapping after the page settles.
const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

export interface PagerTabsViewProps {
  tabs: PagerTab[];
  /** Controlled active page — the host owns it. */
  activeIndex: number;
  /** Called once a page settles (swipe or tab tap). */
  onIndexChange: (index: number) => void;
  /** Render one page. Pages render lazily: only once they have been visited. */
  renderPage: (tab: PagerTab, index: number) => ReactNode;
  /** Outer spacing for the tab row — spacing only; its look is fixed. */
  tabsContainerClassName?: string;
  /** Extra style for the pages container (it fills the remaining height). */
  style?: StyleProp<ViewStyle>;
}

/**
 * The tab row and its swipeable pages, stacked. Tapping a tab and swiping the
 * content move the same position, and the pill rides it.
 *
 * The pages are a **native** `react-native-pager-view` (ViewPager2 on Android,
 * UIScrollView paging on iOS), not a transform-translated row. That is what
 * lets every page use the plain native `RefreshControl` on both platforms:
 * Android's SwipeRefreshLayout breaks under a translated ancestor, a native
 * pager has none.
 */
export const PagerTabsView = ({
  tabs,
  activeIndex,
  onIndexChange,
  renderPage,
  tabsContainerClassName,
  style,
}: PagerTabsViewProps) => {
  const pagerRef = useRef<PagerView>(null);

  // Continuous position (page + offset) that the tab pill rides.
  const position = useSharedValue(activeIndex);
  const pageScrollHandler = usePagerScrollHandler({
    onPageScroll: (event) => {
      'worklet';
      position.value = event.position + event.offset;
    },
  });

  // Lazy pages: a page mounts the first time it becomes active and then stays.
  const [visited, setVisited] = useState<Set<number>>(() => new Set([activeIndex]));
  useEffect(() => {
    setVisited((prev) => (prev.has(activeIndex) ? prev : new Set(prev).add(activeIndex)));
  }, [activeIndex]);

  // The host changed the page itself (e.g. restored from a store) — follow it.
  const settledIndex = useRef(activeIndex);
  useEffect(() => {
    if (settledIndex.current !== activeIndex) {
      settledIndex.current = activeIndex;
      pagerRef.current?.setPage(activeIndex);
    }
  }, [activeIndex]);

  const handleTabPress = useCallback((index: number) => {
    pagerRef.current?.setPage(index);
  }, []);

  const handlePageSelected = useCallback(
    (event: PagerViewOnPageSelectedEvent) => {
      const index = event.nativeEvent.position;
      settledIndex.current = index;
      onIndexChange(index);
    },
    [onIndexChange],
  );

  return (
    <>
      <PagerTabs
        tabs={tabs}
        activeIndex={activeIndex}
        position={position}
        onTabPress={handleTabPress}
        containerClassName={tabsContainerClassName}
      />
      <AnimatedPagerView
        ref={pagerRef}
        style={[styles.pager, style]}
        initialPage={activeIndex}
        onPageScroll={
          pageScrollHandler as unknown as React.ComponentProps<typeof PagerView>['onPageScroll']
        }
        onPageSelected={handlePageSelected}
      >
        {tabs.map((tab, index) => (
          <View key={tab.id} collapsable={false} style={styles.page}>
            {visited.has(index) ? renderPage(tab, index) : null}
          </View>
        ))}
      </AnimatedPagerView>
    </>
  );
};

const styles = StyleSheet.create({
  pager: { flex: 1 },
  page: { flex: 1 },
});
