import React, { useEffect } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { LucideIcon } from 'lucide-react-native';

import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '@/components/PrimaryButton';
import { DIALOG_FADE_MS } from '@/lib/config';
import { useColors } from '@/lib/theme';
import { CARD_FILL, DIVIDER_FILL, LABEL_TEXT, SECONDARY_LABEL_TEXT } from '@/lib/screen';

/** Figma: a 120px circle with the glyph inside it at 48px. */
const CIRCLE = 120;
const GLYPH = 48;

/** The dialog's neutral button — the same outline the task dialogs use. */
const OUTLINE_FILL = 'border border-gray-100 bg-white dark:border-zinc-700 dark:bg-zinc-900';
const OUTLINE_ICON = { light: '#27272a', dark: '#ffffff' } as const;

export interface PermissionDialogProps {
  isOpen: boolean;
  /** What this permission buys the user — 18px, one line in the mockups. */
  title: string;
  /** Why we ask, and that it can be changed later. */
  message: string;
  /** The glyph in the circle. */
  icon: LucideIcon;
  /**
   * Fills the circle behind the glyph (the location dialog's map). With one,
   * the circle carries a 20% scrim and the glyph turns white; without one it is
   * the flat inset fill with the glyph in the brand colour.
   */
  image?: ImageSourcePropType;
  /** Primary label — "Allow notifications", or "Open settings" once the OS won't ask again. */
  confirmLabel: string;
  onConfirm: () => void;
  /** Secondary label. Defaults to the mockups' "Not now". */
  dismissLabel?: string;
  /** Backdrop tap, hardware back and the secondary button all land here. */
  onDismiss: () => void;
  /** Spins the primary button and blocks every way out. */
  isSubmitting?: boolean;
}

/**
 * The permission ask (Figma nodes `4118:94079` — location, `4160:63273` —
 * notifications): a card pinned near the bottom edge with a 12px gutter, an
 * illustrated circle over two lines of copy, and a footer of two equal buttons.
 *
 * Deliberately **not** a `SwipeableBottomSheet`. This is a dialog, not a
 * drawer: it is inset on every side, it has no handle, and it must not be
 * swipeable — a permission ask flicked away by accident is asked again on the
 * next launch, which is the loop the redesign removed. So it follows the app's
 * other dialog idiom instead: a raw `Modal` plus a reanimated fade.
 */
export const PermissionDialog = ({
  isOpen,
  title,
  message,
  icon: Icon,
  image,
  confirmLabel,
  onConfirm,
  dismissLabel,
  onDismiss,
  isSubmitting = false,
}: PermissionDialogProps) => {
  const { t } = useTranslation();
  const c = useColors();
  const isDark = c.scheme === 'dark';
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(isOpen ? 1 : 0, { duration: DIALOG_FADE_MS });
  }, [isOpen, progress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 24 }],
  }));

  return (
    <Modal
      transparent
      visible={isOpen}
      onRequestClose={isSubmitting ? undefined : onDismiss}
      animationType="none"
      statusBarTranslucent
    >
      <View className="flex-1 justify-end">
        <Animated.View
          style={[styles.backdrop, backdropStyle]}
          // The backdrop is the whole screen; the card sits above it in the
          // parent, so a tap here is always outside the card.
        >
          <Pressable className="flex-1" disabled={isSubmitting} onPress={onDismiss} />
        </Animated.View>

        <Animated.View
          style={[cardStyle, { marginBottom: insets.bottom + 10 }]}
          className={`mx-3 overflow-hidden rounded-[24px] ${CARD_FILL}`}
        >
          <View className="items-center gap-8 px-4 py-8">
            <View
              className={`items-center justify-center overflow-hidden ${
                image ? '' : 'bg-zinc-50 dark:bg-zinc-800'
              }`}
              style={{ width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2 }}
            >
              {image ? (
                <>
                  <Image source={image} resizeMode="cover" style={StyleSheet.absoluteFill} />
                  {/* The mockup darkens the map so a white glyph reads on it. */}
                  <View style={styles.scrim} />
                </>
              ) : null}
              <Icon size={GLYPH} color={image ? '#ffffff' : c.primary} />
            </View>

            <View className="gap-0.5">
              <Text className={`text-center text-lg font-semibold leading-[22px] ${LABEL_TEXT}`}>
                {title}
              </Text>
              <Text className={`text-center text-sm font-medium leading-5 ${SECONDARY_LABEL_TEXT}`}>
                {message}
              </Text>
            </View>
          </View>

          <View className={`h-px w-full ${DIVIDER_FILL}`} />

          <View className="flex-row gap-2 p-4">
            <PrimaryButton
              label={dismissLabel ?? t('shared.permission.notNow')}
              size="xs"
              className="flex-1"
              colorClassName={OUTLINE_FILL}
              textClassName={LABEL_TEXT}
              iconColor={isDark ? OUTLINE_ICON.dark : OUTLINE_ICON.light}
              disabled={isSubmitting}
              onPress={onDismiss}
            />
            <PrimaryButton
              label={confirmLabel}
              size="xs"
              className="flex-1"
              loading={isSubmitting}
              onPress={onConfirm}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.3)' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.2)' },
});
