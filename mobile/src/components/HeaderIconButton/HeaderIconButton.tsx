import React from 'react';
import { TouchableOpacity } from 'react-native';

import { CARD_SURFACE, useCardShadow } from '@/lib/screen';

interface HeaderIconButtonProps {
  onPress: () => void;
  accessibilityLabel: string;
  /** A 20px glyph — the size every mockup's header tile uses. */
  children: React.ReactNode;
}

/**
 * A screen header's round-cornered action tile: 44×44 of card surface with a
 * 20px glyph, carrying the same soft glow the screen's cards do (Figma nodes
 * 2457:46285, 2544:48587).
 *
 * `TouchableOpacity`, not `Pressable`: the root layout force-loads NativeWind's
 * interop registrations, which wrap `Pressable` and silently drop the function
 * form of `style` — so `style={({ pressed }) => …}` would render no shadow at
 * all. See the NativeWind note in CLAUDE.md.
 */
export const HeaderIconButton = ({
  onPress,
  accessibilityLabel,
  children,
}: HeaderIconButtonProps) => {
  const cardShadow = useCardShadow();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // The mockup's tile is 16px-rounded, not the 20px `CARD_SURFACE` gives a
      // card. Overridden here rather than parameterised — the tiles are the only
      // thing on these screens that differ.
      className={`${CARD_SURFACE} h-11 w-11 items-center justify-center rounded-[16px]`}
      style={cardShadow}
    >
      {children}
    </TouchableOpacity>
  );
};
