import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';

import { API_URL } from '@/lib/config';
import { useColors } from '@/lib/theme';

/** Which backend this build talks to (handy in the demo). */
export function ServerHint() {
  const c = useColors();
  const { t } = useTranslation();
  return <Text style={[styles.server, { color: c.muted }]}>{t('auth.server', { url: API_URL })}</Text>;
}

const styles = StyleSheet.create({
  server: { textAlign: 'center', fontSize: 12 },
});
