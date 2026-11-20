import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button, Card, Separator } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { API_URL, APP_VERSION } from '@/lib/config';
import { useColors } from '@/lib/theme';

export default function ProfileScreen() {
  const c = useColors();
  const { user, signOut } = useAuth();

  const confirmSignOut = () =>
    Alert.alert('Sign out?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card style={{ alignItems: 'center', paddingVertical: 24 }}>
        <Avatar name={user?.name || user?.email || '?'} size={72} />
        <Text style={[styles.name, { color: c.text }]}>{user?.name || '—'}</Text>
        <Text style={{ color: c.muted, fontSize: 15 }}>{user?.email || '—'}</Text>
      </Card>

      <Card style={{ paddingVertical: 4 }}>
        <Row label="Server" value={API_URL} />
        <Separator />
        <Row label="App version" value={APP_VERSION} />
      </Card>

      <Button title="Sign out" variant="danger" icon="log-out-outline" onPress={confirmSignOut} />
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const c = useColors();
  return (
    <View style={styles.row}>
      <Text style={{ color: c.text, fontSize: 15 }}>{label}</Text>
      <Text style={{ color: c.muted, fontSize: 15, flexShrink: 1, marginLeft: 12 }} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: 20, fontWeight: '700', marginTop: 12 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
  },
});
