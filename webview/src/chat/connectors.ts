/**
 * The "+" menu's Connectors switches: which connected outside apps (Google
 * Calendar, QuickBooks, Notion…) the assistant may use in this conversation.
 *
 * The same rules as the native screen (`Connectors/connectors.hooks.ts`,
 * `realtime/connectorSelection.ts`) and the web client (`use-chat-connectors.ts`):
 *
 * - **One switch per app**, not per connection: the backend turns an integration
 *   id off for the whole conversation, and picks the account itself when an app
 *   is connected twice. `active` connections only, and never `telegram-bot` /
 *   `relay_fuel`, which the assistant does not use (backend answer, 2026-10-15).
 * - **Where the switched-off ids live**: an existing conversation keeps them on
 *   itself (`disabled_connectors`) and every flip PATCHes the **whole** list; a
 *   new chat has no conversation yet, so the list waits here and goes out with
 *   the first message. Every flip also lands here, so the next new chat starts
 *   with the person's last choice — remembered across launches in
 *   `localStorage` (`ai-chat:disabled-connectors`, the web client's key).
 * - It applies from the agent's next tool call.
 */
import { useSyncExternalStore } from 'react';

import { getConversation, listActiveConnections, updateConversation } from '@/lib/api/ai';
import type { ConnectionRead } from '@/lib/api/types';
import { logger } from '@/lib/logger';

import { getState } from './store';

const log = logger.child('connectors');

const STORAGE_KEY = 'ai-chat:disabled-connectors';
const ACTIVE = 'active';
/** Connections the assistant never uses — a switch for them would do nothing. */
const NOT_FOR_ASSISTANT = new Set(['telegram-bot', 'relay_fuel']);

export type Connector = {
  /** The integration id — what `disabled_connectors` holds. */
  id: string;
  name: string;
  enabled: boolean;
};

export type ConnectorsState = {
  status: 'idle' | 'loading' | 'error' | 'ready';
  error: unknown;
  connectors: Connector[];
  /** A flip is in flight — the switches are locked so two PATCHes cannot race. */
  saving: boolean;
};

/** Deduplicated and sorted, so two lists that mean the same compare equal. */
function normalize(ids: readonly unknown[]): string[] {
  return Array.from(
    new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)),
  ).sort();
}

/* ---------------------------------------------------------------- */
/* The next new chat's list                                          */
/* ---------------------------------------------------------------- */

/** Storage can be absent or throw (a private window, blocked site data). */
function readStored(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? normalize(parsed) : [];
  } catch {
    return [];
  }
}

let pendingNew: string[] = readStored();

function setPendingNew(ids: string[]): void {
  pendingNew = normalize(ids);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pendingNew));
  } catch {
    // A convenience, not state anyone else reads — losing it costs one choice.
  }
}

/** The ids to send as the first message's `disabled_connectors`. */
export function getPendingDisabledConnectors(): string[] {
  return pendingNew;
}

/* ---------------------------------------------------------------- */
/* The switches                                                      */
/* ---------------------------------------------------------------- */

let rows: ConnectionRead[] = [];
/** The open conversation's list, as last read or as last written. */
let disabled: string[] = [];
let state: ConnectorsState = { status: 'idle', error: null, connectors: [], saving: false };
const listeners = new Set<() => void>();

function toConnectors(): Connector[] {
  const byApp = new Map<string, string>();
  for (const row of rows) {
    const id = row.provider_key?.trim();
    if (!id || row.status !== ACTIVE || NOT_FOR_ASSISTANT.has(id) || byApp.has(id)) continue;
    byApp.set(id, row.provider_display_name?.trim() || id);
  }
  return Array.from(byApp, ([id, name]) => ({ id, name, enabled: !disabled.includes(id) })).sort(
    (a, b) => a.name.localeCompare(b.name),
  );
}

function commit(patch: Partial<ConnectorsState>): void {
  state = { ...state, ...patch, connectors: toConnectors() };
  for (const listener of [...listeners]) listener();
}

/**
 * Read the switches fresh — every time the panel opens, like the web client,
 * because an app connected from the Integrations sheet a moment ago has to show
 * up without a restart.
 */
export async function loadConnectors(): Promise<void> {
  const { conversationUuid } = getState();
  commit({ status: state.status === 'ready' ? 'ready' : 'loading', error: null });
  try {
    const [connections, conversation] = await Promise.all([
      listActiveConnections(),
      conversationUuid ? getConversation(conversationUuid) : Promise.resolve(null),
    ]);
    // Moved on while this was in flight: a later call owns the panel now.
    if (getState().conversationUuid !== conversationUuid) return;
    rows = connections;
    disabled = conversation ? normalize(conversation.disabled_connectors ?? []) : pendingNew;
    commit({ status: 'ready' });
  } catch (error) {
    log.warn('could not read the connected apps', {
      message: error instanceof Error ? error.message : String(error),
    });
    // Only an error when there is nothing to show instead.
    commit({ status: rows.length > 0 ? 'ready' : 'error', error });
  }
}

/**
 * Flip one app on or off. Optimistic — the switch moves on the tap — and rolled
 * back if the PATCH fails, which is then the caller's to say (it throws).
 */
export async function toggleConnector(id: string, on: boolean): Promise<void> {
  const before = disabled;
  const next = normalize(on ? disabled.filter((entry) => entry !== id) : [...disabled, id]);
  disabled = next;
  setPendingNew(next);

  const { conversationUuid } = getState();
  if (!conversationUuid) {
    commit({});
    return;
  }

  commit({ saving: true });
  try {
    const updated = await updateConversation(conversationUuid, { disabled_connectors: next });
    if (getState().conversationUuid === conversationUuid) {
      disabled = normalize(updated.disabled_connectors ?? next);
    }
    log.info('connectors changed', { conversationUuid, disabled: next });
  } catch (error) {
    disabled = before;
    throw error;
  } finally {
    commit({ saving: false });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): ConnectorsState => state;

export function useConnectors(): ConnectorsState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
