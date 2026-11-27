import type { ViewStyle } from 'react-native';

import { useColors } from './theme';

/**
 * Shared NativeWind class tokens for the shared UI components (ported from
 * rooler's `packages/ui/theme/screen.ts`). Everything here is a **neutral**;
 * the brand is `bg-primary` / `useColors().primary`.
 *
 * Each class token carries its `dark:` pair, so a component built from these
 * is in both themes by construction.
 */

/** Side gutter for everything on a screen, header included. */
export const SCREEN_PADDING_X = 14;

/**
 * A card: 20px radius. The border width is the same in both themes and only
 * its colour changes. On Android, a clipped view that loses its border width
 * on a live theme switch stops painting its children, so never use a bare
 * `dark:border` on anything clipped.
 */
export const CARD_SURFACE =
  'rounded-[20px] border border-transparent bg-white dark:border-zinc-800 dark:bg-zinc-900';

/** The card surface without the radius (NativeWind resolves two radius classes by stylesheet order, not string order). */
export const CARD_FILL = 'border border-transparent bg-white dark:border-zinc-800 dark:bg-zinc-900';

/** Inset panels inside a card: the search field, the segmented track. */
export const INSET_SURFACE = 'bg-zinc-50 dark:bg-zinc-800';

/** Hairline between rows, as the fill of a 1px view. */
export const DIVIDER_FILL = 'bg-gray-100 dark:bg-zinc-800';

/** A title or a figure. */
export const LABEL_TEXT = 'text-zinc-800 dark:text-zinc-50';

/** A placeholder, an unselected segment, a caption. */
export const SECONDARY_LABEL_TEXT = 'text-zinc-600 dark:text-zinc-400';

/** The most muted text step. */
export const TERTIARY_LABEL_TEXT = 'text-zinc-500 dark:text-zinc-400';

/**
 * Soft glow with no offset for cards and header tiles. A style, not a
 * `shadow-*` class: Android `elevation` can only draw a dark downward shadow.
 * Dark mode takes none (a light glow on a dark screen reads as a halo).
 */
const CARD_SHADOW: ViewStyle = { boxShadow: '0px 0px 12px 0px rgba(221, 221, 221, 0.2)' };

export const useCardShadow = (): ViewStyle | undefined => {
  const { scheme } = useColors();
  return scheme === 'dark' ? undefined : CARD_SHADOW;
};

/**
 * The three label steps as **values**, for what a class cannot reach: an icon's
 * `color`, a `placeholderTextColor`, an animated style. Each resolves to exactly
 * what its `*_TEXT` class does.
 */
export const useLabelColors = () => {
  const { scheme } = useColors();
  const isDark = scheme === 'dark';
  return {
    /** {@link LABEL_TEXT} */
    label: isDark ? '#fafafa' : '#27272a',
    /** {@link SECONDARY_LABEL_TEXT} */
    secondary: isDark ? '#a1a1aa' : '#52525b',
    /** {@link TERTIARY_LABEL_TEXT} */
    tertiary: isDark ? '#a1a1aa' : '#71717a',
  };
};
