import React from 'react';
import { Pressable, Text, ActivityIndicator, type PressableProps } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';

/**
 * The app's primary call-to-action button — the single source of truth for both
 * the floating "add" buttons (Feedback / Issues / Leave requests) and the
 * submit / "Done" buttons inside the create/edit sheets.
 *
 * By default it renders the running app's brand fill (`bg-primary`, i.e. the
 * `--primary` CSS variable in that app's global.css — blue in both apps today)
 * with a white label, which reads correctly on both light and dark
 * backgrounds. Secondary/neutral buttons
 * that sit next to it (a gray "Cancel", a "Back") should render through this
 * same component so the two match in height, radius and press feedback — pass
 * their own fill/label colours via `colorClassName` / `textClassName` /
 * `iconColor` (each accepts a `dark:` variant so the button stays theme-aware).
 *
 * Disabled keeps the solid fill and dims the whole button to 50% (never a
 * translucent/see-through fill); `loading` keeps the fill at full strength and
 * swaps the label for a spinner. Both block presses.
 */
export interface PrimaryButtonProps extends Omit<
  PressableProps,
  'children' | 'style' | 'disabled'
> {
  label: string;
  /** Optional leading Lucide icon (e.g. `Plus`). */
  icon?: LucideIcon;
  /** Show a spinner instead of the label and block presses (fill stays filled). */
  loading?: boolean;
  /** Dim the button and block presses (e.g. an invalid form). */
  disabled?: boolean;
  /**
   * Size preset. `'lg'` (62px) is the default; use `'sm'` (52px) when the
   * button sits next to a shorter control (e.g. a 52px secondary button in a
   * row) where the full-size button would look too tall. `'md'` is the sticky
   * page-footer button (Figma `Buttons` at node `3186:43495`: 44px, 16px
   * radius, 14px medium label) — the PTI step screen's "Save answer" bar.
   * `'xs'` is the compact dialog-footer button (Figma `Buttons`: 40px, 12px
   * radius, 14px medium label) used inside centred dialogs — e.g. the
   * checklist task dialogs. `'base'` is the 48px bottom-card CTA (Figma
   * `Buttons` at node `6090:95827`: 16px radius, 16px semibold label) — the
   * access-denied screen's "Sign out".
   */
  size?: 'lg' | 'sm' | 'base' | 'md' | 'xs';
  /** Extra classes for layout only — margins, `flex-1`, etc. */
  className?: string;
  /**
   * Fill classes for the button. Defaults to the app's brand (`bg-primary`).
   * For a neutral/secondary button pass its own classes including the `dark:`
   * variant, e.g. `"bg-gray-100 dark:bg-zinc-800"`. Never pass a brand hex —
   * that is what pins a button to one app's colour scheme.
   */
  colorClassName?: string;
  /**
   * Label colour classes. Defaults to `text-white`. For a neutral button pass
   * the theme-aware pair, e.g. `"text-black dark:text-white"`.
   */
  textClassName?: string;
  /**
   * Icon + spinner colour (a hex/rgb value — Lucide and `ActivityIndicator`
   * take a colour value, not a class). Defaults to `#fff`. Pass a theme-derived
   * value for neutral buttons (e.g. `isDark ? '#fff' : '#000'`).
   */
  iconColor?: string;
}

// Radius and label follow the height: the two full-size presets share the CTA
// look, the dialog preset mirrors Figma's compact `Buttons` component.
const SIZES = {
  lg: { height: 62, radius: 'rounded-3xl', text: 'text-base font-semibold', icon: 32 },
  sm: { height: 52, radius: 'rounded-3xl', text: 'text-base font-semibold', icon: 32 },
  base: { height: 48, radius: 'rounded-2xl', text: 'text-base font-semibold', icon: 20 },
  md: { height: 44, radius: 'rounded-2xl', text: 'text-sm font-medium', icon: 20 },
  xs: { height: 40, radius: 'rounded-xl', text: 'text-sm font-medium', icon: 18 },
} as const;

export const PrimaryButton = ({
  label,
  icon: Icon,
  loading = false,
  disabled = false,
  size = 'lg',
  className = '',
  colorClassName = 'bg-primary',
  textClassName = 'text-white',
  iconColor = '#fff',
  ...pressableProps
}: PrimaryButtonProps) => {
  const dimmed = disabled && !loading;
  const preset = SIZES[size];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      className={`flex-row items-center justify-center ${preset.radius} ${colorClassName} ${
        dimmed ? 'opacity-50' : 'active:opacity-80'
      } ${className}`}
      style={{ height: preset.height }}
      {...pressableProps}
    >
      {loading ? (
        <ActivityIndicator color={iconColor} size="small" />
      ) : (
        <>
          {Icon ? <Icon size={preset.icon} color={iconColor} strokeWidth={3} /> : null}
          <Text
            className={`${textClassName} ${preset.text} ${Icon ? 'ml-2' : ''}`}
            numberOfLines={1}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
};
