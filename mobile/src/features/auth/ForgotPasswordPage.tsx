import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '@/components/PrimaryButton';

import { useForgotPassword } from './auth.hooks';
import { AuthLayout, KeyboardTarget } from './components/AuthLayout';
import { AuthLink } from './components/AuthLink';
import { FormError } from '@/components/FormError';
import { TextField } from '@/components/TextField';
import { useAuthForm } from './useAuthForm';
import { normalizeEmail, validateEmail } from './validation';

const VALIDATORS = { email: (v: { email: string }) => validateEmail(v.email) };

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email?: string }>();
  const forgot = useForgotPassword();
  const form = useAuthForm({ email: params.email ?? '' }, VALIDATORS);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/sign-in'));

  const submit = () => {
    if (forgot.isPending || !form.validate()) return;
    forgot.mutate(
      { email: normalizeEmail(form.values.email) },
      {
        onSuccess: (sent) =>
          router.push({
            pathname: '/reset-password',
            params: { email: sent.email, resendIn: String(sent.resend_in) },
          }),
        onError: (error) => form.applyServerError(error),
      },
    );
  };

  return (
    <AuthLayout
      title={t('auth.forgot.title')}
      subtitle={t('auth.forgot.subtitle')}
      onBack={back}
      backLabel={t('auth.forgot.back')}
      footer={<AuthLink action={t('auth.forgot.back')} onPress={back} />}
    >
      <FormError message={form.formError} />
      <TextField
        {...form.field('email')}
        label={t('auth.fields.email')}
        placeholder={t('auth.fields.emailPlaceholder')}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoFocus={!params.email}
        returnKeyType="send"
        onSubmitEditing={submit}
        editable={!forgot.isPending}
      />
      <KeyboardTarget>
        <PrimaryButton
          label={t('auth.forgot.submit')}
          size="base"
          onPress={submit}
          loading={forgot.isPending}
          className="mt-1.5"
        />
      </KeyboardTarget>
    </AuthLayout>
  );
}
