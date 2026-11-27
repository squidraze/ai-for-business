import { useQueryClient } from '@tanstack/react-query';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { Separator } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useColors } from '@/lib/theme';

export { ErrorBoundary } from '@/components/ErrorBoundary';

export default function GmailComposeScreen() {
  const c = useColors();
  const queryClient = useQueryClient();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);

  const canSend = /\S+@\S+/.test(to) && body.trim().length > 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      await api.post('/api/v1/connectors/gmail/send', {
        to: to.trim(),
        subject: subject.trim(),
        body,
        ...(cc.trim() ? { cc: cc.trim() } : {}),
      });
      void queryClient.invalidateQueries({ queryKey: ['gmail', 'threads'] });
      router.back();
    } catch (e) {
      Alert.alert('Not sent', errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const fieldStyle = [styles.field, { color: c.text }];

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.card }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
      <Stack.Screen
        options={{
          headerRight: () => (
            <TouchableOpacity onPress={() => void send()} disabled={!canSend} hitSlop={10}>
              {sending ? (
                <ActivityIndicator color={c.primary} />
              ) : (
                <Text
                  style={{ color: c.primary, fontSize: 16, fontWeight: '600', opacity: canSend ? 1 : 0.4 }}
                >
                  Send
                </Text>
              )}
            </TouchableOpacity>
          ),
        }}
      />
      <ScrollView keyboardShouldPersistTaps="handled">
        <Row label="To">
          <TextInput
            value={to}
            onChangeText={setTo}
            style={fieldStyle}
            autoCapitalize="none"
            keyboardType="email-address"
            autoFocus
            placeholder="name@example.com"
            placeholderTextColor={c.muted}
          />
        </Row>
        <Separator />
        <Row label="Cc">
          <TextInput
            value={cc}
            onChangeText={setCc}
            style={fieldStyle}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholderTextColor={c.muted}
          />
        </Row>
        <Separator />
        <Row label="Subject">
          <TextInput
            value={subject}
            onChangeText={setSubject}
            style={fieldStyle}
            placeholderTextColor={c.muted}
          />
        </Row>
        <Separator />
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          placeholder="Compose email"
          placeholderTextColor={c.muted}
          style={[styles.body, { color: c.text }]}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: c.muted }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  label: { width: 64, fontSize: 15 },
  field: { flex: 1, height: 50, fontSize: 16 },
  body: {
    minHeight: 300,
    padding: 16,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
});
