import { ChatsPage } from '@/features/chat';
import { TabFade } from '@/components/TabFade';

export { ErrorBoundary } from '@/components/ErrorBoundary';

export default function ChatsScreen() {
  return (
    <TabFade>
      <ChatsPage />
    </TabFade>
  );
}
