import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { useColors } from '@/lib/theme';

import { passwordChecks } from '../../validation';

/** Live checklist: 8+ characters, a letter, a digit. */
export function PasswordRules({ password }: { password: string }) {
  const c = useColors();
  const { t } = useTranslation();
  const checks = passwordChecks(password);
  const rules = [
    { key: 'length', ok: checks.length, label: t('auth.rules.length') },
    { key: 'letter', ok: checks.letter, label: t('auth.rules.letter') },
    { key: 'digit', ok: checks.digit, label: t('auth.rules.digit') },
  ];
  return (
    <View style={styles.wrap}>
      {rules.map((rule) => (
        <View key={rule.key} style={styles.row} accessible accessibilityState={{ checked: rule.ok }}>
          <Ionicons
            name={rule.ok ? 'checkmark-circle' : 'ellipse-outline'}
            size={16}
            color={rule.ok ? c.success : c.muted}
          />
          <Text style={[styles.text, { color: rule.ok ? c.success : c.muted }]}>{rule.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: -6, marginBottom: 14, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { fontSize: 13, marginLeft: 6 },
});
