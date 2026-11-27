import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Tabs from 'expo-router/js-tabs';

import { usePendingCount } from '@/features/schedules';
import { useColors } from '@/lib/theme';

export { ErrorBoundary } from '@/components/ErrorBoundary';

export default function TabsLayout() {
  const c = useColors();
  const { t } = useTranslation();
  // Task runs waiting for the user's approval.
  const pending = usePendingCount().data ?? 0;
  const pendingBadge = pending > 0 ? (pending > 99 ? '99+' : pending) : undefined;
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: c.card },
        headerTintColor: c.text,
        headerShadowVisible: false,
        headerTitleStyle: { fontSize: 22, fontWeight: '700' },
        headerTitleAlign: 'left',
        tabBarStyle: { backgroundColor: c.card, borderTopColor: c.border },
        tabBarActiveTintColor: c.primary,
        tabBarInactiveTintColor: c.muted,
        sceneStyle: { backgroundColor: c.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.chats'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles-outline" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="schedules"
        options={{
          title: t('tabs.schedules'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="alarm-outline" color={color as string} size={size} />
          ),
          tabBarBadge: pendingBadge,
          tabBarBadgeStyle: { backgroundColor: c.warning, color: '#ffffff' },
        }}
      />
      <Tabs.Screen
        name="connectors"
        options={{
          title: t('tabs.connectors'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="extension-puzzle-outline" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" color={color as string} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
