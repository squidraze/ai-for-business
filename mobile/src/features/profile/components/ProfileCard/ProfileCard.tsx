import React from 'react';
import { View } from 'react-native';

import { CARD_SURFACE, DIVIDER_FILL, useCardShadow } from '@/lib/screen';

/**
 * Radius of a card made of rows. The reference rounds those at 24px and the
 * lone user card at the shell's 20px — the only two radii on the screen.
 */
export const ROWS_CARD_RADIUS = 24;

interface ProfileCardProps {
  children: React.ReactNode;
  /**
   * Corner radius when it isn't the shell's 20px. A style rather than a
   * `rounded-[…]` class: `CARD_SURFACE` already carries one, and two radius
   * utilities resolve by stylesheet order, not string order.
   */
  radius?: number;
}

/**
 * One block of the profile screen: a white (dark: `zinc-900`) panel with a 14px
 * inset and a soft glow (ported from rooler `packages/ui/features/profile`).
 * The screen is a stack of these.
 */
export const ProfileCard = ({ children, radius }: ProfileCardProps) => {
  const cardShadow = useCardShadow();
  return (
    <View
      className={`${CARD_SURFACE} overflow-hidden p-3.5`}
      style={[cardShadow, radius === undefined ? null : { borderRadius: radius }]}
    >
      {children}
    </View>
  );
};

/**
 * The rows of a card, with hairlines between them. The card owns the
 * separators, so a row that may or may not render never leaves a stray line.
 */
export const CardRows = ({ children }: { children: React.ReactNode }) => {
  const rows = React.Children.toArray(children);
  return (
    <View className="gap-2">
      {rows.map((row, index) => (
        <React.Fragment key={index}>
          {row}
          {index < rows.length - 1 ? <CardDivider /> : null}
        </React.Fragment>
      ))}
    </View>
  );
};

/** The hairline between two rows of a card. */
export const CardDivider = () => <View className={`h-px w-full ${DIVIDER_FILL}`} />;

/** A second part of a card under its first row, separated by a hairline. */
export const ProfileCardSection = ({ children }: { children: React.ReactNode }) => (
  <View className="pt-3.5">
    <CardDivider />
    <View className="pt-2">{children}</View>
  </View>
);
