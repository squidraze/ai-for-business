import { Stack } from 'expo-router';

import { useColors } from '@/lib/theme';

export { ErrorBoundary } from '@/components/ErrorBoundary';

export default function AuthLayout() {
  const c = useColors();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="register" />
      <Stack.Screen name="verify-email" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="reset-password" />
    </Stack>
  );
}
