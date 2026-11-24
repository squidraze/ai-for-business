import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { errorMessage, parseApiError } from '@/lib/api';
import { useColors } from '@/lib/theme';

import type { CodePurpose, CodeSent } from '../../auth.api';
import { useResendCode } from '../../auth.hooks';
import { useCountdown } from '../../useCountdown';
import { AuthLink } from '../AuthLink';

/** "Send again in 42 s" → "Send the code again" link. */
export function ResendCode({
  email,
  purpose,
  initialSeconds,
  onSent,
  onError,
}: {
  email: string;
  purpose: CodePurpose;
  initialSeconds: number;
  onSent: (sent: CodeSent) => void;
  onError: (message: string) => void;
}) {
  const c = useColors();
  const { t } = useTranslation();
  const resend = useResendCode();
  const { seconds, restart } = useCountdown(initialSeconds);

  const send = () => {
    if (resend.isPending || seconds > 0) return;
    resend.mutate(
      { email, purpose },
      {
        onSuccess: (sent) => {
          restart(sent.resend_in);
          onSent(sent);
        },
        onError: (error) => {
          const parsed = parseApiError(error);
          if (parsed.code === 'resend_cooldown' && typeof parsed.extra.retry_after === 'number') {
            restart(parsed.extra.retry_after);
          }
          onError(errorMessage(error));
        },
      },
    );
  };

  return (
    <View style={styles.wrap}>
      {resend.isPending ? (
        <ActivityIndicator color={c.primary} />
      ) : seconds > 0 ? (
        <Text style={[styles.wait, { color: c.muted }]} accessibilityLiveRegion="polite">
          {t('auth.verify.resendIn', { n: seconds })}
        </Text>
      ) : (
        <AuthLink action={t('auth.verify.resend')} onPress={send} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { minHeight: 24, marginTop: 20, alignItems: 'center', justifyContent: 'center' },
  wait: { fontSize: 15 },
});
