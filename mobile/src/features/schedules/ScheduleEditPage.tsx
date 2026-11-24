import { useLocalSearchParams } from 'expo-router';

import { AsyncState } from '@/components/AsyncState';
import { ErrorView } from '@/components/StateView';
import { errorMessage, parseApiError } from '@/lib/api';

import { ScheduleForm, ScheduleFormSkeleton } from './components/ScheduleForm';
import { ScheduleNotFound } from './components/ScheduleNotFound';
import { useSchedule } from './schedules.hooks';

/** `/schedules/new` (no id) and `/schedules/[id]/edit`. */
export function ScheduleEditPage() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (!id) return <ScheduleForm />;
  return <EditExisting uuid={id} />;
}

function EditExisting({ uuid }: { uuid: string }) {
  const query = useSchedule(uuid);
  return (
    <AsyncState
      query={query}
      // Edit the server's current version, not the list's cached copy.
      loading={query.isPlaceholderData}
      skeleton={<ScheduleFormSkeleton />}
      error={(error, retry) =>
        parseApiError(error).status === 404 ? (
          <ScheduleNotFound />
        ) : (
          <ErrorView message={errorMessage(error)} onRetry={retry} />
        )
      }
    >
      {/* Keyed by uuid so a background refetch never resets what the user is typing. */}
      {() => (query.data ? <ScheduleForm key={query.data.uuid} schedule={query.data} /> : null)}
    </AsyncState>
  );
}
