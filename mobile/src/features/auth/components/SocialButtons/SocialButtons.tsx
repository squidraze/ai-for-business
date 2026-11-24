import { Ionicons } from '@expo/vector-icons';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { errorMessage } from '@/lib/api';
import { useColors } from '@/lib/theme';

import { useAppleSignIn, useGoogleSignIn } from '../../auth.hooks';
import { isAppleSignInAvailable, isGoogleConfigured } from '../../social';

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
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={signInWithGoogle}
        disabled={googleDisabled}
        accessibilityRole="button"
        accessibilityLabel={t('auth.social.google')}
        accessibilityState={{ disabled: googleDisabled, busy: google.isPending }}
        style={[
          styles.google,
          {
            backgroundColor: c.card,
            borderColor: c.border,
            opacity: !isGoogleConfigured || (disabled && !google.isPending) ? 0.5 : 1,
          },
        ]}
      >
        {google.isPending ? (
          <ActivityIndicator color={c.text} />
        ) : (
          <>
            <Ionicons name="logo-google" size={18} color={c.text} />
            <Text style={[styles.googleText, { color: c.text }]}>{t('auth.social.google')}</Text>
          </>
        )}
      </TouchableOpacity>
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
            cornerRadius={12}
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
  google: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleText: { fontSize: 16, fontWeight: '600', marginLeft: 10 },
  hint: { fontSize: 12, textAlign: 'center', marginTop: -4 },
  apple: { height: 48, width: '100%' },
});
