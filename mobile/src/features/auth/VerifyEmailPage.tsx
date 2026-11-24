import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { Button } from '@/components/Button';
import { errorCodeMessage, parseApiError } from '@/lib/api';
import { useColors } from '@/lib/theme';

import { CODE_ERRORS } from './auth.api';
import { useVerifyEmail } from './auth.hooks';
import { AuthLayout, KeyboardTarget } from './components/AuthLayout';
import { AuthLink } from './components/AuthLink';
import { CodeInput } from './components/CodeInput';
import { FormError } from './components/FormError';
import type { TextInputRef } from './components/TextField';
import { ResendCode } from './components/ResendCode';
import { parseSeconds } from './useCountdown';
import { validateCode } from './validation';

export function VerifyEmailPage() {
  const c = useColors();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email?: string; resendIn?: string }>();
  const email = params.email ?? '';
  const verify = useVerifyEmail();
  const codeRef = useRef<TextInputRef>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [alreadyVerified, setAlreadyVerified] = useState(false);

  if (!email) return <Redirect href="/sign-in" />;

  const back = () => (router.canGoBack() ? router.back() : router.replace('/sign-in'));

  const submit = (value = code) => {
    if (verify.isPending) return;
    const invalid = validateCode(value);
    if (invalid) {
      setCodeError(t(`validation.${invalid}`));
      codeRef.current?.focus();
      return;
    }
    setFormError(null);
    setInfo(null);
    // Success flips the auth status; the root layout then leaves the auth stack.
    verify.mutate(
      { email, code: value },
      {
        onError: (error) => {
          const parsed = parseApiError(error);
          const message =
            errorCodeMessage(parsed.code, parsed.extra) ?? parsed.message ?? t('errors.generic');
          if (parsed.code === 'already_verified') {
            setAlreadyVerified(true);
            setFormError(message);
          } else if (CODE_ERRORS.has(parsed.code)) {
            // Wrong code: retype. Expired / too many attempts: a new code is needed.
            setCodeError(message);
            setCode('');
            if (parsed.code === 'invalid_code') codeRef.current?.focus();
          } else {
            setFormError(message);
          }
        },
      },
    );
  };

  const onChange = (value: string) => {
    if (verify.isPending) return;
    setCode(value);
    setCodeError(null);
  };

  return (
    <AuthLayout
      title={t('auth.verify.title')}
      subtitle={t('auth.verify.subtitle', { email })}
      onBack={back}
      backLabel={t('auth.verify.changeEmail')}
      footer={<AuthLink action={t('auth.verify.changeEmail')} onPress={back} />}
    >
      <FormError message={formError} />
      {info ? <Text style={[styles.info, { color: c.success }]}>{info}</Text> : null}
      <CodeInput
        ref={codeRef}
        value={code}
        onChangeText={onChange}
        onComplete={(value) => submit(value)}
        error={codeError}
        // Not disabled while pending: on Android that dismisses the keyboard.
        disabled={alreadyVerified}
        autoFocus
      />
      {alreadyVerified ? (
        <Button title={t('auth.register.signIn')} onPress={() => router.replace('/sign-in')} />
      ) : (
        <>
          <KeyboardTarget>
            <Button
              title={t('auth.verify.submit')}
              onPress={() => submit()}
              loading={verify.isPending}
              disabled={code.length === 0}
            />
          </KeyboardTarget>
          <ResendCode
            purpose="verify"
            email={email}
            initialSeconds={parseSeconds(params.resendIn)}
            onSent={() => {
              setCode('');
              setCodeError(null);
              setFormError(null);
              setInfo(t('auth.verify.resent'));
              codeRef.current?.focus();
            }}
            onError={(message) => {
              setInfo(null);
              setFormError(message);
            }}
          />
        </>
      )}
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  info: { fontSize: 14, textAlign: 'center', marginBottom: 12 },
});
