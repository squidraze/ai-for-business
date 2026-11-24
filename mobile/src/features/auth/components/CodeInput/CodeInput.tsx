import { useState, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { useColors } from '@/lib/theme';

import { CODE_LENGTH } from '../../validation';
import type { TextInputRef } from '@/components/TextField';

/**
 * Six cells backed by one transparent TextInput laid over them. One input
 * means typing advances by itself, backspace goes back, and paste / SMS-email
 * autofill of the whole code just works.
 */
export function CodeInput({
  value,
  onChangeText,
  onComplete,
  error,
  disabled,
  autoFocus,
  ref,
}: {
  value: string;
  onChangeText: (value: string) => void;
  /** Called once all digits are entered. */
  onComplete?: (code: string) => void;
  error?: string | null;
  disabled?: boolean;
  autoFocus?: boolean;
  ref?: Ref<TextInputRef>;
}) {
  const c = useColors();
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);

  const change = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH);
    onChangeText(digits);
    if (digits.length === CODE_LENGTH && digits !== value) onComplete?.(digits);
  };

  const active = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <View style={styles.wrap}>
      <View style={styles.cells}>
        {Array.from({ length: CODE_LENGTH }).map((_, index) => {
          const digit = value[index] ?? '';
          const isActive = focused && index === active;
          const borderColor = error ? c.danger : isActive ? c.primary : digit ? c.muted : c.border;
          return (
            <View
              key={index}
              style={[
                styles.cell,
                { backgroundColor: c.inputBg, borderColor, borderWidth: isActive ? 2 : 1 },
              ]}
            >
              <Text style={[styles.digit, { color: c.text }]}>{digit}</Text>
            </View>
          );
        })}
        <TextInput
          ref={ref}
          value={value}
          onChangeText={change}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={!disabled}
          autoFocus={autoFocus}
          keyboardType="number-pad"
          inputMode="numeric"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={CODE_LENGTH}
          caretHidden
          selectTextOnFocus={false}
          contextMenuHidden={false}
          accessibilityLabel={t('auth.fields.code')}
          style={styles.hiddenInput}
        />
      </View>
      {error ? (
        <Text style={[styles.error, { color: c.danger }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  cells: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  cell: {
    flex: 1,
    height: 56,
    maxWidth: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digit: { fontSize: 24, fontWeight: '700' },
  // Nearly invisible but still hit-testable, so a tap on any cell focuses it.
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.02,
    color: 'transparent',
    fontSize: 1,
  },
  error: { fontSize: 13, marginTop: 8, textAlign: 'center' },
});
