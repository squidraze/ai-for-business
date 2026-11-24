import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { AsyncState } from '@/components/AsyncState';
import { Button } from '@/components/Button';
import { Skeleton } from '@/components/Skeleton';
import { Avatar, Card, Separator } from '@/components/ui';
import { useAuth, useDeleteAccount, type AuthProviderId, type User } from '@/features/auth';
import { useNotificationPermission } from '@/features/notifications';
import { errorMessage } from '@/lib/api';
import { API_URL, APP_VERSION } from '@/lib/config';
import { currentLanguage, LANGUAGES, setLanguage } from '@/lib/i18n';
import { useColors } from '@/lib/theme';

const PROVIDER_ICONS: Record<AuthProviderId, 'mail-outline' | 'logo-google' | 'logo-apple'> = {
  password: 'mail-outline',
  google: 'logo-google',
  apple: 'logo-apple',
};

export function ProfilePage() {
  const c = useColors();
  const { t } = useTranslation();
  const { userQuery, signOut } = useAuth();
  const deleteAccount = useDeleteAccount();
  const language = currentLanguage();
  const notifications = useNotificationPermission();

  const confirmSignOut = () =>
    Alert.alert(t('profile.signOutConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('profile.signOut'), style: 'destructive', onPress: () => void signOut() },
    ]);

  const confirmDelete = () =>
    Alert.alert(t('profile.deleteConfirmTitle'), t('profile.deleteConfirmText'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('profile.deleteAccount'),
        style: 'destructive',
        // Success signs out; the root layout then shows the sign-in screen.
        onPress: () =>
          deleteAccount.mutate(undefined, {
            onError: (error) => Alert.alert(t('profile.deleteFailed'), errorMessage(error)),
          }),
      },
    ]);

  const pickLanguage = () =>
    Alert.alert(t('profile.language'), undefined, [
      ...LANGUAGES.map((code) => ({
        text: `${t(`languages.${code}`)}${code === language ? '  ✓' : ''}`,
        onPress: () => void setLanguage(code),
      })),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <AsyncState query={userQuery} skeleton={<UserCardSkeleton />}>
        {() => (userQuery.data ? <UserCards user={userQuery.data} /> : null)}
      </AsyncState>

      <Card style={{ paddingVertical: 4 }}>
        <TouchableOpacity onPress={pickLanguage} accessibilityRole="button">
          <Row label={t('profile.language')} value={t(`languages.${language}`)} chevron />
        </TouchableOpacity>
        <Separator />
        <TouchableOpacity
          onPress={() => void notifications.enable()}
          accessibilityRole="button"
          accessibilityHint={notifications.enabled ? undefined : t('profile.notificationsEnableHint')}
        >
          <Row
            label={t('profile.notifications')}
            value={
              notifications.state === null
                ? ''
                : notifications.enabled
                  ? t('profile.notificationsOn')
                  : t('profile.notificationsOff')
            }
            chevron
          />
        </TouchableOpacity>
        <Separator />
        <Row label={t('profile.server')} value={API_URL} />
        <Separator />
        <Row label={t('profile.appVersion')} value={APP_VERSION} />
      </Card>

      <Button
        title={t('profile.signOut')}
        variant="secondary"
        icon="log-out-outline"
        onPress={confirmSignOut}
        disabled={deleteAccount.isPending}
      />
      <Button
        title={t('profile.deleteAccount')}
        variant="danger"
        icon="trash-outline"
        onPress={confirmDelete}
        loading={deleteAccount.isPending}
      />
    </ScrollView>
  );
}

function UserCards({ user }: { user: User }) {
  const c = useColors();
  const { t } = useTranslation();
  const providers = user.providers ?? [];
  return (
    <View style={{ gap: 16 }}>
      <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
        <Avatar name={user.name || user.email} size={72} />
        <Text style={[styles.name, { color: c.text }]}>{user.name}</Text>
        <Text style={{ color: c.muted, fontSize: 15 }}>{user.email}</Text>
        <View style={[styles.badge, { backgroundColor: user.email_verified ? c.successBg : c.inputBg }]}>
          <Ionicons
            name={user.email_verified ? 'checkmark-circle' : 'alert-circle-outline'}
            size={14}
            color={user.email_verified ? c.success : c.muted}
          />
          <Text style={[styles.badgeText, { color: user.email_verified ? c.success : c.muted }]}>
            {user.email_verified ? t('profile.verified') : t('profile.notVerified')}
          </Text>
        </View>
      </Card>

      {providers.length > 0 ? (
        <Card style={{ paddingVertical: 4 }}>
          <Text style={[styles.section, { color: c.muted }]}>{t('profile.signInMethods')}</Text>
          {providers.map((provider, index) => (
            <View key={provider}>
              {index > 0 ? <Separator /> : null}
              <View style={styles.provider}>
                <Ionicons name={PROVIDER_ICONS[provider] ?? 'key-outline'} size={18} color={c.text} />
                <Text style={[styles.providerText, { color: c.text }]}>
                  {t(`profile.providers.${provider}`, { defaultValue: provider })}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

function UserCardSkeleton() {
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
      <Skeleton width={72} height={72} radius={36} />
      <Skeleton width={140} height={18} radius={9} style={{ marginTop: 14 }} />
      <Skeleton width={190} height={13} style={{ marginTop: 10 }} />
      <Skeleton width={90} height={22} radius={11} style={{ marginTop: 12 }} />
    </Card>
  );
}

function Row({ label, value, chevron }: { label: string; value: string; chevron?: boolean }) {
  const c = useColors();
  return (
    <View style={styles.row}>
      <Text style={{ color: c.text, fontSize: 15 }}>{label}</Text>
      <View style={styles.rowValue}>
        <Text style={{ color: c.muted, fontSize: 15, flexShrink: 1 }} numberOfLines={1}>
          {value}
        </Text>
        {chevron ? <Ionicons name="chevron-forward" size={16} color={c.muted} style={{ marginLeft: 4 }} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 20, fontWeight: '700', marginTop: 12 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 10,
  },
  badgeText: { fontSize: 12, fontWeight: '600', marginLeft: 4 },
  section: { fontSize: 13, fontWeight: '600', paddingTop: 10, paddingBottom: 4 },
  provider: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  providerText: { fontSize: 15, marginLeft: 10 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
  rowValue: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, marginLeft: 12 },
});
