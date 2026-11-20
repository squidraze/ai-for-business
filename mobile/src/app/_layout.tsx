import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LoadingView } from '@/components/ui';
import { AuthProvider, useAuth } from '@/lib/auth';
import { useColors } from '@/lib/theme';

function RootStack() {
  const { status } = useAuth();
  const c = useColors();
  const segments = useSegments();
  const router = useRouter();
  const navReady = !!useRootNavigationState()?.key;
  const signedIn = status === 'signedIn';
  const inAuth = segments[0] === '(auth)';

  // Stack.Protected left "/" unmatched when signed out, so route explicitly.
  useEffect(() => {
    if (status === 'loading' || !navReady) return;
    if (!signedIn && !inAuth) router.replace('/sign-in');
    else if (signedIn && inAuth) router.replace('/');
  }, [status, signedIn, inAuth, navReady, router]);

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: c.bg }}>
        <LoadingView />
      </View>
    );
  }

  return (
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
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
    </Stack>
  );
}

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
