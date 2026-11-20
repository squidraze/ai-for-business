/**
 * Who the signed-in person is in the open company: their role and permissions.
 *
 * Only the new-chat screen needs it — the starter chips are chosen by role and a
 * chip is never offered for data the person cannot read. It is read from the
 * same place the web client's `useMe` reads it: `GET /auth/me/context`. Two
 * shapes are read: the organization backend's — one `role` and one
 * `permissions` list for the whole organization — and the older one, whose
 * memberships carry role and permissions per company, picking the company the
 * host put in `init`. Over the bridge like every other call, so no
 * new protocol message was needed for it.
 */
import { useSyncExternalStore } from 'react';

import { api } from '@/lib/api/client';
import { logger } from '@/lib/logger';

const log = logger.child('access');

export type AccessState = {
  /** `undefined` until known — and stays so if the read fails: hide nothing then. */
  role: string | null | undefined;
  permissions: readonly string[] | undefined;
};

type MeContext = {
  /** Pre-organization backend: one entry per company. */
  memberships?: { company_id?: string; role?: string; permissions?: unknown }[];
  /** Organization backend: one role and one list for the whole organization. */
  role?: { slug?: string | null; name?: string } | null;
  permissions?: unknown;
};

let state: AccessState = { role: undefined, permissions: undefined };
const listeners = new Set<() => void>();

function commit(next: AccessState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

/** Read once per session, from `init`. A failure leaves everything visible. */
export async function loadAccess(companyId: string): Promise<void> {
  try {
    const { data } = await api().get<MeContext>('/api/v1/auth/me/context');
    const membership = data?.role
      ? { role: data.role.slug ?? data.role.name, permissions: data.permissions }
      : data?.memberships?.find((entry) => entry.company_id === companyId);
    if (!membership) {
      log.warn('no membership for the open company — starters stay unfiltered', { companyId });
      return;
    }
    const permissions = Array.isArray(membership.permissions)
      ? membership.permissions.filter((entry): entry is string => typeof entry === 'string')
      : undefined;
    commit({ role: membership.role ?? null, permissions });
    log.info('access read', { role: membership.role, permissions: permissions?.length ?? 0 });
  } catch (error) {
    log.warn('could not read the role — starters stay unfiltered', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): AccessState => state;

export function useAccess(): AccessState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
