/**
 * "Needs attention" — the agent's inbox on the new-chat screen (web Figma
 * 4973:71840, BAC-451): everything in the company that wants a person to look at
 * it, severity first. Tapping a row sends its `prompt` as the first message of a
 * new chat.
 *
 * `GET /ai/attention?limit=20`. No realtime: read when the new-chat screen opens,
 * at most once a minute — the web client's `staleTime`, and the same
 * "hidden while loading or empty" rule.
 */
import { useSyncExternalStore } from 'react';

import { api } from '@/lib/api/client';
import { logger } from '@/lib/logger';

const log = logger.child('attention');

export type AttentionSeverity = 'critical' | 'warning' | 'info';

export type AttentionItem = {
  uuid: string;
  title: string;
  subtitle: string;
  occurred_at: string;
  severity: AttentionSeverity;
  /** Self-contained: names the subject, the kind and the date. */
  prompt: string;
};

export type AttentionFeed = { items: AttentionItem[]; total: number };

const LIMIT = 20;
const STALE_MS = 60_000;

let feed: AttentionFeed | null = null;
let readAt = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

const SEVERITIES = new Set<string>(['critical', 'warning', 'info']);

/** Every field is model-adjacent backend output — narrow it before drawing it. */
function readItem(raw: unknown): AttentionItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const text = (key: string) => (typeof row[key] === 'string' ? (row[key] as string) : '');
  if (!text('uuid') || !text('title') || !text('prompt')) return null;
  return {
    uuid: text('uuid'),
    title: text('title'),
    subtitle: text('subtitle'),
    occurred_at: text('occurred_at'),
    severity: SEVERITIES.has(text('severity')) ? (text('severity') as AttentionSeverity) : 'info',
    prompt: text('prompt'),
  };
}

/** Read the feed unless a fresh copy is already on hand. Never throws. */
export function loadAttention(): Promise<void> {
  if (inFlight) return inFlight;
  if (feed && Date.now() - readAt < STALE_MS) return Promise.resolve();
  inFlight = (async () => {
    try {
      const { data } = await api().get<{ items?: unknown[]; meta?: { total?: number } }>(
        '/api/v1/ai/attention',
        { params: { limit: LIMIT } },
      );
      const items = (data?.items ?? []).map(readItem).filter((item): item is AttentionItem => !!item);
      feed = { items, total: typeof data?.meta?.total === 'number' ? data.meta.total : items.length };
      readAt = Date.now();
      for (const listener of [...listeners]) listener();
    } catch (error) {
      // The card is an extra on an empty screen: a failure hides it, nothing more.
      log.warn('could not read the attention feed', {
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = (): AttentionFeed | null => feed;

export function useAttention(): AttentionFeed | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * "2d ago", "3h ago", "in 5d" — the web client's `shortTimeAgo`. A timestamp
 * with no zone is the backend's UTC, so it is read as such rather than as local.
 */
export function shortTimeAgo(iso: string, now: Date = new Date()): string {
  if (!iso) return '';
  const zoned = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const time = Date.parse(zoned);
  if (Number.isNaN(time)) return '';
  const diff = now.getTime() - time;
  const distance = Math.abs(diff);
  if (distance < MINUTE) return 'just now';
  const unit =
    distance < HOUR
      ? `${Math.floor(distance / MINUTE)}m`
      : distance < DAY
        ? `${Math.floor(distance / HOUR)}h`
        : distance < WEEK
          ? `${Math.floor(distance / DAY)}d`
          : distance < MONTH
            ? `${Math.floor(distance / WEEK)}w`
            : distance < YEAR
              ? `${Math.floor(distance / MONTH)}mo`
              : `${Math.floor(distance / YEAR)}y`;
  return diff >= 0 ? `${unit} ago` : `in ${unit}`;
}
