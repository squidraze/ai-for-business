import React, { forwardRef, type ComponentRef } from 'react';
import { TextInput, TouchableOpacity, View, type TextInputProps } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { INSET_SURFACE, LABEL_TEXT, useLabelColors } from '@/lib/screen';

/**
 * The app's single search field (Figma nodes `2489:46844` empty and
 * `2489:46936` filled).
 *
 * 44px tall, 16px radius, `bg/cardBackground` fill, a 20px magnifier, a 16px
 * line. Typing swaps the row from muted regular to `label/label` medium and
 * reveals the clear button — the only two states the design has.
 *
 * Like {@link AppTextInput}, the look is **not** overridable: no icon size, no
 * fill, no radius, no text colour. That is the point — this component replaced
 * five different-looking search fields that had all drifted through exactly
 * such props. Only outer spacing is caller-owned, via `containerClassName`.
 * Behaviour props (`autoFocus`, `editable`, `onSubmitEditing`, …) pass straight
 * through, and a `ref` forwards to the underlying input.
 */
export interface SearchInputProps extends Omit<
  TextInputProps,
  'value' | 'onChangeText' | 'style' | 'className' | 'placeholderTextColor'
> {
  value: string;
  onChangeText: (text: string) => void;
  /** Defaults to the design's own `Search...`. */
  placeholder?: string;
  /** Layout-only classes for the outer wrapper — margins around the field. */
  containerClassName?: string;
  /**
   * Runs after the clear button has emptied the field — for a screen that has
   * more to reset than the query itself. Clearing happens either way.
   */
  onClear?: () => void;
  /**
   * Replaces the underlying `TextInput`. The one reason to pass it: a field
   * inside a `@gorhom/bottom-sheet` needs that library's own input or the sheet
   * eats the focus. The visuals stay this component's.
   */
  InputComponent?: React.ComponentType<TextInputProps & { ref?: React.Ref<ComponentRef<typeof TextInput>> }>;
}

// iOS pushes single-line text and placeholder toward the bottom when a custom
// lineHeight is set (as NativeWind's `text-base` does). Set the size without
// one and zero the vertical padding, so the line centres on both platforms and
// the row's own height decides where it sits.
const FONT_STYLE = { fontSize: 16, paddingVertical: 0 } as const;
const TEXT_ALIGN_VERTICAL = 'center';

export const SearchInput = forwardRef<ComponentRef<typeof TextInput>, SearchInputProps>(
  (
    {
      value,
      onChangeText,
      placeholder,
      containerClassName = '',
      onClear,
      InputComponent = TextInput,
      ...inputProps
    },
    ref,
  ) => {
    const { t } = useTranslation();
    const labelColor = useLabelColors();

    // Filled and empty differ by more than the text: the glyphs step up to the
    // label colour with it, which is what separates the two mockups.
    const hasValue = value.length > 0;
    const tone = hasValue ? labelColor.label : labelColor.secondary;

    const handleClear = () => {
      onChangeText('');
      onClear?.();
    };

    // The caller's classes land on an outer wrapper, never on the field — the
    // same shape `AppTextInput` uses, and the reason "spacing only" is a fact
    // here rather than a request.
    return (
      <View className={containerClassName}>
        <View className={`h-11 flex-row items-center gap-2 rounded-[16px] px-3 ${INSET_SURFACE}`}>
          <Search size={20} color={tone} />

          <InputComponent
            ref={ref}
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder ?? t('shared.search.placeholder')}
            placeholderTextColor={labelColor.secondary}
            textAlignVertical={TEXT_ALIGN_VERTICAL}
            returnKeyType="search"
            className={`flex-1 ${LABEL_TEXT} ${hasValue ? 'font-medium' : ''}`}
            style={FONT_STYLE}
            {...inputProps}
          />

          {hasValue ? (
            <TouchableOpacity
              onPress={handleClear}
              activeOpacity={0.7}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('shared.search.clear')}
            >
              <X size={20} color={tone} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  },
);

SearchInput.displayName = 'SearchInput';
