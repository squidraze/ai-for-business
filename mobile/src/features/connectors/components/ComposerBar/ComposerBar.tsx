import { ArrowUp } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/PrimaryButton';
import { useColors } from '@/lib/theme';

export interface ComposerBarProps {
  value: string;
  onChangeText: (value: string) => void;
  onSend: () => void;
  sending?: boolean;
  placeholder?: string;
}

/**
 * The bottom bar of a conversation-like screen (a Telegram chat, CRM comments):
 * a growing text field and Send. A raw `TextInput` is allowed here because it is
 * a chat composer (CLAUDE.md).
 */
export function ComposerBar({ value, onChangeText, onSend, sending = false, placeholder }: ComposerBarProps) {
  const c = useColors();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        { backgroundColor: c.card, borderTopColor: c.border, paddingBottom: Math.max(insets.bottom, 8) },
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        multiline
        editable={!sending}
        style={[styles.input, { backgroundColor: c.inputBg, color: c.text }]}
      />
      <PrimaryButton
        size="xs"
        label={t('connectors.send')}
        icon={ArrowUp}
        onPress={onSend}
        disabled={!value.trim()}
        loading={sending}
        className="ml-2 px-3"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 16,
  },
});
