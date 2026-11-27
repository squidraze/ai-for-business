import React, { forwardRef, type ComponentRef } from 'react';
import { Text, TextInput, View, type TextInputProps } from 'react-native';

import { useColors } from '@/lib/theme';

/**
 * The app's single source of truth for text inputs — one rounded, theme-aware
 * field used everywhere so every input looks identical. Use this instead of
 * hand-rolling a `<TextInput>`; the radius, padding, fill, text/placeholder
 * colours and both themes are baked in and intentionally NOT overridable, so
 * screens can't drift into their own one-off input styles.
 *
 * Pass `label` for the muted caption above the field. Set `multiline` for a
 * taller text area (min 140px, top-aligned text). Everything else is a normal
 * `TextInputProps`, and a `ref` forwards to the underlying `TextInput`.
 * Only outer spacing is caller-owned, via `containerClassName`.
 */
export interface AppTextInputProps extends Omit<TextInputProps, 'style' | 'className'> {
  /** Muted caption rendered above the field. */
  label?: string;
  /** Render a taller, top-aligned text area instead of a single line. */
  multiline?: boolean;
  /** Layout-only classes for the outer wrapper — margins between fields, etc. */
  containerClassName?: string;
}

// iOS pushes single-line text/placeholder toward the bottom when a custom
// lineHeight is set (as NativeWind's `text-base` does). Set the font size
// without a lineHeight so the line centres on both platforms.
const FONT_STYLE = { fontSize: 16 } as const;
const TEXT_ALIGN = { multiline: 'top', single: 'center' } as const;

export const AppTextInput = forwardRef<ComponentRef<typeof TextInput>, AppTextInputProps>(
  ({ label, multiline = false, containerClassName = '', ...inputProps }, ref) => {
    const { scheme } = useColors();
    const isDark = scheme === 'dark';

    const labelColor = isDark ? 'text-gray-400' : 'text-gray-500';
    const inputBg = isDark ? 'bg-[#1c1c1e]' : 'bg-[#f4f4f5]';
    const inputText = isDark ? 'text-white' : 'text-black';
    const placeholderColor = isDark ? '#71717a' : '#9ca3af';

    return (
      <View className={containerClassName}>
        {label ? <Text className={`text-sm mb-1.5 ${labelColor}`}>{label}</Text> : null}
        <TextInput
          ref={ref}
          multiline={multiline}
          placeholderTextColor={placeholderColor}
          textAlignVertical={multiline ? TEXT_ALIGN.multiline : TEXT_ALIGN.single}
          accessibilityLabel={label}
          className={`rounded-2xl px-4 py-3.5 ${inputBg} ${inputText} ${
            multiline ? 'min-h-[140px]' : ''
          }`}
          style={FONT_STYLE}
          {...inputProps}
        />
      </View>
    );
  },
);

AppTextInput.displayName = 'AppTextInput';
