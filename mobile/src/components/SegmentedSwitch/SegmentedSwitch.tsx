import React, { useCallback, useEffect, useMemo } from 'react';
import { Easing, useSharedValue, withTiming } from 'react-native-reanimated';

import { PagerTabs } from '@/components/PagerTabs';
import { SEGMENT_SLIDE_MS } from '@/lib/config';

// Ease-out, so the pill decelerates as it settles on the new segment.
const SLIDE_EASING = Easing.bezier(0.25, 0.46, 0.45, 0.94);

export interface SegmentedItem<T extends string> {
  value: T;
  label: string;
}

interface SegmentedSwitchProps<T extends string> {
  items: readonly SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Outer spacing only — the switch's look is fixed. */
  containerClassName?: string;
  /**
   * Lets the row be dragged, the way a tab row over a pager is: the pill and
   * the row follow the finger and the segment under the pill is chosen on
   * release. For a switch whose segments overflow the track — without it the
   * hidden ones are reachable only by tapping their way along. Off by default.
   */
  draggable?: boolean;
}

/**
 * A segmented switch with nothing behind it: the same control the tabbed
 * screens run on, for the places where the selection drives a query rather than
 * a pager — a filter in a sheet, a setting.
 *
 * It *is* {@link PagerTabs}. The only thing it adds is the continuous position
 * the pill rides, derived from the selected value instead of from a swipe.
 * Everything visual — the track, the pill, the hairlines, the label cross-fade —
 * lives in that one component, which is what keeps a switch on a card and a tab
 * row on a screen from drifting apart the way the two old controls did.
 *
 * The `value` / `onChange` API is what a plain switch wants; an index would make
 * every caller map back to its own union.
 */
export function SegmentedSwitch<T extends string>({
  items,
  value,
  onChange,
  containerClassName,
  draggable = false,
}: SegmentedSwitchProps<T>) {
  // Falls back to the first segment when `value` matches nothing — the pill has
  // to land somewhere, and everything downstream reads this one index, so the
  // highlighted label is always the segment the pill is actually under.
  const activeIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );

  const tabs = useMemo(() => items.map((item) => ({ id: item.value, label: item.label })), [items]);

  // Starts at 0 — which is where the default segment already is — so the pill
  // snaps into place on mount and only animates on a real change.
  // Writable, not derived: a drag drives it directly from the UI thread.
  const position = useSharedValue(activeIndex);
  useEffect(() => {
    position.value = withTiming(activeIndex, { duration: SEGMENT_SLIDE_MS, easing: SLIDE_EASING });
  }, [activeIndex, position]);

  const handleTabPress = useCallback(
    (index: number) => onChange(items[index].value),
    [items, onChange],
  );

  return (
    <PagerTabs
      tabs={tabs}
      activeIndex={activeIndex}
      position={position}
      onTabPress={handleTabPress}
      containerClassName={containerClassName}
      // A drag settles on a segment: that is a choice, same as a tap.
      onScrubEnd={draggable ? handleTabPress : undefined}
    />
  );
}
