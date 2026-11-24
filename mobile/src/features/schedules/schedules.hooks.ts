import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { usePushReceived } from '@/features/notifications';
import { PENDING_POLL_MS } from '@/lib/config';

import { schedulesApi, type Schedule, type ScheduleInput } from './schedules.api';

const RUNS_PAGE = 20;
/** While a run is in progress the screens poll for its result. */
const RUNNING_POLL_MS = 5000;

export const scheduleKeys = {
  all: ['schedules'] as const,
  list: () => [...scheduleKeys.all, 'list'] as const,
  detail: (uuid: string) => [...scheduleKeys.all, 'detail', uuid] as const,
  runs: (uuid: string) => [...scheduleKeys.all, 'runs', uuid] as const,
  pendingCount: () => [...scheduleKeys.all, 'pending-count'] as const,
};

/** Refetches everything about schedules (list, details, runs, badge). */
export function invalidateSchedules(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
}

/** Puts a fresh schedule into the detail cache and the list. */
function storeSchedule(queryClient: QueryClient, schedule: Schedule) {
  queryClient.setQueryData(scheduleKeys.detail(schedule.uuid), schedule);
  queryClient.setQueryData<Schedule[]>(scheduleKeys.list(), (list) =>
    list?.map((item) => (item.uuid === schedule.uuid ? schedule : item)),
  );
}

const isRunning = (schedule?: Schedule) => schedule?.last_run?.status === 'running';

export function useSchedules() {
  return useQuery({
    queryKey: scheduleKeys.list(),
    queryFn: schedulesApi.list,
    refetchInterval: (query) => (query.state.data?.some(isRunning) ? RUNNING_POLL_MS : false),
  });
}

export function useSchedule(uuid: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: scheduleKeys.detail(uuid),
    queryFn: () => schedulesApi.get(uuid),
    enabled: !!uuid,
    // Open instantly from the list; the fetch refreshes it.
    placeholderData: () =>
      queryClient.getQueryData<Schedule[]>(scheduleKeys.list())?.find((item) => item.uuid === uuid),
    refetchInterval: (query) => (isRunning(query.state.data) ? RUNNING_POLL_MS : false),
  });
}

export function useScheduleRuns(uuid: string, { poll = false }: { poll?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: scheduleKeys.runs(uuid),
    enabled: !!uuid,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => schedulesApi.runs(uuid, { limit: RUNS_PAGE, before: pageParam }),
    getNextPageParam: (last) =>
      last.has_more && last.items.length > 0 ? last.items[last.items.length - 1].started_at : undefined,
    refetchInterval: poll ? RUNNING_POLL_MS : false,
  });
}

/**
 * Runs waiting for approval (the Tasks tab badge). Polls while the app is in
 * the foreground; refreshes when the app comes back and when a push arrives.
 */
export function usePendingCount() {
  const queryClient = useQueryClient();
  const [active, setActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const isActive = state === 'active';
      setActive(isActive);
      if (isActive) void queryClient.invalidateQueries({ queryKey: scheduleKeys.pendingCount() });
    });
    return () => subscription.remove();
  }, [queryClient]);

  usePushReceived(() => void invalidateSchedules(queryClient));

  return useQuery({
    queryKey: scheduleKeys.pendingCount(),
    queryFn: schedulesApi.pendingCount,
    refetchInterval: active && PENDING_POLL_MS > 0 ? PENDING_POLL_MS : false,
    staleTime: 15_000,
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ScheduleInput) => schedulesApi.create(body),
    onSuccess: (schedule) => {
      queryClient.setQueryData(scheduleKeys.detail(schedule.uuid), schedule);
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.list() });
    },
  });
}

export function useUpdateSchedule(uuid: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<ScheduleInput>) => schedulesApi.update(uuid, body),
    onSuccess: (schedule) => {
      storeSchedule(queryClient, schedule);
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.list() });
    },
  });
}

type ToggleContext = { list?: Schedule[]; detail?: Schedule };

/** Enable/disable right away in the UI; rolls back if the server says no. */
export function useToggleSchedule() {
  const queryClient = useQueryClient();
  return useMutation<Schedule, unknown, { uuid: string; enabled: boolean }, ToggleContext>({
    mutationFn: ({ uuid, enabled }) => schedulesApi.update(uuid, { enabled }),
    onMutate: async ({ uuid, enabled }) => {
      await queryClient.cancelQueries({ queryKey: scheduleKeys.list() });
      await queryClient.cancelQueries({ queryKey: scheduleKeys.detail(uuid) });
      const list = queryClient.getQueryData<Schedule[]>(scheduleKeys.list());
      const detail = queryClient.getQueryData<Schedule>(scheduleKeys.detail(uuid));
      queryClient.setQueryData<Schedule[]>(scheduleKeys.list(), (old) =>
        old?.map((item) => (item.uuid === uuid ? { ...item, enabled } : item)),
      );
      if (detail) queryClient.setQueryData(scheduleKeys.detail(uuid), { ...detail, enabled });
      return { list, detail };
    },
    onError: (_error, { uuid }, context) => {
      if (context?.list) queryClient.setQueryData(scheduleKeys.list(), context.list);
      if (context?.detail) queryClient.setQueryData(scheduleKeys.detail(uuid), context.detail);
    },
    // The server recalculates next_run_at.
    onSuccess: (schedule) => storeSchedule(queryClient, schedule),
  });
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (uuid: string) => schedulesApi.remove(uuid),
    onSuccess: (_data, uuid) => {
      queryClient.setQueryData<Schedule[]>(scheduleKeys.list(), (list) =>
        list?.filter((item) => item.uuid !== uuid),
      );
      queryClient.removeQueries({ queryKey: scheduleKeys.detail(uuid) });
      queryClient.removeQueries({ queryKey: scheduleKeys.runs(uuid) });
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.list() });
      void queryClient.invalidateQueries({ queryKey: scheduleKeys.pendingCount() });
    },
  });
}

export function useRunSchedule(uuid: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => schedulesApi.run(uuid),
    onSuccess: (run) => {
      // Show the new run at once; the polling picks up its result.
      queryClient.setQueryData<Schedule>(scheduleKeys.detail(uuid), (old) =>
        old ? { ...old, last_run: run, last_run_at: run.started_at } : old,
      );
      void invalidateSchedules(queryClient);
    },
  });
}
