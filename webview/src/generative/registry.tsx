/**
 * The tool-UI registry: maps a backend tool name → a rendered block.
 *
 * This is the whole generative-UI contract in one table. The backend agent is
 * given these tool names as skills (name + arg JSON Schema); when it wants to
 * show a component it emits `ai.tool_call { tool, args }` instead of plain text.
 * The client never receives React — it receives `{ tool, args }` and looks the
 * tool up here.
 *
 * To add a component the backend can draw: add a block in `./blocks`, then one
 * row here (a parser + the component). Nothing else changes.
 *
 * **`args` is `unknown` and was written by a model.** Every field is read through
 * the null-safe readers below, so a missing or wrong-typed field renders an em
 * dash instead of throwing and killing the whole transcript.
 */
import type { ReactNode } from 'react';

import type { ToolCallPart } from '@/chat/types';
import { t } from '@/i18n';
import { logger } from '@/lib/logger';
import {
  AI_ARTIFACT_TOOL_NAME,
  AI_AUTO_APPROVED_TOOL_NAME,
  AI_DELEGATION_TOOL_NAME,
  HITL_PENDING_TOOL_NAME,
  type AiDelegationArgs,
  type DelegationStatus,
} from '@/realtime/aiEvents';

import {
  AlertBlock,
  BarChart,
  ContactCard,
  DataTable,
  EM_DASH,
  GenerativeShowcase,
  ShipmentCard,
  StatsRow,
  WaypointsTimeline,
  type AlertArgs,
  type AlertLevel,
  type BarChartArgs,
  type BarDatum,
  type ContactCardArgs,
  type DataTableArgs,
  type ShipmentCardArgs,
  type ShipmentStatus,
  type StatItem,
  type StatsArgs,
  type WaypointStop,
  type WaypointsTimelineArgs,
} from './blocks';
import { ArtifactCard } from './ArtifactCard';
import { AutoApprovedChip } from './AutoApprovedChip';
import { DelegationCard } from './DelegationCard';
import { PendingActionCard } from './PendingActionCard';

const log = logger.child('generative');

/* ------------------------------------------------------------------ */
/* Null-safe readers — the only way this file touches a model's output */
/* ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A record to read fields off, even when the payload was not an object. */
function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** A displayable string, or `undefined` when there is genuinely nothing. */
function optionalText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  return undefined;
}

/** A displayable string, falling back to an em dash. Never empty. */
function text(value: unknown, fallback: string = EM_DASH): string {
  return optionalText(value) ?? fallback;
}

/** A finite number, or `undefined` — a numeric string counts, `NaN` does not. */
function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** One of `allowed`, or the given fallback. Guards every enum arg. */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/* ------------------------------------------------------------------ */
/* Per-tool parsers                                                    */
/* ------------------------------------------------------------------ */

const SHIPMENT_STATUSES: readonly ShipmentStatus[] = [
  'in_transit',
  'delivered',
  'delayed',
  'pending',
  'cancelled',
];

const ALERT_LEVELS: readonly AlertLevel[] = ['info', 'success', 'warning', 'error'];

const DELEGATION_STATUSES: readonly DelegationStatus[] = ['running', 'done', 'failed'];

/**
 * A delegation part's props. Built by `aiEvents.ts` rather than by a model, but
 * read through the same null-safe helpers as everything else here: it also comes
 * back off a stored `tool_calls` entry, where the arguments are whatever the
 * model wrote.
 */
function parseDelegation(args: unknown): AiDelegationArgs {
  const raw = asRecord(args);
  return {
    subagentType: optionalText(raw.subagentType) ?? '',
    description: optionalText(raw.description) ?? '',
    // A card with no readable status is one that is still open — the honest
    // default, since the only thing that closes it is its result arriving.
    status: oneOf(raw.status, DELEGATION_STATUSES, 'running'),
  };
}

function parseShipmentCard(args: unknown): ShipmentCardArgs {
  const raw = asRecord(args);
  return {
    id: text(raw.id),
    status: oneOf(raw.status, SHIPMENT_STATUSES, 'pending'),
    origin: text(raw.origin),
    destination: text(raw.destination),
    driver: optionalText(raw.driver),
    eta: optionalText(raw.eta),
    progress: optionalNumber(raw.progress),
    uuid: optionalText(raw.uuid),
  };
}

function parseWaypointsTimeline(args: unknown): WaypointsTimelineArgs {
  const raw = asRecord(args);
  const stops: WaypointStop[] = asArray(raw.stops).map((entry) => {
    // A bare string stop is not in the schema, but a model will send one anyway.
    if (typeof entry === 'string') return { name: text(entry) };
    const stop = asRecord(entry);
    return {
      name: text(stop.name),
      address: optionalText(stop.address),
      time: optionalText(stop.time),
      done: optionalBoolean(stop.done) ?? false,
    };
  });
  return { stops };
}

function parseStats(args: unknown): StatsArgs {
  const raw = asRecord(args);
  const items: StatItem[] = asArray(raw.items).map((entry) => {
    const item = asRecord(entry);
    return {
      label: text(item.label),
      value: text(item.value),
      delta: optionalNumber(item.delta),
    };
  });
  return { title: optionalText(raw.title), items };
}

function parseBarChart(args: unknown): BarChartArgs {
  const raw = asRecord(args);
  // A bar with no readable value is dropped rather than drawn at zero — a
  // phantom empty bar reads as real data.
  const data: BarDatum[] = asArray(raw.data).flatMap((entry) => {
    const datum = asRecord(entry);
    const value = optionalNumber(datum.value);
    return value === undefined ? [] : [{ label: text(datum.label), value }];
  });
  return { title: optionalText(raw.title), unit: optionalText(raw.unit), data };
}

function parseDataTable(args: unknown): DataTableArgs {
  const raw = asRecord(args);
  const columns = asArray(raw.columns).map((col) => text(col, ''));
  const rows = asArray(raw.rows).map((row) =>
    // A row sent as an object instead of an array still has values to show.
    asArray(Array.isArray(row) ? row : Object.values(asRecord(row))).map((cell) => text(cell)),
  );
  return { title: optionalText(raw.title), columns, rows };
}

function parseAlert(args: unknown): AlertArgs {
  const raw = asRecord(args);
  return {
    level: oneOf(raw.level, ALERT_LEVELS, 'info'),
    title: text(raw.title, t('blocks.alertFallback')),
    message: optionalText(raw.message),
  };
}

function parseContactCard(args: unknown): ContactCardArgs {
  const raw = asRecord(args);
  return {
    name: text(raw.name),
    role: optionalText(raw.role),
    phone: optionalText(raw.phone),
    initials: optionalText(raw.initials),
  };
}

/* ------------------------------------------------------------------ */
/* The registry                                                        */
/* ------------------------------------------------------------------ */

/**
 * Every generative-UI tool the client can render. The key is the tool name the
 * backend emits; the value turns that tool's `unknown` args into its block.
 * Keep in sync with the tool schemas registered on the backend — this is the
 * contract, and it is hand-written, not generated.
 */
const TOOL_UI = {
  render_shipment_card: (args) => <ShipmentCard {...parseShipmentCard(args)} />,
  render_waypoints_timeline: (args) => <WaypointsTimeline {...parseWaypointsTimeline(args)} />,
  render_stats: (args) => <StatsRow {...parseStats(args)} />,
  render_bar_chart: (args) => <BarChart {...parseBarChart(args)} />,
  render_table: (args) => <DataTable {...parseDataTable(args)} />,
  render_alert: (args) => <AlertBlock {...parseAlert(args)} />,
  render_contact_card: (args) => <ContactCard {...parseContactCard(args)} />,
  // Not a backend tool — the dev-only showcase behind `/ui`, kept in the registry
  // so the demo renders through exactly the same path a real turn does.
  render_aui_showcase: () => <GenerativeShowcase />,
} satisfies Record<string, (args: unknown) => ReactNode>;

export type ToolName = keyof typeof TOOL_UI;

/** The arg shape each tool's schema must produce. Mirrors `toolSchemas.ts`. */
export interface ToolArgs {
  render_shipment_card: ShipmentCardArgs;
  render_waypoints_timeline: WaypointsTimelineArgs;
  render_stats: StatsArgs;
  render_bar_chart: BarChartArgs;
  render_table: DataTableArgs;
  render_alert: AlertArgs;
  render_contact_card: ContactCardArgs;
  render_aui_showcase: Record<string, never>;
}

export const TOOL_NAMES = Object.keys(TOOL_UI) as ToolName[];

export function isKnownTool(name: string): name is ToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_UI, name);
}

/** Warn once per unknown tool — a stream can repeat the same bad name every turn. */
const warned = new Set<string>();

/**
 * Render a tool-call part as its block. Returns `null` for an unknown tool so an
 * unrecognised part degrades silently and the text around it still shows.
 */
export function renderToolBlock(part: ToolCallPart): ReactNode {
  const { toolName, args } = part;

  // Human-in-the-loop approval isn't a backend tool — it's an `ai.action.pending`
  // event surfaced through this same tool-call path, so it lands inline in the
  // turn in arrival order. The card owns the resume call.
  if (toolName === HITL_PENDING_TOOL_NAME) {
    const raw = asRecord(args);
    return (
      <PendingActionCard
        pendingUuid={text(raw.pendingUuid, '')}
        conversationUuid={text(raw.conversationUuid, '')}
        actions={raw.actions}
        allowOptions={raw.allowOptions}
        status={optionalText(raw.status)}
      />
    );
  }

  // A gated call that ran without a card because the person allowed it earlier.
  if (toolName === AI_AUTO_APPROVED_TOOL_NAME) {
    const raw = asRecord(args);
    return <AutoApprovedChip tool={text(raw.tool, '')} summary={text(raw.summary)} />;
  }

  // Nor is a model-generated view: `ai.artifact.generated` arrives on the same
  // path. Until there is a whitelist renderer for its JSX, the card names it.
  if (toolName === AI_ARTIFACT_TOOL_NAME) {
    const raw = asRecord(args);
    return (
      <ArtifactCard
        title={text(raw.title, t('artifact.untitled'))}
        jsx={typeof raw.jsx === 'string' ? raw.jsx : null}
        sourceTool={optionalText(raw.sourceTool)}
      />
    );
  }

  // Nor is a delegation: the model called the `task` tool and the stream will say
  // nothing more until the subagent answers, so the wait gets a card of its own.
  if (toolName === AI_DELEGATION_TOOL_NAME) {
    return <DelegationCard {...parseDelegation(args)} />;
  }

  if (!isKnownTool(toolName)) {
    // Deduped per tool name: an unknown tool is a contract gap, and one line per
    // occurrence would repeat on every re-render of a long transcript. The arg
    // keys ride along because they are what says whether this is a tool we have
    // never heard of or one that was renamed under us.
    if (!warned.has(toolName)) {
      warned.add(toolName);
      log.warn('unknown generative-UI tool — nothing rendered', {
        toolName,
        known: TOOL_NAMES,
        argKeys: Object.keys(asRecord(args)),
      });
    }
    return null;
  }

  return TOOL_UI[toolName](args);
}
