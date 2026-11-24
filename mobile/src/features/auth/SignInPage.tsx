import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import { parseApiError } from '@/lib/api';

import { useSignIn } from './auth.hooks';
import { AuthLayout, KeyboardTarget } from './components/AuthLayout';
import { AuthLink } from './components/AuthLink';
import { FormError } from './components/FormError';
import { OrDivider } from './components/OrDivider';
import { PasswordField } from './components/PasswordField';
import { ServerHint } from './components/ServerHint';
import { SocialButtons } from './components/SocialButtons';
import { TextField } from './components/TextField';
import { useAuthForm } from './useAuthForm';
import { normalizeEmail, validateEmail, validateLoginPassword } from './validation';

const INITIAL = { email: '', password: '' };
const VALIDATORS = {
  email: (v: typeof INITIAL) => validateEmail(v.email),
  password: (v: typeof INITIAL) => validateLoginPassword(v.password),
};

export function SignInPage() {
  const { t } = useTranslation();
  const signIn = useSignIn();
  const form = useAuthForm(INITIAL, VALIDATORS);

  const submit = () => {
    if (signIn.isPending || !form.validate()) return;
    const email = normalizeEmail(form.values.email);
    signIn.mutate(
      { email, password: form.values.password },
      {
        onError: (error) => {
          const parsed = parseApiError(error);
          if (parsed.code === 'email_not_verified') {
            const resendIn = typeof parsed.extra.resend_in === 'number' ? parsed.extra.resend_in : 0;
            const target = typeof parsed.extra.email === 'string' ? parsed.extra.email : email;
            router.push({ pathname: '/verify-email', params: { email: target, resendIn: String(resendIn) } });
            return;
          }
          form.applyServerError(error);
        },
      },
    );
  };

  return (
    <AuthLayout
      title={t('auth.signIn.title')}
      subtitle={t('auth.signIn.subtitle')}
      footer={
        <>
          <AuthLink
            prompt={t('auth.signIn.noAccount')}
            action={t('auth.signIn.createOne')}
            onPress={() => router.push('/register')}
          />
          <ServerHint />
        </>
      }
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
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => form.focus('password')}
        editable={!signIn.isPending}
      />
      <PasswordField
        {...form.field('password')}
        label={t('auth.fields.password')}
        placeholder={t('auth.fields.passwordPlaceholder')}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!signIn.isPending}
      />
      <AuthLink
        align="right"
        action={t('auth.signIn.forgot')}
        onPress={() =>
          router.push({
            pathname: '/forgot-password',
            params: { email: normalizeEmail(form.values.email) },
          })
        }
      />
      <KeyboardTarget>
        <Button
          title={t('auth.signIn.submit')}
          onPress={submit}
          loading={signIn.isPending}
          style={{ marginTop: 20 }}
        />
      </KeyboardTarget>
      <OrDivider />
      <SocialButtons onError={form.setFormError} disabled={signIn.isPending} />
    </AuthLayout>
  );
}
