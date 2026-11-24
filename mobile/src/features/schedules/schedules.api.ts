import { api } from '@/lib/api';

export type ScheduleKind = 'daily' | 'weekly' | 'interval';
export type ScheduleNotify = 'approval' | 'always' | 'never';
export type RunStatus = 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'skipped' | 'cancelled';
export type RunTrigger = 'schedule' | 'manual';

export type ScheduleRun = {
  uuid: string;
  trigger: RunTrigger;
  status: RunStatus;
  skip_reason: 'previous_run_active' | null;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
};

export type Schedule = {
  uuid: string;
  title: string;
  prompt: string;
  kind: ScheduleKind;
  /** "HH:MM" in `timezone`; daily and weekly only. */
  time_of_day: string | null;
  /** 0 = Monday … 6 = Sunday; weekly only. */
  weekdays: number[] | null;
  /** Interval kind only. */
  interval_minutes: number | null;
  timezone: string;
  enabled: boolean;
  notify: ScheduleNotify;
  conversation_uuid: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run: ScheduleRun | null;
  pending_approval: boolean;
  created_at: string;
  updated_at: string;
};

export type ScheduleInput = {
  title: string;
  prompt: string;
  kind: ScheduleKind;
  time_of_day: string | null;
  weekdays: number[] | null;
  interval_minutes: number | null;
  timezone: string;
  enabled: boolean;
  notify: ScheduleNotify;
};

export type RunsPage = { items: ScheduleRun[]; has_more: boolean };

const BASE = '/api/v1/schedules';
const path = (uuid: string) => `${BASE}/${encodeURIComponent(uuid)}`;

export const schedulesApi = {
  list: async (): Promise<Schedule[]> => {
    const { data } = await api.get<{ items: Schedule[] }>(BASE);
    return data.items ?? [];
  },
  get: async (uuid: string): Promise<Schedule> => (await api.get<Schedule>(path(uuid))).data,
  create: async (body: ScheduleInput): Promise<Schedule> => (await api.post<Schedule>(BASE, body)).data,
  update: async (uuid: string, body: Partial<ScheduleInput>): Promise<Schedule> =>
    (await api.patch<Schedule>(path(uuid), body)).data,
  remove: async (uuid: string): Promise<void> => {
    await api.delete(path(uuid));
  },
  run: async (uuid: string): Promise<ScheduleRun> =>
    (await api.post<ScheduleRun>(`${path(uuid)}/run`)).data,
  runs: async (uuid: string, params: { limit: number; before?: string }): Promise<RunsPage> =>
    (await api.get<RunsPage>(`${path(uuid)}/runs`, { params })).data,
  pendingCount: async (): Promise<number> =>
    (await api.get<{ count: number }>(`${BASE}/pending-count`)).data.count ?? 0,
};
