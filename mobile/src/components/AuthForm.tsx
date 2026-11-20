import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button, Field } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { API_URL } from '@/lib/config';
import { useColors } from '@/lib/theme';

export function AuthForm({ mode }: { mode: 'signIn' | 'register' }) {
  const c = useColors();
  const { signIn, register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRegister = mode === 'register';
  const canSubmit =
    email.trim().length > 3 && password.length > 0 && (!isRegister || name.trim().length > 0);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isRegister) await register(email.trim(), password, name.trim());
      else await signIn(email.trim(), password);
    } catch (e) {
      setError(errorMessage(e, isRegister ? 'Registration failed' : 'Sign in failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={[styles.logo, { backgroundColor: c.primary }]}>
            <Ionicons name="sparkles" size={32} color="#fff" />
          </View>
          <Text style={[styles.title, { color: c.text }]}>forBusiness</Text>
          <Text style={[styles.subtitle, { color: c.muted }]}>
            {isRegister ? 'Create your account' : 'Sign in to your AI assistant'}
          </Text>

          {isRegister ? (
            <Field
              label="Name"
              value={name}
              onChangeText={setName}
              placeholder="Jane Doe"
              autoComplete="name"
            />
          ) : null}
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@company.com"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            autoComplete={isRegister ? 'new-password' : 'password'}
            onSubmitEditing={() => void submit()}
          />

          {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}

          <Button
            title={isRegister ? 'Create account' : 'Sign in'}
            onPress={() => void submit()}
            loading={busy}
            disabled={!canSubmit}
            style={{ marginTop: 8 }}
          />

          <TouchableOpacity
            onPress={() => router.replace(isRegister ? '/sign-in' : '/register')}
            hitSlop={8}
          >
            <Text style={[styles.switch, { color: c.primary }]}>
              {isRegister ? 'Already have an account? Sign in' : 'No account? Create one'}
            </Text>
          </TouchableOpacity>

          <Text style={[styles.server, { color: c.muted }]}>Server: {API_URL}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 15, textAlign: 'center', marginTop: 6, marginBottom: 28 },
  error: { fontSize: 14, marginBottom: 8 },
  switch: { textAlign: 'center', marginTop: 20, fontSize: 15, fontWeight: '500' },
  server: { textAlign: 'center', marginTop: 24, fontSize: 12 },
});
