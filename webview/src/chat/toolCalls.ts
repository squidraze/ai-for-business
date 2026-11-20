/**
 * What the reply's "Used N tools" line and the task list are made of, shared by
 * the live stream (`realtime/aiEvents.ts`) and history (`chat/history.ts`) so a
 * reopened thread draws exactly what streamed.
 *
 * Ported from the web client's `tool-call-status.ts`, `todos.ts` and
 * `connected-app-tool.ts`; the names and the rules are the same.
 */
import { t } from '@/i18n';

import type { TodoItem, ToolCallStatus } from './types';

/** The tool behind the task list — drawn as the checklist, never as a card. */
export const WRITE_TODOS_TOOL = 'write_todos';

/** The two connected-app tools (Google Calendar, QuickBooks, Notion…). */
export const SEARCH_CONNECTED_APPS_TOOL = 'search_connected_apps';
export const RUN_CONNECTED_APP_TOOL = 'run_connected_app_tool';

/**
 * Calls that draw something of their own, so they are not cards in the line:
 * `render_ui` is the generated view, `task` is the delegation card, `write_todos`
 * is the task list.
 */
const OWN_BLOCK_TOOLS = new Set(['render_ui', 'task', WRITE_TODOS_TOOL]);

export function isToolLineCall(tool: string): boolean {
  return !OWN_BLOCK_TOOLS.has(tool);
}

/** `JSON.parse`, or the value itself when it is not a JSON string. */
export function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Did a tool call fail?
 *
 * There is no flag for this on the wire: a tool that threw, and a gated tool
 * refused because no approval channel exists, both come back as an ordinary
 * `ai.tool_result` whose `content` is prose about the failure. Three shapes are
 * recognised: the built-in tools' `Tool 'x' failed: …`, the analytics charts'
 * `Chart 'x' failed to run: …` (the two share no prefix — a check written for
 * the first missed every Metabase 400, see the web repo's `backend-issues` §8),
 * and the `{error}` / `{is_error: true}` object the web client also reads.
 *
 * It decides a chip on a card the user opens on purpose, and the log line —
 * never a banner, and never anything about the run as a whole.
 */
export function looksLikeToolFailure(content: unknown): boolean {
  if (typeof content === 'string') {
    if (content.startsWith("Tool '") && content.includes('requires human approval')) return true;
    // `Tool 'search_emails' failed: …`, `Chart 'driver_fuel_usage' failed to run: …`
    if (/^[A-Z][a-z]+ '[^']+' failed\b/.test(content)) return true;
  }
  const parsed = parseMaybeJson(content);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  return record.is_error === true || Boolean(record.error);
}

/** A finished call's status from its result. */
export function statusFromResult(content: unknown): ToolCallStatus {
  return looksLikeToolFailure(content) ? 'error' : 'done';
}

/** `write_todos`'s `args.todos` (or `ai.todos`'s `todos`), read defensively. */
export function readTodos(raw: unknown): TodoItem[] | null {
  const value = parseMaybeJson(raw);
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? (value as { todos?: unknown }).todos
      : undefined;
  if (!Array.isArray(list)) return null;
  return list.flatMap((item) => {
    const todo = item as { content?: unknown; status?: unknown } | null;
    return typeof todo?.content === 'string' && todo.content.trim()
      ? [{ content: todo.content, status: typeof todo.status === 'string' ? todo.status : 'pending' }]
      : [];
  });
}

/* ---------------------------------------------------------------- */
/* Names                                                             */
/* ---------------------------------------------------------------- */

/** Brand spellings a hyphen split cannot guess. */
const APP_NAMES: Record<string, string> = {
  quickbooks: 'QuickBooks',
  ringcentral: 'RingCentral',
  'google-calendar': 'Google Calendar',
  'google-sheets': 'Google Sheets',
  'google-drive': 'Google Drive',
  'google-mail': 'Gmail',
  outlook: 'Outlook',
  zoom: 'Zoom',
  notion: 'Notion',
  linear: 'Linear',
  slack: 'Slack',
  hubspot: 'HubSpot',
};

const words = (slug: string): string => slug.replace(/[_-]+/g, ' ').trim();
const sentence = (text: string): string =>
  text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : text;

/** `google-calendar` → "Google Calendar"; a known brand keeps its spelling. */
export function connectedAppName(integrationId: string): string {
  if (Object.prototype.hasOwnProperty.call(APP_NAMES, integrationId)) {
    return APP_NAMES[integrationId];
  }
  return words(integrationId).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * `run_connected_app_tool`'s app and action, from `args.tool` —
 * `google-calendar__list-events`: the integration id before `__`, the action
 * after. `null` for any other call or a payload that does not read.
 */
export function parseConnectedAppCall(
  tool: string,
  args: unknown,
): { integrationId: string; app: string; action: string } | null {
  if (tool !== RUN_CONNECTED_APP_TOOL) return null;
  const record = parseMaybeJson(args);
  if (!record || typeof record !== 'object') return null;
  const target = (record as Record<string, unknown>).tool;
  if (typeof target !== 'string') return null;
  const split = target.indexOf('__');
  if (split <= 0) return null;
  const integrationId = target.slice(0, split);
  return {
    integrationId,
    app: connectedAppName(integrationId),
    action: sentence(words(target.slice(split + 2))),
  };
}

/**
 * A card's title. An app call reads "Google Calendar · List events"; any other
 * tool its own name as a sentence — `get_company_overview` → "Get company
 * overview". (The web client shows the raw snake_case name; on a phone it is the
 * only text on the card, so it is worth reading.)
 */
export function toolCardName(tool: string, args: unknown): string {
  if (tool === SEARCH_CONNECTED_APPS_TOOL) return t('toolCalls.searchConnectedApps');
  const call = parseConnectedAppCall(tool, args);
  if (call) return call.action ? `${call.app} · ${call.action}` : call.app;
  return sentence(words(tool)) || t('toolCalls.fallbackName');
}
