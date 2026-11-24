import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { Button } from '@/components/Button';
import { errorCodeMessage, parseApiError } from '@/lib/api';
import { useColors } from '@/lib/theme';

import { CODE_ERRORS } from './auth.api';
import { useResetPassword } from './auth.hooks';
import { AuthLayout, KeyboardTarget } from './components/AuthLayout';
import { CodeInput } from './components/CodeInput';
import { FormError } from './components/FormError';
import { PasswordField } from './components/PasswordField';
import { PasswordRules } from './components/PasswordRules';
import { ResendCode } from './components/ResendCode';
import { useAuthForm } from './useAuthForm';
import { parseSeconds } from './useCountdown';
import { validateCode, validateConfirm, validatePassword } from './validation';

type Values = { code: string; password: string; confirm: string };

export function ResetPasswordPage() {
  const c = useColors();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email?: string; resendIn?: string }>();
  const email = params.email ?? '';
  const reset = useResetPassword();
  const [codeError, setCodeError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [validators] = useState(() => ({
    code: (v: Values) => validateCode(v.code),
    password: (v: Values) => validatePassword(v.password, email),
    confirm: (v: Values) => validateConfirm(v.password, v.confirm),
  }));
  const form = useAuthForm<keyof Values>({ code: '', password: '', confirm: '' }, validators);

  if (!email) return <Redirect href="/forgot-password" />;

  const back = () => (router.canGoBack() ? router.back() : router.replace('/sign-in'));

  const submit = () => {
    if (reset.isPending || !form.validate()) return;
    setInfo(null);
    // Success signs the user in; the root layout leaves the auth stack.
    reset.mutate(
      { email, code: form.values.code, password: form.values.password },
      {
        onError: (error) => {
          const parsed = parseApiError(error);
          if (CODE_ERRORS.has(parsed.code)) {
            setCodeError(errorCodeMessage(parsed.code, parsed.extra) ?? t('errors.generic'));
            form.setValue('code', '');
            if (parsed.code === 'invalid_code') form.focus('code');
            return;
          }
          form.applyServerError(error);
        },
      },
    );
  };

  const codeField = form.field('code');

  return (
    <AuthLayout
      title={t('auth.reset.title')}
      subtitle={t('auth.reset.subtitle', { email })}
      onBack={back}
      backLabel={t('auth.forgot.back')}
    >
      <FormError message={form.formError} />
      {info ? <Text style={[styles.info, { color: c.success }]}>{info}</Text> : null}
      <CodeInput
        ref={codeField.ref}
        value={codeField.value}
        onChangeText={(value) => {
          codeField.onChangeText(value);
          setCodeError(null);
        }}
        onComplete={() => form.focus('password')}
        error={codeError ?? codeField.error}
        disabled={reset.isPending}
        autoFocus
      />
      <PasswordField
        {...form.field('password')}
        label={t('auth.fields.newPassword')}
        placeholder={t('auth.fields.newPasswordPlaceholder')}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => form.focus('confirm')}
        editable={!reset.isPending}
      />
      <PasswordRules password={form.values.password} />
      <PasswordField
        {...form.field('confirm')}
        label={t('auth.fields.confirmPassword')}
        placeholder={t('auth.fields.confirmPasswordPlaceholder')}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!reset.isPending}
      />
      <KeyboardTarget>
        <Button
          title={t('auth.reset.submit')}
          onPress={submit}
          loading={reset.isPending}
          style={{ marginTop: 6 }}
        />
      </KeyboardTarget>
      <ResendCode
        purpose="reset"
        email={email}
        initialSeconds={parseSeconds(params.resendIn)}
        onSent={() => {
          form.setValue('code', '');
          setCodeError(null);
          form.setFormError(null);
          setInfo(t('auth.verify.resent'));
          form.focus('code');
        }}
        onError={(message) => {
          setInfo(null);
          form.setFormError(message);
        }}
      />
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  info: { fontSize: 14, textAlign: 'center', marginBottom: 12 },
});
