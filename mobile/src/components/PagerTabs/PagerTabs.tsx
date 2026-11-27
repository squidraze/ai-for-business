import React, { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { PAGE_SETTLE_SPRING } from '@/lib/config';
import { DIVIDER_FILL, INSET_SURFACE, SECONDARY_LABEL_TEXT } from '@/lib/screen';
import { useColors } from '@/lib/theme';

/** Minimal tab shape the row needs: a stable id and a display label. */
export interface PagerTab {
  id: string;
  label: string;
}

/** Geometry (left offset + width) of a single segment inside the row. */
type TabLayout = { x: number; width: number };

// The switch, measured off Figma node 2457:46327: a 16px inset track with 4px
// of padding, 36px segments on a 12px radius, and a 16px hairline standing
// between two segments with an 8px gutter either side.
const TRACK_PADDING = 4;
const TRACK_RADIUS = 16;
const SEGMENT_HEIGHT = 36;
const SEGMENT_RADIUS = 12;
const SEGMENT_PADDING_X = 16;
const DIVIDER_WIDTH = 1;
const DIVIDER_HEIGHT = 16;
const GUTTER = 8;
/** What one divider costs the row: the hairline plus both its gutters. */
const DIVIDER_STRIDE = DIVIDER_WIDTH + GUTTER * 2;
/** Figma's `Light/elevationMedium`, the one effect on the active segment. */
const PILL_SHADOW = '0px 2px 20px 0px rgba(166, 166, 166, 0.25)';
/** Text style of a label, shared by the visible copies and the measuring one. */
const LABEL_TEXT = 'text-sm leading-5';

export interface PagerTabsProps {
  tabs: PagerTab[];
  activeIndex: number;
  /** Continuous pager position (e.g. 1.5 = halfway between tab 1 and 2). */
  position: SharedValue<number>;
  onTabPress: (index: number) => void;
  /**
   * Outer spacing only — the switch's own look (fill, radius, height, the pill)
   * is fixed on purpose, so it can't drift into a third segmented control.
   */
  containerClassName?: string;
  /**
   * Makes the row draggable to scrub the content. The drag drives the shared
   * `position` in page units, which the host translates its page row by — so
   * dragging the tabs slides the content exactly like swiping the pages.
   * Omit these to keep the row non-interactive.
   */
  onScrubStart?: () => void;
  /** Called (JS thread) once a tab drag settles on a page index. */
  onScrubEnd?: (index: number) => void;
  /**
   * Called (JS thread) once the settle animation has fully finished — i.e. the
   * UI-thread transform is done mutating the tree. Hosts that freeze/unmount
   * pages must wait for this before re-freezing, otherwise an unmount races the
   * still-running Reanimated transaction and crashes Fabric on the New Arch.
   */
  onScrubSettled?: () => void;
}

interface SegmentProps {
  tab: PagerTab;
  index: number;
  isActive: boolean;
  /** Exact width, from `widths` — the number the pill is placed from too. */
  width: number;
  position: SharedValue<number>;
  onPress: (index: number) => void;
}

/**
 * One segment: the label in its resting colour, with the on-brand copy stacked
 * over it and cross-faded by the pager position, so the text turns white
 * exactly as the pill arrives under it.
 *
 * Two stacked `Text`s rather than one animated colour: the colour cross-fade
 * then runs as two opacities on the UI thread, and both copies keep the same
 * NativeWind text classes (an `Animated.Text` colour would not).
 */
const Segment = memo(({ tab, index, isActive, width, position, onPress }: SegmentProps) => {
  const c = useColors();

  // 0 when the pill is fully over this segment, 1 once it has fully left.
  const restingStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(position.value - index)),
  }));
  const onBrandStyle = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.abs(position.value - index)),
  }));

  return (
    <TouchableOpacity
      onPress={() => onPress(index)}
      activeOpacity={0.8}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      style={[styles.segment, { width }]}
    >
      <Animated.View style={[styles.labelLayer, restingStyle]}>
        <Text numberOfLines={1} className={`${LABEL_TEXT} font-medium ${SECONDARY_LABEL_TEXT}`}>
          {tab.label}
        </Text>
      </Animated.View>

      <Animated.View style={[styles.labelLayer, onBrandStyle]}>
        <Text
          numberOfLines={1}
          className={`${LABEL_TEXT} font-semibold`}
          // From the same palette the pill's fill comes from, so the two can
          // never be read out of different ramps.
          style={{ color: c.primaryText }}
        >
          {tab.label}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
});
Segment.displayName = 'Segment';

/**
 * The hairline between segments `index` and `index + 1`. It fades out as the
 * pill slides over it (the pill paints behind it) and is back at full strength
 * whenever the pill is resting on a segment.
 */
const SegmentDivider = memo(
  ({ index, position }: { index: number; position: SharedValue<number> }) => {
    const style = useAnimatedStyle(() => ({
      opacity: Math.min(1, Math.abs(position.value - (index + 0.5)) * 2),
    }));

    return (
      // The slot carries the geometry the row is built from (`DIVIDER_STRIDE`),
      // so the hairline inside it only has to carry the colour.
      <Animated.View pointerEvents="none" style={[styles.dividerSlot, style]}>
        <View className={DIVIDER_FILL} style={styles.dividerLine} />
      </Animated.View>
    );
  },
);
SegmentDivider.displayName = 'SegmentDivider';

/**
 * The app's one tab row: the redesign's segmented switch (Figma node
 * `2457:46327`) driven by a pager position, so the pill tracks the finger
 * across a swipe instead of jumping on settle.
 *
 * **Every segment is given an explicit width, and the pill is placed from the
 * same numbers.** Letting the segments share the track with `flex: 1` and
 * working the pill out separately meant two things deciding one geometry, and
 * they drifted — the pill sat between two labels, or vanished when the two
 * disagreed. The only things measured here are the track (one `onLayout`) and
 * the labels (an invisible copy of the row, see `MeasuringRow`); everything
 * else is arithmetic.
 *
 * The row sizes itself from that: an equal share of the track each where the
 * labels fit (the mockup's two-up switch on home and wallet), and, where five
 * status tabs don't fit, segments as wide as their labels with the row
 * translating on the UI thread to keep the active one centred. An imperative
 * `ScrollView.scrollTo` never attaches on the New Architecture, so that is a
 * transform, not a scroller. See `widths` for the three outcomes.
 *
 * Drag the row to scrub the paired content (see `onScrubStart`/`onScrubEnd`);
 * typically used via `PagerTabsView` (native `react-native-pager-view` pages
 * under the row).
 */
export const PagerTabs = memo(
  ({
    tabs,
    activeIndex,
    position,
    onTabPress,
    containerClassName,
    onScrubStart,
    onScrubEnd,
    onScrubSettled,
  }: PagerTabsProps) => {
    const c = useColors();
    const isDark = c.scheme === 'dark';

    const count = tabs.length;
    const tabsKey = tabs.map((tab) => `${tab.id}\u0000${tab.label}`).join('|');

    const [trackWidth, setTrackWidth] = useState(0);
    /**
     * How wide each segment would be if it were sized by its own label — tagged
     * with the tab set it was measured for. A different set is a different row,
     * so measurements of another set read as none.
     *
     * Tagged rather than reset: clearing them in an effect when the set changed
     * raced the remounted labels, whose `onLayout` can land before a passive
     * effect runs — the reset then wiped the fresh widths and the row stayed
     * unmeasured, every label cut to an even share ("Aut…" after a counted
     * label like "Authority (22)" changed).
     */
    const [measuredWidths, setMeasuredWidths] = useState<{ key: string; widths: number[] }>({
      key: tabsKey,
      widths: [],
    });
    const naturals = measuredWidths.key === tabsKey ? measuredWidths.widths : EMPTY_WIDTHS;

    const handleNaturalWidth = useCallback((key: string, index: number, width: number) => {
      setMeasuredWidths((prev) => {
        const base = prev.key === key ? prev.widths : [];
        if (prev.key === key && base[index] === width) return prev;
        const next = base.slice();
        next[index] = width;
        return { key, widths: next };
      });
    }, []);

    const innerWidth = Math.max(0, trackWidth - TRACK_PADDING * 2);
    const gaps = Math.max(0, count - 1) * DIVIDER_STRIDE;
    // Labels report their widths in whatever order they lay out, so `naturals`
    // can be sparse — the last label measured first gives a full-length array
    // with holes. `every` skips holes, so it is run over a dense copy: a row
    // judged measured with a hole in it hands the pill worklet an undefined
    // segment, and that throws on the UI thread.
    const measured =
      naturals.length === count &&
      Array.from(naturals, (width) => width).every(
        (width) => typeof width === 'number' && width > 0,
      );

    /**
     * The width every segment is given, in order.
     *
     * Four outcomes:
     * - the labels haven't been measured yet → an equal share each, which is
     *   both the mockup's layout and a sane thing to be caught rendering;
     * - they fit with room to spare → an equal share each;
     * - they fit, but the longest label is wider than an equal share → each
     *   label's own width plus an equal cut of what's left, so a long label
     *   ("In progress") isn't truncated by a switch that had the room for it;
     * - they don't fit → each label's own width, and the row scrolls.
     */
    const widths = useMemo<number[]>(() => {
      if (count === 0 || innerWidth <= 0) return [];
      const evenShare = (innerWidth - gaps) / count;
      const even = () => Array.from({ length: count }, () => evenShare);
      if (evenShare <= 0) return even();
      if (!measured) return even();

      const naturalTotal = naturals.reduce((sum, width) => sum + width, 0) + gaps;
      // Own width exactly is a fraction of a pixel too tight: the active
      // segment shows the semibold copy, the face the label was measured in,
      // and Text ellipsises a label given its measured width rounded down
      // ("All" read as "…" on a five-tab row). A whole pixel over is invisible.
      if (naturalTotal > innerWidth) return naturals.map((width) => Math.ceil(width) + 1);
      if (Math.max(...naturals) <= evenShare) return even();

      const slack = (innerWidth - naturalTotal) / count;
      return naturals.map((width) => width + slack);
    }, [count, gaps, innerWidth, measured, naturals]);

    const geometry = useMemo<TabLayout[]>(() => {
      let x = 0;
      return widths.map((width) => {
        const rect = { x, width };
        x += width + DIVIDER_STRIDE;
        return rect;
      });
    }, [widths]);

    const ready = geometry.length === count && count > 0;
    /** Total width of the row, i.e. what the track has to fit or scroll. */
    const rowWidth = ready ? geometry[count - 1].x + geometry[count - 1].width : 0;

    // Drive the pill straight off the pager position: as the user swipes it
    // interpolates between the neighbouring segments' geometry, so the
    // indicator tracks the finger and snaps into place once the page settles.
    const pillStyle = useAnimatedStyle(() => {
      if (!ready) {
        return { opacity: 0, width: 0, transform: [{ translateX: 0 }] };
      }
      if (count === 1) {
        return {
          opacity: 1,
          width: geometry[0].width,
          transform: [{ translateX: geometry[0].x }],
        };
      }
      const input = geometry.map((_, i) => i);
      return {
        opacity: 1,
        width: interpolate(
          position.value,
          input,
          geometry.map((g) => g.width),
          Extrapolation.CLAMP,
        ),
        transform: [
          {
            translateX: interpolate(
              position.value,
              input,
              geometry.map((g) => g.x),
              Extrapolation.CLAMP,
            ),
          },
        ],
      };
    });

    // Keep the active segment centred by translating the whole row on the UI
    // thread, interpolated from the live position so the row follows the finger
    // during a swipe — clamped at the ends so the first/last segments don't
    // leave a gap. A no-op unless the row overflows the track.
    const stripStyle = useAnimatedStyle(() => {
      const maxScroll = rowWidth - innerWidth;
      // A sub-pixel difference is rounding, not overflow — translating by it
      // would shift a row that fits.
      if (!ready || count < 2 || maxScroll <= 1) {
        return { transform: [{ translateX: 0 }] };
      }
      const input = geometry.map((_, i) => i);
      const centres = geometry.map((g) => g.x + g.width / 2);
      const centre = interpolate(position.value, input, centres, Extrapolation.CLAMP);

      let x = centre - innerWidth / 2;
      if (x < 0) x = 0;
      if (x > maxScroll) x = maxScroll;
      return { transform: [{ translateX: -x }] };
    });

    // Page position captured when a scrub drag begins, so the drag is relative
    // to wherever the pager was resting (not always a whole page).
    const scrubStart = useSharedValue(0);
    // True once onEnd has kicked off the settle animation, so onFinalize (which
    // always runs) knows not to yank it down mid-animation — only to settle the
    // row if the gesture was cancelled before it could.
    const settling = useSharedValue(false);

    // Dragging the row scrubs the content exactly like swiping the pages: the
    // finger drives the shared `position` in page units (which the pill and the
    // row already follow, and which the host translates the page row by), so
    // the content slides in lockstep. On release it springs to the nearest
    // whole page. Enabled only when the host wired up scrubbing.
    // Plain const (not useMemo) so the React Compiler can memoise it without the
    // preserve-manual-memoization conflict from mutating shared values in deps.
    const scrubEnabled = !!onScrubEnd;
    const step = count > 0 ? rowWidth / count : 0;
    const maxPage = Math.max(0, count - 1);
    const settleTo = (p: number) => {
      'worklet';
      let target = Math.round(p);
      if (target < 0) target = 0;
      if (target > maxPage) target = maxPage;
      settling.value = true;
      position.value = withSpring(target, PAGE_SETTLE_SPRING, (finished) => {
        settling.value = false;
        // Re-freeze the pages only after the transform has fully settled, never
        // mid-animation (that unmount races Reanimated and crashes Fabric).
        if (finished && onScrubSettled) runOnJS(onScrubSettled)();
      });
      if (onScrubEnd) runOnJS(onScrubEnd)(target);
    };
    const panGesture = Gesture.Pan()
      // Small movements stay taps (so the segments still fire); a clear
      // horizontal drag activates the scrub, a vertical one bails out.
      .activeOffsetX([-8, 8])
      .failOffsetY([-12, 12])
      .onStart(() => {
        scrubStart.value = position.value;
        settling.value = false;
        if (onScrubStart) runOnJS(onScrubStart)();
      })
      .onUpdate((e) => {
        if (step <= 0) return;
        let page = scrubStart.value - e.translationX / step;
        if (page < 0) page = 0;
        if (page > maxPage) page = maxPage;
        position.value = page;
      })
      .onEnd(() => {
        settleTo(position.value);
      })
      .onFinalize(() => {
        // onEnd already ran the settle for a normal release — leave it be.
        // Otherwise the gesture was cancelled mid-drag (another gesture stole
        // it): snap to the nearest page anyway so the pill never stays stranded.
        if (!settling.value) settleTo(position.value);
      });

    const row = (
      <View className={containerClassName}>
        <View
          className={INSET_SURFACE}
          style={styles.track}
          onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        >
          {/* Keyed by the tab set: a new set drops the measurements (above), and
              only a remount makes every label report again — `onLayout` stays
              silent for a label whose width happens not to change, and the row
              would stay unmeasured, every label cut to an even share. */}
          <MeasuringRow
            key={tabsKey}
            measureKey={tabsKey}
            tabs={tabs}
            onWidth={handleNaturalWidth}
          />

          <Animated.View style={[styles.strip, stripStyle]}>
            {/* Painted first so it sits behind the labels — and behind the
                hairlines, which fade out of its way as it passes. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.pill,
                { backgroundColor: c.primary },
                // Figma publishes the light scheme only, and a grey glow on a
                // dark track reads as a halo rather than as depth.
                !isDark && styles.pillShadow,
                pillStyle,
              ]}
            />

            {tabs.map((tab, index) => (
              <React.Fragment key={tab.id}>
                {index > 0 && <SegmentDivider index={index - 1} position={position} />}
                <Segment
                  tab={tab}
                  index={index}
                  isActive={activeIndex === index}
                  width={geometry[index]?.width ?? 0}
                  position={position}
                  onPress={onTabPress}
                />
              </React.Fragment>
            ))}
          </Animated.View>
        </View>
      </View>
    );

    // Wrap in a gesture detector only when the host opted into scrubbing;
    // otherwise return the plain row so a static switch stays static.
    return scrubEnabled ? <GestureDetector gesture={panGesture}>{row}</GestureDetector> : row;
  },
);
PagerTabs.displayName = 'PagerTabs';

/**
 * An invisible copy of the labels, laid out with nothing assigned to them, that
 * reports how wide each one wants to be.
 *
 * The visible row can't answer that question about itself: the moment it is
 * given widths its measurements describe what we asked for, not what the labels
 * need — and reading them back is how the row ends up sizing itself from its own
 * output. Measuring a separate copy keeps the two apart, and lets the visible
 * segments be sized from the very first pass instead of after one.
 *
 * It is absolutely positioned (so it takes no space), invisible, and measured in
 * the **semibold** face, which is the wider of a label's two copies.
 */
/** No measurements yet — one shared empty array, so it is a stable value. */
const EMPTY_WIDTHS: number[] = [];

const MeasuringRow = memo(
  ({
    measureKey,
    tabs,
    onWidth,
  }: {
    measureKey: string;
    tabs: PagerTab[];
    onWidth: (key: string, index: number, width: number) => void;
  }) => (
    <View pointerEvents="none" style={styles.measuringRow}>
      {tabs.map((tab, index) => (
        <View
          key={tab.id}
          style={styles.measuringSegment}
          onLayout={(e) => onWidth(measureKey, index, e.nativeEvent.layout.width)}
        >
          <Text numberOfLines={1} className={`${LABEL_TEXT} font-semibold`}>
            {tab.label}
          </Text>
        </View>
      ))}
    </View>
  ),
);
MeasuringRow.displayName = 'MeasuringRow';

const styles = StyleSheet.create({
  track: {
    padding: TRACK_PADDING,
    borderRadius: TRACK_RADIUS,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    // Sized by its children, which are given exact widths — never `100%`, whose
    // percentage resolves against the track's *padding* box and hands the row
    // 8px it doesn't have.
    alignSelf: 'flex-start',
  },
  pill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: SEGMENT_RADIUS,
  },
  pillShadow: { boxShadow: PILL_SHADOW },
  segment: {
    height: SEGMENT_HEIGHT,
    borderRadius: SEGMENT_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelLayer: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SEGMENT_PADDING_X,
  },
  dividerSlot: {
    width: DIVIDER_WIDTH,
    height: DIVIDER_HEIGHT,
    marginHorizontal: GUTTER,
  },
  dividerLine: { flex: 1 },
  measuringRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    flexDirection: 'row',
    opacity: 0,
  },
  measuringSegment: {
    height: SEGMENT_HEIGHT,
    paddingHorizontal: SEGMENT_PADDING_X,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
