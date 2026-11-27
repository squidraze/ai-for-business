import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';

import { AppTextInput } from '@/components/AppTextInput';
import { FormError } from '@/components/FormError';
import { KeyboardAwareForm, KeyboardTarget } from '@/components/KeyboardAwareForm';
import { PageHeader } from '@/components/PageHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { errorMessage } from '@/lib/api';
import { LABEL_TEXT, TERTIARY_LABEL_TEXT } from '@/lib/screen';
import { useColors } from '@/lib/theme';

import { invalidateConnectors } from '../../connectors.hooks';
import { telegramApi } from './telegram.api';

type Step = 'phone' | 'code' | 'password';

/** Sign in to the user's Telegram account: phone → code → (2FA password). */
export function TelegramConnectPage() {
  const c = useColors();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [hash, setHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = async () => {
    await invalidateConnectors(queryClient);
    router.back();
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      const normalized = phone.replace(/[^\d+]/g, '');
      const data = await telegramApi.sendCode(normalized);
      setPhone(normalized);
      setHash(data.phone_code_hash);
      setStep('code');
    });

  const signIn = () =>
    run(async () => {
      const data = await telegramApi.signIn({ phone, code: code.trim(), phone_code_hash: hash });
      if (data?.status === 'password_required') setStep('password');
      else await done();
    });

  const submitPassword = () =>
    run(async () => {
      await telegramApi.password(password);
      await done();
    });

  const heading = (title: string, text: string) => (
    <>
      <Text className={`mb-2 text-[22px] font-bold ${LABEL_TEXT}`}>{title}</Text>
      <Text className={`mb-5 text-[15px] ${TERTIARY_LABEL_TEXT}`}>{text}</Text>
    </>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAwareForm
        header={<PageHeader title={t('telegram.connect.title')} />}
        contentContainerStyle={{ padding: 24 }}
      >
        <FormError message={error} />

        {step === 'phone' ? (
          <>
            {heading(t('telegram.connect.phoneTitle'), t('telegram.connect.phoneText'))}
            <AppTextInput
              value={phone}
              onChangeText={setPhone}
              placeholder={t('telegram.connect.phonePlaceholder')}
              keyboardType="phone-pad"
              autoComplete="tel"
              autoFocus
              onSubmitEditing={() => void sendCode()}
              containerClassName="mb-3"
            />
            <KeyboardTarget>
              <PrimaryButton
                size="base"
                label={t('telegram.connect.sendCode')}
                onPress={() => void sendCode()}
                loading={busy}
                disabled={phone.replace(/\D/g, '').length < 6}
              />
            </KeyboardTarget>
          </>
        ) : null}

        {step === 'code' ? (
          <>
            {heading(t('telegram.connect.codeTitle'), t('telegram.connect.codeText', { phone }))}
            <AppTextInput
              value={code}
              onChangeText={setCode}
              placeholder={t('telegram.connect.codePlaceholder')}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              autoFocus
              onSubmitEditing={() => void signIn()}
              containerClassName="mb-3"
            />
            <KeyboardTarget>
              <PrimaryButton
                size="base"
                label={t('telegram.connect.signIn')}
                onPress={() => void signIn()}
                loading={busy}
                disabled={code.trim().length < 4}
              />
              <PrimaryButton
                size="base"
                label={t('telegram.connect.changeNumber')}
                onPress={() => {
                  setStep('phone');
                  setCode('');
                  setError(null);
                }}
                className="mt-2.5"
                colorClassName="bg-zinc-200 dark:bg-zinc-800"
                textClassName="text-zinc-800 dark:text-zinc-50"
                iconColor={c.text}
              />
            </KeyboardTarget>
          </>
        ) : null}

        {step === 'password' ? (
          <>
            {heading(t('telegram.connect.passwordTitle'), t('telegram.connect.passwordText'))}
            <AppTextInput
              value={password}
              onChangeText={setPassword}
              placeholder={t('telegram.connect.passwordPlaceholder')}
              secureTextEntry
              autoFocus
              onSubmitEditing={() => void submitPassword()}
              containerClassName="mb-3"
            />
            <KeyboardTarget>
              <PrimaryButton
                size="base"
                label={t('telegram.connect.confirm')}
                onPress={() => void submitPassword()}
                loading={busy}
                disabled={password.length === 0}
              />
            </KeyboardTarget>
          </>
        ) : null}
      </KeyboardAwareForm>
    </View>
  );
}
