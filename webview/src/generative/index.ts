/**
 * Generative UI — the blocks an AI turn can draw, and the registry that maps a
 * backend tool name to one. The chat renders a `tool-call` part by handing it to
 * `renderToolBlock`; nothing outside this folder needs to know the catalog.
 */
export { renderToolBlock, isKnownTool, TOOL_NAMES } from './registry';
export type { ToolName, ToolArgs } from './registry';
export { buildDemoParts, MOCK_TOOL_CALLS } from './mockData';
export { PendingActionCard } from './PendingActionCard';
export { DelegationCard } from './DelegationCard';
export type { DelegationCardProps } from './DelegationCard';
export type {
  AlertArgs,
  AlertLevel,
  BarChartArgs,
  BarDatum,
  ContactCardArgs,
  DataTableArgs,
  ShipmentCardArgs,
  ShipmentStatus,
  StatItem,
  StatsArgs,
  WaypointStop,
  WaypointsTimelineArgs,
} from './blocks';
