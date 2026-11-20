import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { Button, Field } from '@/components/ui';
import { api, CONNECTORS_KEY, errorMessage } from '@/lib/api';
import { useColors } from '@/lib/theme';

type Step = 'phone' | 'code' | 'password';

export default function TelegramConnectScreen() {
  const c = useColors();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [hash, setHash] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: CONNECTORS_KEY });
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
      const { data } = await api.post<{ phone_code_hash: string }>(
        '/api/v1/connectors/telegram/send-code',
        { phone: normalized },
      );
      setPhone(normalized);
      setHash(data.phone_code_hash);
      setStep('code');
    });

  const signIn = () =>
    run(async () => {
      const { data } = await api.post<{ status: 'ok' | 'password_required' }>(
        '/api/v1/connectors/telegram/sign-in',
        { phone, code: code.trim(), phone_code_hash: hash },
      );
      if (data.status === 'password_required') setStep('password');
      else await done();
    });

  const submitPassword = () =>
    run(async () => {
      await api.post('/api/v1/connectors/telegram/password', { password });
      await done();
    });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: c.bg }}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {step === 'phone' ? (
          <>
            <Text style={[styles.title, { color: c.text }]}>Your phone number</Text>
            <Text style={[styles.text, { color: c.muted }]}>
              Telegram will send a login code to your Telegram app.
            </Text>
            <Field
              value={phone}
              onChangeText={setPhone}
              placeholder="+1 555 123 4567"
              keyboardType="phone-pad"
              autoComplete="tel"
              autoFocus
              onSubmitEditing={() => void sendCode()}
            />
            <Button
              title="Send code"
              onPress={() => void sendCode()}
              loading={busy}
              disabled={phone.replace(/\D/g, '').length < 6}
            />
          </>
        ) : null}

        {step === 'code' ? (
          <>
            <Text style={[styles.title, { color: c.text }]}>Enter the code</Text>
            <Text style={[styles.text, { color: c.muted }]}>
              We sent a code to the Telegram app on your other devices ({phone}).
            </Text>
            <Field
              value={code}
              onChangeText={setCode}
              placeholder="12345"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              autoFocus
              onSubmitEditing={() => void signIn()}
            />
            <Button
              title="Sign in"
              onPress={() => void signIn()}
              loading={busy}
              disabled={code.trim().length < 4}
            />
            <Button
              title="Change number"
              variant="secondary"
              onPress={() => {
                setStep('phone');
                setCode('');
                setError(null);
              }}
              style={{ marginTop: 10 }}
            />
          </>
        ) : null}

        {step === 'password' ? (
          <>
            <Text style={[styles.title, { color: c.text }]}>Two-step verification</Text>
            <Text style={[styles.text, { color: c.muted }]}>
              Your account is protected with an additional password.
            </Text>
            <Field
              value={password}
              onChangeText={setPassword}
              placeholder="Cloud password"
              secureTextEntry
              autoFocus
              onSubmitEditing={() => void submitPassword()}
            />
            <Button
              title="Confirm"
              onPress={() => void submitPassword()}
              loading={busy}
              disabled={password.length === 0}
            />
          </>
        ) : null}

        {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  text: { fontSize: 15, marginBottom: 20 },
  error: { fontSize: 14, marginTop: 14 },
});
