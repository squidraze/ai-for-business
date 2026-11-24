import { router } from 'expo-router';

import type { Schedule } from './schedules.api';

/** The task's conversation opens in the regular chat screen. */
export function openScheduleChat(schedule: Pick<Schedule, 'conversation_uuid' | 'title'>) {
  router.push({
    pathname: '/chat/[id]',
    params: { id: schedule.conversation_uuid, title: schedule.title },
  });
}

export function openSchedule(uuid: string) {
  router.push({ pathname: '/schedules/[id]', params: { id: uuid } });
}

export function openScheduleEdit(uuid: string) {
  router.push({ pathname: '/schedules/[id]/edit', params: { id: uuid } });
}

export function openNewSchedule() {
  router.push('/schedules/new');
}
