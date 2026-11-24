import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { useColors } from '@/lib/theme';

/** ——— or ——— between the form and the social buttons. */
export function OrDivider() {
  const c = useColors();
  const { t } = useTranslation();
  return (
    <View style={styles.divider}>
      <View style={[styles.line, { backgroundColor: c.border }]} />
      <Text style={[styles.or, { color: c.muted }]}>{t('auth.or')}</Text>
      <View style={[styles.line, { backgroundColor: c.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  line: { flex: 1, height: StyleSheet.hairlineWidth },
  or: { marginHorizontal: 12, fontSize: 13 },
});
