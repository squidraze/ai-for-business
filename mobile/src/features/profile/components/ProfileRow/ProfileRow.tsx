import React, { type ComponentType } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { INSET_SURFACE, LABEL_TEXT, SECONDARY_LABEL_TEXT, useLabelColors } from '@/lib/screen';
import { useColors } from '@/lib/theme';

/** Anything drawn like a Lucide glyph: a component taking `size` and `color`. */
export type RowIcon = ComponentType<{ size?: number; color?: string }>;

interface ProfileRowProps {
  /** Glyph for the row's tile — pass the component, not an element. */
  icon: RowIcon;
  label: string;
  /** A second, muted line under the label. */
  subtitle?: string;
  /** Replaces the trailing chevron — a switch, a spinner. */
  trailing?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** Paints the glyph and the label red — sign out, delete account. */
  destructive?: boolean;
  accessibilityHint?: string;
}

/**
 * One row of a profile card (ported from rooler `ProfileRow`): a 40px rounded
 * tile with a 20px glyph, the label beside it and a trailing chevron — or
 * whatever `trailing` puts there. A row without `onPress` is a plain view with
 * no chevron, so it doesn't look tappable.
 *
 * `TouchableOpacity`, not `Pressable`: NativeWind wraps `Pressable`.
 */
export const ProfileRow = ({
  icon: Icon,
  label,
  subtitle,
  trailing,
  onPress,
  disabled,
  destructive,
  accessibilityHint,
}: ProfileRowProps) => {
  const labelColor = useLabelColors();
  const { danger } = useColors();
  const glyphColor = destructive ? danger : labelColor.label;

  const content = (
    <>
      <View className="flex-1 flex-row items-center gap-2">
        <View className={`h-10 w-10 items-center justify-center rounded-[13px] ${INSET_SURFACE}`}>
          <Icon size={20} color={glyphColor} />
        </View>
        <View className="flex-1">
          <Text
            numberOfLines={1}
            className={`text-sm font-medium leading-[22px] ${destructive ? '' : LABEL_TEXT}`}
            style={destructive ? { color: danger } : undefined}
          >
            {label}
          </Text>
          {subtitle ? (
            <Text numberOfLines={1} className={`text-xs leading-4 ${SECONDARY_LABEL_TEXT}`}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      {trailing ?? (onPress ? <ChevronRight size={20} color={labelColor.tertiary} /> : null)}
    </>
  );

  if (!onPress) {
    return <View className="min-h-10 flex-row items-center justify-between gap-2">{content}</View>;
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      className="min-h-10 flex-row items-center justify-between gap-2"
      style={disabled ? { opacity: 0.5 } : undefined}
    >
      {content}
    </TouchableOpacity>
  );
};
