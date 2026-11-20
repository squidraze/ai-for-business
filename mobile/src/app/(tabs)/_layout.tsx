import { Ionicons } from '@expo/vector-icons';
import Tabs from 'expo-router/js-tabs';

import { useColors } from '@/lib/theme';

export default function TabsLayout() {
  const c = useColors();
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
          title: 'Chats',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubbles-outline" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="connectors"
        options={{
          title: 'Connectors',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="extension-puzzle-outline" color={color as string} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-circle-outline" color={color as string} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}
