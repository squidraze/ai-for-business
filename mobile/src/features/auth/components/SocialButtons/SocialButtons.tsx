import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { errorMessage } from '@/lib/api';
import { useLabelColors } from '@/lib/screen';
import { useColors } from '@/lib/theme';

import { useAppleSignIn, useGoogleSignIn } from '../../auth.hooks';
import { isAppleSignInAvailable, isGoogleConfigured } from '../../social';

// Lucide has no brand logos, so the Google mark comes from Ionicons, wrapped
// to the `size` / `color` shape PrimaryButton passes to a Lucide icon.
const GoogleGlyph = (({ size, color }: { size?: number | string; color?: string }) => (
  <Ionicons name="logo-google" size={typeof size === 'number' ? size : 18} color={color} />
)) as unknown as LucideIcon;

/**
 * "Continue with Google" (both platforms) and "Sign in with Apple" (iOS only).
 * A cancelled dialog is silent; real failures go to `onError`.
 */
export function SocialButtons({
  onError,
  disabled,
}: {
  onError: (message: string | null) => void;
  disabled?: boolean;
}) {
  const c = useColors();
  const labelColors = useLabelColors();
  const { t } = useTranslation();
  const google = useGoogleSignIn();
  const apple = useAppleSignIn();
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let alive = true;
    void isAppleSignInAvailable().then((available) => alive && setAppleAvailable(available));
    return () => {
      alive = false;
    };
  }, []);

  const busy = google.isPending || apple.isPending;

  const signInWithGoogle = () => {
    onError(null);
    google.mutate(undefined, { onError: (error) => onError(errorMessage(error)) });
  };

  const signInWithApple = () => {
    if (busy || disabled) return;
    onError(null);
    apple.mutate(undefined, { onError: (error) => onError(errorMessage(error)) });
  };

  const googleDisabled = !isGoogleConfigured || busy || !!disabled;

  return (
    <View style={styles.wrap}>
      <PrimaryButton
        label={t('auth.social.google')}
        icon={GoogleGlyph}
        size="base"
        onPress={signInWithGoogle}
        disabled={googleDisabled}
        loading={google.isPending}
        colorClassName="border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
        textClassName="text-black dark:text-white"
        iconColor={labelColors.label}
      />
      {!isGoogleConfigured ? (
        <Text style={[styles.hint, { color: c.muted }]}>{t('auth.social.googleUnavailable')}</Text>
      ) : null}

      {appleAvailable ? (
        <View style={{ opacity: busy || disabled ? 0.6 : 1 }} pointerEvents={busy || disabled ? 'none' : 'auto'}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={
              c.scheme === 'dark'
                ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={16}
            onPress={signInWithApple}
            style={styles.apple}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  hint: { fontSize: 12, textAlign: 'center', marginTop: -4 },
  apple: { height: 48, width: '100%' },
});
