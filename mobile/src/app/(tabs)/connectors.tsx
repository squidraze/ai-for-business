import { ConnectorsPage } from '@/features/connectors';
import { TabFade } from '@/components/TabFade';

export { ErrorBoundary } from '@/components/ErrorBoundary';

export default function ConnectorsScreen() {
  return (
    <TabFade>
      <ConnectorsPage />
    </TabFade>
  );
}
