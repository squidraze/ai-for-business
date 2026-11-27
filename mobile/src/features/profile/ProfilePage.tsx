import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Bell, LogOut, Server, UserX } from 'lucide-react-native';

import { FadeSwitch } from '@/components/FadeSwitch';
import { FeatureBoundary } from '@/components/FeatureBoundary';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAuth, useDeleteAccount } from '@/features/auth';
import { useNotificationPermission } from '@/features/notifications';
import { errorMessage } from '@/lib/api';
import { API_URL, APP_VERSION } from '@/lib/config';
import { reportError } from '@/lib/reportError';
import { SCREEN_PADDING_X, TERTIARY_LABEL_TEXT } from '@/lib/screen';
import { useColors } from '@/lib/theme';

import { CardRows, ProfileCard, ROWS_CARD_RADIUS } from './components/ProfileCard';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { ProfileRow } from './components/ProfileRow';
import { SettingsRow } from './components/SettingsRow';
import { SignInMethods } from './components/SignInMethods';
import { UserCard, UserCardError, UserCardSkeleton } from './components/UserCard';

/**
 * The profile tab, after rooler business's profile screen: the title row over a
 * stack of cards — who you are (with sign-in methods), preferences
 * (notifications, language), app info, then sign out and delete account, and
 * the version at the bottom.
 */
export function ProfilePage() {
  const c = useColors();
  const { t } = useTranslation();
  const { userQuery, signOut } = useAuth();
  const deleteAccount = useDeleteAccount();
  const notifications = useNotificationPermission();

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([userQuery.refetch(), notifications.refresh()]);
    } finally {
      setRefreshing(false);
    }
  }, [userQuery, notifications]);

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

  // The OS owns the permission: "on" asks for it (or opens the settings when it
  // can't be asked again), "off" can only be done in the system settings.
  const toggleNotifications = () => {
    notifications.enable().catch((error: unknown) => reportError(error, { source: 'profile/notifications' }));
  };

  const user = userQuery.data;
  const userState = userQuery.isPending ? 'loading' : user ? 'content' : 'error';

  return (
    // A style, not a class: SafeAreaView comes from a library NativeWind doesn't wrap.
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: c.bg }}>
      <View className="pt-5">
        <ScreenHeader title={t('tabs.profile')} />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: SCREEN_PADDING_X, paddingTop: 12, paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={c.primary}
            colors={[c.primary]}
            progressBackgroundColor={c.card}
          />
        }
      >
        <View className="gap-2">
          {/* Only this card reads the user, so only it shows a failed read: someone
              whose profile won't load still has to be able to sign out. A user in
              hand stays on screen when a refetch over it fails. */}
          <FeatureBoundary name="profile/user" onReset={() => void userQuery.refetch()}>
            <FadeSwitch stateKey={userState}>
              {userState === 'loading' ? (
                <UserCardSkeleton />
              ) : user ? (
                <UserCard user={user} footer={<SignInMethods providers={user.providers} />} />
              ) : (
                <UserCardError
                  message={errorMessage(userQuery.error)}
                  onRetry={() => void userQuery.refetch()}
                />
              )}
            </FadeSwitch>
          </FeatureBoundary>

          <ProfileCard radius={ROWS_CARD_RADIUS}>
            <CardRows>
              {/* Language and theme read no backend data, so it sits outside the boundary:
                  a crash in the notifications row must never hide them. */}
              <LanguageSwitcher />
              <ThemeSwitcher />
              <FeatureBoundary name="profile/notifications">
                <SettingsRow
                  icon={Bell}
                  label={t('profile.notifications')}
                  subtitle={
                    notifications.state === null
                      ? undefined
                      : notifications.enabled
                        ? t('profile.notificationsOn')
                        : t('profile.notificationsOff')
                  }
                  value={notifications.enabled}
                  onChange={toggleNotifications}
                  disabled={notifications.state === null}
                />
              </FeatureBoundary>
            </CardRows>
          </ProfileCard>

          <ProfileCard radius={ROWS_CARD_RADIUS}>
            <ProfileRow icon={Server} label={t('profile.server')} subtitle={API_URL} />
          </ProfileCard>

          <ProfileCard radius={ROWS_CARD_RADIUS}>
            <CardRows>
              <ProfileRow
                icon={LogOut}
                label={t('profile.signOut')}
                destructive
                onPress={confirmSignOut}
                disabled={deleteAccount.isPending}
              />
              <ProfileRow
                icon={UserX}
                label={t('profile.deleteAccount')}
                destructive
                onPress={confirmDelete}
                disabled={deleteAccount.isPending}
                trailing={deleteAccount.isPending ? <ActivityIndicator color={c.danger} /> : undefined}
              />
            </CardRows>
          </ProfileCard>

          <Text className={`pt-2 text-center text-xs ${TERTIARY_LABEL_TEXT}`}>
            {t('profile.appVersion')} {APP_VERSION}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
