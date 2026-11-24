import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareForm } from '@/components/KeyboardAwareForm';
import { useColors } from '@/lib/theme';

/** Logo, title and a keyboard-aware scroll for every auth screen. */
export function AuthLayout({
  title,
  subtitle,
  onBack,
  backLabel,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Shows a back arrow in the top-left corner. */
  onBack?: () => void;
  backLabel?: string;
  /** Pinned under the form (links, server info). */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const c = useColors();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <KeyboardAwareForm
        header={
          onBack ? (
            <View style={styles.header}>
              <TouchableOpacity
                onPress={onBack}
                hitSlop={10}
                style={styles.back}
                accessibilityRole="button"
                accessibilityLabel={backLabel}
              >
                <Ionicons name="chevron-back" size={26} color={c.text} />
              </TouchableOpacity>
            </View>
          ) : null
        }
        contentContainerStyle={[styles.container, onBack ? styles.containerWithHeader : null]}
      >
        <View style={[styles.logo, { backgroundColor: c.primary }]}>
          <Ionicons name="sparkles" size={30} color="#fff" />
        </View>
        <Text style={[styles.title, { color: c.text }]} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={[styles.subtitle, { color: c.muted }]}>{subtitle}</Text> : null}
        <View style={styles.body}>{children}</View>
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAwareForm>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { height: 48, justifyContent: 'center', paddingHorizontal: 12 },
  back: { padding: 4, alignSelf: 'flex-start' },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, paddingTop: 56 },
  containerWithHeader: { paddingTop: 8 },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 26, fontWeight: '700', textAlign: 'center' },
  subtitle: { fontSize: 15, textAlign: 'center', marginTop: 6, lineHeight: 21 },
  body: { marginTop: 28 },
  footer: { marginTop: 24, gap: 14 },
});
