import { SchedulesPage } from '@/features/schedules';
import { TabFade } from '@/components/TabFade';

export { ErrorBoundary } from '@/components/ErrorBoundary';

export default function SchedulesScreen() {
  return (
    <TabFade>
      <SchedulesPage />
    </TabFade>
  );
}
