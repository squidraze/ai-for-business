/**
 * The starter prompts of the new-chat screen — four, chosen for the person's
 * role, and never one for data they cannot read.
 *
 * **A port, kept in step by hand**: the source of truth is the web client's
 * `apps/web/widgets/deep-agent-chat/lib/chat-starters.ts` in `rooler_apps`, and
 * its human catalogue is `docs/guides/ai-chat-starters.md` there. The two apps
 * offer the same chips for the same person; change both together. The
 * permission and role strings are the values of the web client's `PERMISSIONS`
 * and `ROLES` constants, written out because nothing is shared between the repos.
 *
 * Label ≠ prompt: the chip says the short thing, and the prompt names the tool
 * or chart that answers it so the agent does not have to guess what was meant.
 * `{{today}}` becomes the date when the chip is picked.
 *
 * Both halves are translated: the chip is read by the user, and the prompt is
 * sent as the user's own message, so it goes in the language they chat in. The
 * pool stores keys; the text is looked up when the chips are picked.
 */

import type { ParseKeys } from 'i18next';

import { t } from '@/i18n';

type StarterKey = ParseKeys<'chat'>;

type StarterDefinition = { label: StarterKey; prompt: StarterKey; permission: string };

export type ChatStarter = {
  id: string;
  /** What the chip says. */
  label: string;
  /** What is actually sent. */
  prompt: string;
  /** The read permission the answer needs; the chip is hidden without it. */
  permission: string;
};

export const STARTERS_SHOWN = 4;

const POOL = {
  dispatch_today: {
    label: 'starters.dispatchToday.label',
    prompt: 'starters.dispatchToday.prompt',
    permission: 'load:read',
  },
  pipeline_week: {
    label: 'starters.pipelineWeek.label',
    prompt: 'starters.pipelineWeek.prompt',
    permission: 'load:read',
  },
  loads_by_status: {
    label: 'starters.loadsByStatus.label',
    prompt: 'starters.loadsByStatus.prompt',
    permission: 'load:read',
  },
  drivers_available: {
    label: 'starters.driversAvailable.label',
    prompt: 'starters.driversAvailable.prompt',
    permission: 'driver:read',
  },
  load_lookup: {
    label: 'starters.loadLookup.label',
    prompt: 'starters.loadLookup.prompt',
    permission: 'load:read',
  },
  route_estimate: {
    label: 'starters.routeEstimate.label',
    prompt: 'starters.routeEstimate.prompt',
    permission: 'load:read',
  },
  coverage_gaps: {
    label: 'starters.coverageGaps.label',
    prompt: 'starters.coverageGaps.prompt',
    permission: 'load:read',
  },
  finances_30d: {
    label: 'starters.finances30d.label',
    prompt: 'starters.finances30d.prompt',
    permission: 'analytics:read',
  },
  expenses_month: {
    label: 'starters.expensesMonth.label',
    prompt: 'starters.expensesMonth.prompt',
    permission: 'ledger:read',
  },
  invoices_overdue: {
    label: 'starters.invoicesOverdue.label',
    prompt: 'starters.invoicesOverdue.prompt',
    permission: 'ar_batch:read',
  },
  cash_week: {
    label: 'starters.cashWeek.label',
    prompt: 'starters.cashWeek.prompt',
    permission: 'ar_batch:read',
  },
  payroll_period: {
    label: 'starters.payrollPeriod.label',
    prompt: 'starters.payrollPeriod.prompt',
    permission: 'ap_payroll:read',
  },
  fuel_spend: {
    label: 'starters.fuelSpend.label',
    prompt: 'starters.fuelSpend.prompt',
    permission: 'fuel_transaction:read',
  },
  fleet_week: {
    label: 'starters.fleetWeek.label',
    prompt: 'starters.fleetWeek.prompt',
    permission: 'analytics:read',
  },
  maintenance_spend: {
    label: 'starters.maintenanceSpend.label',
    prompt: 'starters.maintenanceSpend.prompt',
    permission: 'maintenance:read',
  },
  safety_costs: {
    label: 'starters.safetyCosts.label',
    prompt: 'starters.safetyCosts.prompt',
    permission: 'claim:read',
  },
  truck_lookup: {
    label: 'starters.truckLookup.label',
    prompt: 'starters.truckLookup.prompt',
    permission: 'truck:read',
  },
  driver_lookup: {
    label: 'starters.driverLookup.label',
    prompt: 'starters.driverLookup.prompt',
    permission: 'driver:read',
  },
  insights: {
    label: 'starters.insights.label',
    prompt: 'starters.insights.prompt',
    permission: 'analytics:read',
  },
  recruiting_calls: {
    label: 'starters.recruitingCalls.label',
    prompt: 'starters.recruitingCalls.prompt',
    permission: 'candidate:read',
  },
  knowledge: {
    label: 'starters.knowledge.label',
    prompt: 'starters.knowledge.prompt',
    permission: 'ai:knowledge_read',
  },
  email_search: {
    label: 'starters.emailSearch.label',
    prompt: 'starters.emailSearch.prompt',
    permission: 'email:read',
  },
} as const satisfies Record<string, StarterDefinition>;

type StarterId = keyof typeof POOL;

/** Each system role's four, in the order they show. Drivers have none. */
const BY_ROLE: Record<string, StarterId[]> = {
  owner: ['finances_30d', 'insights', 'fleet_week', 'cash_week'],
  admin: ['dispatch_today', 'finances_30d', 'invoices_overdue', 'drivers_available'],
  manager: ['fleet_week', 'dispatch_today', 'coverage_gaps', 'recruiting_calls'],
  dispatcher: ['dispatch_today', 'pipeline_week', 'drivers_available', 'load_lookup'],
  safety_personnel: ['safety_costs', 'maintenance_spend', 'truck_lookup', 'driver_lookup'],
  updater: ['loads_by_status', 'drivers_available', 'load_lookup', 'route_estimate'],
};

/** For a custom role, and to top up a role whose permissions cut its list short. */
const FALLBACK_ORDER: StarterId[] = [
  'dispatch_today',
  'finances_30d',
  'invoices_overdue',
  'drivers_available',
  'insights',
  'load_lookup',
  'fleet_week',
  'loads_by_status',
  'pipeline_week',
  'cash_week',
  'expenses_month',
  'fuel_spend',
  'payroll_period',
  'maintenance_spend',
  'safety_costs',
  'truck_lookup',
  'driver_lookup',
  'coverage_gaps',
  'recruiting_calls',
  'route_estimate',
  'knowledge',
  'email_search',
];

/** Today as `YYYY-MM-DD` in the device's own time zone. */
function localToday(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The chips for one person: the role's own four minus any their permissions do
 * not allow, topped up from the fallback order — never more than four, never a
 * duplicate. `permissions` `undefined` (not read yet, or the read failed) hides
 * nothing, so a system role's row does not reshuffle once it lands.
 *
 * Translated in the current UI language at call time — a caller that memoises
 * the result keys it on the language too.
 */
export function pickChatStarters(
  role: string | null | undefined,
  permissions: readonly string[] | undefined,
  now: Date = new Date(),
): ChatStarter[] {
  const allowed = (id: StarterId) =>
    permissions === undefined || permissions.includes(POOL[id].permission);
  const own = role && Object.prototype.hasOwnProperty.call(BY_ROLE, role) ? BY_ROLE[role] : [];
  const picked: StarterId[] = [];
  for (const id of [...own, ...FALLBACK_ORDER]) {
    if (picked.length === STARTERS_SHOWN) break;
    if (!picked.includes(id) && allowed(id)) picked.push(id);
  }
  const today = localToday(now);
  return picked.map((id) => ({
    id,
    label: t(POOL[id].label),
    prompt: t(POOL[id].prompt, { today }),
    permission: POOL[id].permission,
  }));
}
