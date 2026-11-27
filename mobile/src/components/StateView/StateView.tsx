import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button, type IconName } from '@/components/Button';
import { useColors } from '@/lib/theme';

export function CenterView({ children }: { children: ReactNode }) {
  return <View style={styles.center}>{children}</View>;
}

export function LoadingView() {
  const c = useColors();
  return (
    <CenterView>
      <ActivityIndicator color={c.primary} size="large" />
    </CenterView>
  );
}

export function ErrorView({
  message,
  onRetry,
  title,
  icon = 'cloud-offline-outline',
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
  icon?: IconName;
}) {
  const c = useColors();
  const { t } = useTranslation();
  return (
    <CenterView>
      <Ionicons name={icon} size={44} color={c.muted} />
      <Text style={[styles.title, { color: c.text }]}>{title ?? t('states.errorTitle')}</Text>
      <Text style={[styles.text, { color: c.muted }]}>{message}</Text>
      {onRetry ? (
        <Button
          title={t('common.retry')}
          icon="refresh"
          onPress={onRetry}
          style={{ marginTop: 16, minWidth: 140 }}
        />
      ) : null}
    </CenterView>
  );
}

export function EmptyView({
  icon,
  title,
  description,
  children,
}: {
  icon: IconName;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  const c = useColors();
  return (
    <CenterView>
      <Ionicons name={icon} size={44} color={c.muted} />
      <Text style={[styles.title, { color: c.text }]}>{title}</Text>
      {description ? <Text style={[styles.text, { color: c.muted }]}>{description}</Text> : null}
      {children}
    </CenterView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 17, fontWeight: '600', marginTop: 12, textAlign: 'center' },
  text: { fontSize: 14, marginTop: 6, textAlign: 'center' },
});
