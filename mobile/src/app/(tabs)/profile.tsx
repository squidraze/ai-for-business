import { ProfilePage } from '@/features/profile';
import { TabFade } from '@/components/TabFade';

export { ErrorBoundary } from '@/components/ErrorBoundary';

export default function ProfileScreen() {
  return (
    <TabFade>
      <ProfilePage />
    </TabFade>
  );
}
