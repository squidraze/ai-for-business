/**
 * Which company a NEW conversation starts in — the composer's company pill.
 *
 * The organization restructure: one organization, several carriers in it. While
 * the host has several companies selected ("All companies"), the backend has to
 * be told which one owns a new thread, and so whose AI budget it spends
 * (`StartMessageRequest.company_uuid`, 422 without it). The host sends the
 * choices in `init` only in that case; with one company selected there is
 * nothing to choose and nothing is sent — the company header decides.
 *
 * The pick is composer-local, the web client's rule: choosing who pays for one
 * thread must not narrow what the rest of the app shows, so it never travels
 * back to the host's selection. It survives switching threads for the session.
 *
 * An existing conversation already has its company; the pill then shows it
 * (`conversationCompany`, from the conversation record) and offers no choice.
 */
import { useSyncExternalStore } from 'react';

import type { CompanyChoice } from '@/bridge/protocol';

export type CompanyState = {
  /** What a new thread may start in; fewer than two ⇒ no pill. */
  choices: readonly CompanyChoice[];
  /** The pick for a new thread, always one of `choices` when there are any. */
  selectedId: string | null;
  /** The open conversation's own company, once its record has been read. */
  conversationCompany: CompanyChoice | null;
};

let state: CompanyState = { choices: [], selectedId: null, conversationCompany: null };
const listeners = new Set<() => void>();

function commit(next: Partial<CompanyState>): void {
  state = { ...state, ...next };
  for (const listener of [...listeners]) listener();
}

/** From `init`: the choices and the host's default (its acting company). */
export function initCompanies(choices: readonly CompanyChoice[] | undefined, defaultId: string): void {
  const usable = (choices ?? []).filter((c) => c && typeof c.uuid === 'string' && c.uuid);
  const selectedId = usable.some((c) => c.uuid === defaultId)
    ? defaultId
    : (usable[0]?.uuid ?? null);
  commit({ choices: usable, selectedId });
}

export function selectCompany(uuid: string): void {
  if (!state.choices.some((c) => c.uuid === uuid)) return;
  commit({ selectedId: uuid });
}

/** The open conversation's company, or `null` for a new thread / an older backend. */
export function setConversationCompany(company: CompanyChoice | null | undefined): void {
  commit({ conversationCompany: company?.uuid ? company : null });
}

/**
 * `company_uuid` for a request that creates a conversation: the pick while there
 * is a choice to make, nothing otherwise.
 */
export function getCompanyForNewThread(): string | undefined {
  return state.choices.length > 1 && state.selectedId ? state.selectedId : undefined;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): CompanyState => state;

export function useCompanies(): CompanyState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
