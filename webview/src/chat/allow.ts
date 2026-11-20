/**
 * "Always allow" / "Allow for this session" — the standing approvals an approval
 * card can grant along with an approve.
 *
 * The same rules as the native app's `toolPermissions.utils.ts` and the web app's
 * `allow-choices.ts`, so the three clients offer the same buttons for the same
 * card. The contract types `allow_options` as `{[tool]: unknown[]}`, so everything
 * that reads it goes through {@link readAllowOptions} first and only ever sees the
 * two values the backend documents.
 */
import type { ParseKeys } from 'i18next';

import type { AllowScope } from '@/lib/api/types';

/** Tool name → the standing approvals the backend accepts for it. */
export type AllowOptions = Record<string, AllowScope[]>;

export function isAllowScope(value: unknown): value is AllowScope {
  return value === 'always' || value === 'session';
}

/**
 * Narrow a raw `allow_options` value. Anything that is not a map of arrays is an
 * empty map, and anything inside an array that is not one of the two scopes is
 * dropped — an unknown value from a newer backend must not become a button.
 */
export function readAllowOptions(raw: unknown): AllowOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: AllowOptions = {};
  for (const [tool, scopes] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(scopes)) continue;
    const valid = scopes.filter(isAllowScope);
    if (valid.length > 0) out[tool] = Array.from(new Set(valid));
  }
  return out;
}

/** Narrowest first — the order the buttons sit in on the card. */
const ORDER: readonly AllowScope[] = ['session', 'always'];

/** Translation keys, not text — `t(ALLOW_LABEL[scope])` at render. */
export const ALLOW_LABEL: Record<AllowScope, ParseKeys<'chat'>> = {
  session: 'approval.allowSession',
  always: 'approval.alwaysAllow',
};

/**
 * Which standing approvals one card may offer.
 *
 * **The card's tools are the map's keys**, not the names on its action rows: a
 * connected-app row can name the inner action (`google-calendar__create-event`),
 * which matches no key, while the key is the tool the backend records the
 * approval against (`run_connected_app_tool`).
 *
 * A scope is offered only when **every** tool on the card accepts it: one resume
 * applies it to the whole card, so offering "Always allow" because one of two
 * tools accepts it would ask the backend to record something it has said it will
 * not. An empty map means Approve / Reject only.
 */
export function cardAllowChoices(options: AllowOptions): AllowScope[] {
  const tools = Object.keys(options);
  if (tools.length === 0) return [];
  return ORDER.filter((scope) => tools.every((tool) => options[tool]?.includes(scope)));
}

/**
 * What the backend actually recorded, folded into one word for the card.
 *
 * It may downgrade `always` to `session` for a tool that leaves the company or
 * moves money, so the weakest recorded scope is what the card reports — saying
 * "always allowed" over a `session` record would be a lie the person acts on.
 * `null` when nothing was recorded.
 */
export function recordedScope(allowed: Record<string, unknown> | undefined): AllowScope | null {
  const values = Object.values(allowed ?? {}).filter(isAllowScope);
  if (values.length === 0) return null;
  return values.includes('session') ? 'session' : 'always';
}
