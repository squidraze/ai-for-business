import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { LABEL_TEXT, SCREEN_PADDING_X, TERTIARY_LABEL_TEXT, useLabelColors } from '@/lib/screen';

interface PageHeaderBaseProps {
  title: string;
  /**
   * The 24px control opposite the back chevron — "new chat", "help", a filter.
   * A bare icon in a `TouchableOpacity`, not a tile: the tiles belong to
   * {@link ScreenHeader}.
   */
  action?: React.ReactNode;
  /** Replaces the default `router.back()`. */
  onBack?: () => void;
  /** Rendered under the title, inside the header — a search field, a tab strip. */
  children?: React.ReactNode;
}

/**
 * The two title placements, as a union so the compiler enforces the one rule
 * between them: an inline title row is 40px tall and has no second line, so it
 * cannot carry a `subtitle`.
 */
export type PageHeaderProps = PageHeaderBaseProps &
  (
    | {
        /** Title on its own line under the controls — the default. */
        inlineTitle?: false;
        /**
         * The muted line under the title — what this particular page *is* (Figma
         * node `3186:43370`, "Trailer • W97574 • Required"). Part of the title
         * block rather than of `children`, so it sits tight under the title with
         * no gap.
         */
        subtitle?: string;
      }
    | {
        /**
         * Title centred *inside* the control row, between the chevron and the
         * action (Figma node `3234:71020`, the AI chat). Same 24px semibold
         * title, one 40px row instead of two — for a screen whose body starts
         * immediately under the bar and whose title is short enough to sit
         * between two 24px glyphs.
         */
        inlineTitle: true;
        subtitle?: never;
      }
  );

/**
 * The app bar of a **pushed** page (Figma node `2732:53564`): a row of bare 24px
 * controls over a 24px title.
 *
 * One of the two headers this app has, and the one to reach for by default:
 *
 * - {@link ScreenHeader} — a tab root. A 28px title with 44px card tiles beside
 *   it, no back button, because there is nothing to go back to.
 * - `PageHeader` — everything you navigate *into*. Back chevron, 24px title,
 *   an optional muted subtitle under it, at most one bare action.
 *
 * The title normally sits on its own line under the controls; `inlineTitle`
 * centres it *inside* the 40px control row instead (Figma node `3234:71020`, the
 * AI chat). Same title, same paddings, one row — it is a placement, not a third
 * header.
 *
 * It clears the status bar itself (`paddingTop` from the safe-area inset), so
 * the screen under it must **not** also sit in a `SafeAreaView edges={['top']}`
 * — that pads the notch twice.
 *
 * The back chevron only appears when there is somewhere to go back to; a push
 * notification can land on a page as the first route, and the row then holds
 * just the action.
 */
export const PageHeader = ({
  title,
  subtitle,
  action,
  onBack,
  inlineTitle = false,
  children,
}: PageHeaderProps) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const labelColor = useLabelColors();
  const canGoBack = router.canGoBack();

  const back =
    canGoBack || onBack ? (
      <TouchableOpacity
        onPress={onBack ?? (() => router.back())}
        activeOpacity={0.7}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={t('common.goBack')}
      >
        <ChevronLeft size={24} color={labelColor.label} />
      </TouchableOpacity>
    ) : (
      // Holds the row's height and keeps the action pinned right when there is
      // no way back.
      <View className="h-6 w-6" />
    );

  if (inlineTitle) {
    return (
      <View className="pb-3" style={{ paddingTop: insets.top + 12 }}>
        <View
          className="h-10 flex-row items-center justify-between"
          style={{ paddingHorizontal: SCREEN_PADDING_X }}
        >
          {back}

          <Text
            numberOfLines={1}
            className={`flex-1 px-2 text-center text-2xl font-semibold leading-8 ${LABEL_TEXT}`}
          >
            {title}
          </Text>

          {/* The spacer mirrors the chevron so the title is centred on the row
              rather than on the space left over beside it. It follows that an
              `action` wider than 24px shifts the title — keep it one glyph. */}
          {action ?? <View className="h-6 w-6" />}
        </View>

        {children}
      </View>
    );
  }

  return (
    <View className="gap-1" style={{ paddingTop: insets.top + 12 }}>
      <View
        className="h-10 flex-row items-center justify-between"
        style={{ paddingHorizontal: SCREEN_PADDING_X }}
      >
        {back}

        {action}
      </View>

      <View className="py-2" style={{ paddingHorizontal: SCREEN_PADDING_X }}>
        <Text numberOfLines={1} className={`text-2xl font-semibold leading-8 ${LABEL_TEXT}`}>
          {title}
        </Text>
        {subtitle ? (
          <Text
            numberOfLines={1}
            className={`text-sm font-medium leading-5 ${TERTIARY_LABEL_TEXT}`}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>

      {children}
    </View>
  );
};
