import type { LucideIcon } from 'lucide-react-native';
import { CloudOff, RotateCw } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
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
  icon: Icon = CloudOff,
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
  /** Lucide icon component, e.g. `icon={TriangleAlert}`. */
  icon?: LucideIcon;
}) {
  const c = useColors();
  const { t } = useTranslation();
  return (
    <CenterView>
      <Icon size={44} color={c.muted} strokeWidth={1.75} />
      <Text style={[styles.title, { color: c.text }]}>{title ?? t('states.errorTitle')}</Text>
      <Text style={[styles.text, { color: c.muted }]}>{message}</Text>
      {onRetry ? (
        <PrimaryButton
          label={t('common.retry')}
          icon={RotateCw}
          size="md"
          onPress={onRetry}
          className="mt-4 min-w-[140px] px-5"
        />
      ) : null}
    </CenterView>
  );
}

export function EmptyView({
  icon: Icon,
  title,
  description,
  children,
}: {
  /** Lucide icon component, e.g. `icon={Mail}`. */
  icon: LucideIcon;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  const c = useColors();
  return (
    <CenterView>
      <Icon size={44} color={c.muted} strokeWidth={1.75} />
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
