import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { PrimaryButton } from '@/components/PrimaryButton';

import { useRegister } from './auth.hooks';
import { AuthLayout, KeyboardTarget } from './components/AuthLayout';
import { AuthLink } from './components/AuthLink';
import { FormError } from '@/components/FormError';
import { OrDivider } from './components/OrDivider';
import { PasswordField } from './components/PasswordField';
import { PasswordRules } from './components/PasswordRules';
import { ServerHint } from './components/ServerHint';
import { SocialButtons } from './components/SocialButtons';
import { TextField } from '@/components/TextField';
import { useAuthForm } from './useAuthForm';
import { normalizeEmail, validateEmail, validateName, validatePassword } from './validation';

const INITIAL = { name: '', email: '', password: '' };
const VALIDATORS = {
  name: (v: typeof INITIAL) => validateName(v.name),
  email: (v: typeof INITIAL) => validateEmail(v.email),
  password: (v: typeof INITIAL) => validatePassword(v.password, v.email),
};

export function RegisterPage() {
  const { t } = useTranslation();
  const register = useRegister();
  const form = useAuthForm(INITIAL, VALIDATORS);

  const submit = () => {
    if (register.isPending || !form.validate()) return;
    register.mutate(
      {
        name: form.values.name.trim(),
        email: normalizeEmail(form.values.email),
        password: form.values.password,
      },
      {
        onSuccess: (sent) =>
          router.push({
            pathname: '/verify-email',
            params: { email: sent.email, resendIn: String(sent.resend_in) },
          }),
        onError: (error) => form.applyServerError(error),
      },
    );
  };

  return (
    <AuthLayout
      title={t('auth.register.title')}
      subtitle={t('auth.register.subtitle')}
      footer={
        <>
          <AuthLink
            prompt={t('auth.register.haveAccount')}
            action={t('auth.register.signIn')}
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/sign-in'))}
          />
          <ServerHint />
        </>
      }
    >
      <FormError message={form.formError} />
      <TextField
        {...form.field('name')}
        label={t('auth.fields.name')}
        placeholder={t('auth.fields.namePlaceholder')}
        autoComplete="name"
        textContentType="name"
        autoCapitalize="words"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={() => form.focus('email')}
        editable={!register.isPending}
      />
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
        editable={!register.isPending}
      />
      <PasswordField
        {...form.field('password')}
        label={t('auth.fields.password')}
        placeholder={t('auth.fields.newPasswordPlaceholder')}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={submit}
        editable={!register.isPending}
      />
      <PasswordRules password={form.values.password} />
      <KeyboardTarget>
        <PrimaryButton
          label={t('auth.register.submit')}
          size="base"
          onPress={submit}
          loading={register.isPending}
          className="mt-1.5"
        />
      </KeyboardTarget>
      <OrDivider />
      <SocialButtons onError={form.setFormError} disabled={register.isPending} />
    </AuthLayout>
  );
}
