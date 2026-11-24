import '@/lib/i18n';

import { Ionicons } from '@expo/vector-icons';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FadeSwitch } from '@/components/FadeSwitch';
import { SplashSkeleton } from '@/components/Skeleton';
import { AuthProvider, useAuth } from '@/features/auth';
import { usePushNotifications } from '@/features/notifications';
import { useColors } from '@/lib/theme';

function RootStack() {
  const { status } = useAuth();
  const c = useColors();
  const { t } = useTranslation();
  const segments = useSegments();
  const router = useRouter();
  const navReady = !!useRootNavigationState()?.key;
  const signedIn = status === 'signedIn';
  const inAuth = segments[0] === '(auth)';

  usePushNotifications({ navReady: navReady && status !== 'loading' });

  // Stack.Protected left "/" unmatched when signed out, so route explicitly.
  useEffect(() => {
    if (status === 'loading' || !navReady) return;
    if (!signedIn && !inAuth) router.replace('/sign-in');
    else if (signedIn && inAuth) router.replace('/');
  }, [status, signedIn, inAuth, navReady, router]);

  // Checking the saved session: a skeleton splash that cross-fades into the app.
  return (
    <FadeSwitch stateKey={status === 'loading' ? 'splash' : 'app'} appear style={{ backgroundColor: c.bg }}>
      {status === 'loading' ? (
        <SplashSkeleton
          logo={
            <View style={[styles.logo, { backgroundColor: c.primary }]}>
              <Ionicons name="sparkles" size={30} color="#fff" />
            </View>
          }
        />
      ) : (
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: c.card },
            headerTintColor: c.text,
            headerTitleStyle: { color: c.text },
            contentStyle: { backgroundColor: c.bg },
            headerShadowVisible: false,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="chat/[id]" options={{ headerShown: false }} />
          <Stack.Screen name="telegram/connect" options={{ title: 'Connect Telegram' }} />
          <Stack.Screen name="telegram/index" options={{ title: 'Telegram' }} />
          <Stack.Screen name="telegram/[chatId]" options={{ title: '' }} />
          <Stack.Screen name="gmail/index" options={{ title: 'Inbox' }} />
          <Stack.Screen name="gmail/[threadId]" options={{ title: '' }} />
          <Stack.Screen name="gmail/compose" options={{ title: 'New email' }} />
          <Stack.Screen name="bitrix/index" options={{ title: 'CRM' }} />
          <Stack.Screen name="bitrix/[entity]/[id]" options={{ title: '' }} />
          <Stack.Screen name="schedules/new" options={{ title: t('schedules.newTitle') }} />
          <Stack.Screen name="schedules/[id]/index" options={{ title: '' }} />
          <Stack.Screen name="schedules/[id]/edit" options={{ title: t('schedules.editTitle') }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        </Stack>
      )}
    </FadeSwitch>
  );
}

const styles = StyleSheet.create({
  logo: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
      }),
  );
  const c = useColors();
  const navTheme = c.scheme === 'dark' ? DarkTheme : DefaultTheme;

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider
          value={{
            ...navTheme,
            colors: {
              ...navTheme.colors,
              background: c.bg,
              card: c.card,
              text: c.text,
              border: c.border,
              primary: c.primary,
            },
          }}
        >
          <AuthProvider>
            <StatusBar style={c.scheme === 'dark' ? 'light' : 'dark'} />
            <RootStack />
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
