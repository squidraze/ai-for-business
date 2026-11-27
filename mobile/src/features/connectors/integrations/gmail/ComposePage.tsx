import { router } from 'expo-router';
import { Send } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, TouchableOpacity, View } from 'react-native';

import { AppTextInput } from '@/components/AppTextInput';
import { KeyboardAwareForm, KeyboardTarget } from '@/components/KeyboardAwareForm';
import { PageHeader } from '@/components/PageHeader';
import { PrimaryButton } from '@/components/PrimaryButton';
import { errorMessage } from '@/lib/api';
import { useColors } from '@/lib/theme';

import { useGmailSend } from './gmail.hooks';

/** A new email: to, cc, subject, body. */
export function GmailComposePage() {
  const c = useColors();
  const { t } = useTranslation();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const sendMail = useGmailSend();
  const sending = sendMail.isPending;

  const canSend = /\S+@\S+/.test(to) && body.trim().length > 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    try {
      await sendMail.mutateAsync({
        to: to.trim(),
        subject: subject.trim(),
        body,
        ...(cc.trim() ? { cc: cc.trim() } : {}),
      });
      router.back();
    } catch (e) {
      Alert.alert(t('gmail.notSent'), errorMessage(e));
    }
  };

  const headerAction = sending ? (
    <ActivityIndicator color={c.primary} />
  ) : (
    <TouchableOpacity
      onPress={() => void send()}
      disabled={!canSend}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={t('gmail.send')}
      style={{ opacity: canSend ? 1 : 0.4 }}
    >
      <Send size={24} color={c.primary} />
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAwareForm
        header={<PageHeader title={t('gmail.newEmail.title')} action={headerAction} />}
        contentContainerStyle={{ padding: 16, gap: 12 }}
      >
        <AppTextInput
          label={t('gmail.newEmail.to')}
          value={to}
          onChangeText={setTo}
          autoCapitalize="none"
          keyboardType="email-address"
          autoFocus
          placeholder={t('gmail.newEmail.toPlaceholder')}
        />
        <AppTextInput
          label={t('gmail.newEmail.cc')}
          value={cc}
          onChangeText={setCc}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <AppTextInput label={t('gmail.newEmail.subject')} value={subject} onChangeText={setSubject} />
        <AppTextInput
          label={t('gmail.newEmail.body')}
          value={body}
          onChangeText={setBody}
          multiline
          placeholder={t('gmail.newEmail.bodyPlaceholder')}
        />
        <KeyboardTarget>
          <PrimaryButton
            size="base"
            label={t('gmail.send')}
            icon={Send}
            onPress={() => void send()}
            disabled={!canSend}
            loading={sending}
          />
        </KeyboardTarget>
      </KeyboardAwareForm>
    </View>
  );
}
