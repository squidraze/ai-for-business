/**
 * Generative-UI blocks — the components an AI turn can render instead of (or
 * alongside) plain text. Web port of
 * the native app's generative blocks.
 *
 * Each block is driven by a single typed `args` object — that object IS the
 * contract the backend agrees to emit. The backend never sends React; it sends
 * `{ tool, args }` and `registry.tsx` maps the tool name to one of these.
 *
 * These components take **already-validated** props: the wire payload is
 * `unknown` and is parsed in `registry.tsx` before it gets here, so nothing in
 * this file needs to guess whether a field survived the trip.
 *
 * Every colour goes through a design-token class (`bg-surface`, `text-label`,
 * `text-success`, …) so light and dark both come from `index.css`. No hexes.
 */
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  ExternalLink,
  Info,
  MapPin,
  MessageSquare,
  Package,
  Phone,
  TrendingDown,
  TrendingUp,
  Truck,
  User,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { ParseKeys } from 'i18next';
import { useCallback, useEffect, useRef, useState } from 'react';

import { send } from '@/bridge/bridge';
import { useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/** What a missing value renders as. Never blank, never a crash. */
export const EM_DASH = '—';

// ─── Shared shell ──────────────────────────────────────────────────────────

const CARD_SHELL = 'my-2 rounded-card border border-border bg-surface p-4';

/** The card frame every block sits in — one radius/border/fill for all of them. */
function Card({
  children,
  onPress,
  label,
}: {
  children: React.ReactNode;
  /** When set the whole card is a button. Never combine with inner buttons. */
  onPress?: () => void;
  label?: string;
}) {
  if (onPress) {
    return (
      <button
        type="button"
        aria-label={label}
        onClick={onPress}
        className={cn(
          CARD_SHELL,
          'block w-full text-left transition-transform duration-100 ease-out active:scale-[0.99]',
        )}
      >
        {children}
      </button>
    );
  }
  return <div className={CARD_SHELL}>{children}</div>;
}

function CardHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-label">
        <Icon size={18} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[0.9375rem] font-semibold text-label">{title}</p>
        {subtitle ? <p className="text-[0.8125rem] text-label-secondary">{subtitle}</p> : null}
      </div>
    </div>
  );
}

/** Section heading shared by the stats / chart / table blocks. */
function BlockTitle({ title }: { title?: string }) {
  if (!title) return null;
  return <p className="mb-3 text-[0.9375rem] font-semibold text-label">{title}</p>;
}

// ─── StatusBadge ───────────────────────────────────────────────────────────

export type ShipmentStatus = 'in_transit' | 'delivered' | 'delayed' | 'pending' | 'cancelled';

/**
 * The chip is filled with the status' tint; the label stays `text-label`.
 *
 * The tint carries the status at a glance, exactly as the native app's chips do.
 * The label does NOT take the matching `text-success` / `text-warning` step: at
 * 12px that is small text needing 4.5:1, and every semantic-on-its-own-tint pair
 * lands between 2.3:1 and 3.1:1 in the light theme (`text-success` on
 * `bg-success-tint` is 2.26:1). `text-label` on the same fills measures 9.3:1 or
 * better in light and 11:1 or better in dark, so one token reads in both themes.
 *
 * `pending` has no semantic colour by design — it is the neutral state.
 */
const STATUS_STYLE: Record<ShipmentStatus, { label: ParseKeys<'chat'>; fill: string }> = {
  in_transit: { label: 'blocks.status.inTransit', fill: 'bg-primary-tint' },
  delivered: { label: 'blocks.status.delivered', fill: 'bg-success-tint' },
  delayed: { label: 'blocks.status.delayed', fill: 'bg-warning-tint' },
  pending: { label: 'blocks.status.pending', fill: 'bg-surface-muted' },
  cancelled: { label: 'blocks.status.cancelled', fill: 'bg-danger-tint' },
};

export function StatusBadge({ status }: { status: ShipmentStatus }) {
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[0.75rem] font-medium text-label',
        style.fill,
      )}
    >
      {t(style.label)}
    </span>
  );
}

// ─── ShipmentCard ──────────────────────────────────────────────────────────

export interface ShipmentCardArgs {
  id: string;
  status: ShipmentStatus;
  origin: string;
  destination: string;
  driver?: string;
  eta?: string;
  /** 0–100; drives the route progress track. */
  progress?: number;
  /** Web-only: the record the host should open. Falls back to `id`. */
  uuid?: string;
}

export function ShipmentCard({
  id,
  status,
  origin,
  destination,
  driver,
  eta,
  progress,
  uuid,
}: ShipmentCardArgs) {
  const target = uuid ?? id;
  const { t } = useTranslation();
  // A block never navigates itself — it asks the native host to.
  const open = useCallback(() => {
    send('generative.action', { action: 'open_shipment', params: { uuid: target } });
  }, [target]);

  // `id` falls back to an em dash when the model omitted it; there is nothing to
  // open in that case, so the card stays a plain div rather than a dead button.
  const openable = target !== EM_DASH;
  const pct = Math.max(0, Math.min(100, progress ?? 0));

  return (
    <Card onPress={openable ? open : undefined} label={t('blocks.openShipment', { id })}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Package size={18} className="shrink-0 text-primary" aria-hidden />
          <span className="truncate text-[0.9375rem] font-semibold text-label">{id}</span>
        </div>
        <StatusBadge status={status} />
      </div>

      <div className="mb-3 flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[0.875rem] text-label">{origin}</span>
        <span className="shrink-0 text-label-tertiary" aria-hidden>
          &rarr;
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-[0.875rem] text-label">
          {destination}
        </span>
      </div>

      {typeof progress === 'number' ? (
        <div
          className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        {driver ? (
          <span className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-label-secondary">
            <Truck size={14} className="shrink-0" aria-hidden />
            <span className="truncate">{driver}</span>
          </span>
        ) : (
          <span />
        )}
        {eta ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[0.8125rem] text-label-secondary">
            <Clock size={14} aria-hidden />
            {eta}
          </span>
        ) : null}
      </div>
    </Card>
  );
}

// ─── WaypointsTimeline ─────────────────────────────────────────────────────

export interface WaypointStop {
  name: string;
  address?: string;
  time?: string;
  done?: boolean;
}

export interface WaypointsTimelineArgs {
  stops: WaypointStop[];
}

export function WaypointsTimeline({ stops }: WaypointsTimelineArgs) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader
        icon={MapPin}
        title={t('blocks.route')}
        subtitle={t('blocks.stops', { count: stops.length })}
      />
      {stops.length === 0 ? (
        <p className="text-[0.8125rem] text-label-secondary">{t('blocks.noStops')}</p>
      ) : null}
      {stops.map((stop, i) => {
        const last = i === stops.length - 1;
        const Dot = stop.done ? CheckCircle2 : Circle;
        return (
          <div key={`${stop.name}-${i}`} className="flex gap-3">
            <div className="flex shrink-0 flex-col items-center">
              <Dot
                size={18}
                className={stop.done ? 'text-primary' : 'text-label-tertiary'}
                aria-hidden
              />
              {!last ? <div className="my-0.5 w-0.5 flex-1 bg-border" /> : null}
            </div>
            <div className={cn('min-w-0', last ? 'pb-0' : 'pb-4')}>
              <p className="text-[0.875rem] font-medium text-label">{stop.name}</p>
              {stop.address ? (
                <p className="text-[0.8125rem] text-label-secondary">{stop.address}</p>
              ) : null}
              {stop.time ? (
                <p className="mt-0.5 text-[0.75rem] text-label-tertiary">{stop.time}</p>
              ) : null}
            </div>
          </div>
        );
      })}
    </Card>
  );
}

// ─── StatsRow (KPI tiles) ──────────────────────────────────────────────────

export interface StatItem {
  label: string;
  value: string;
  delta?: number;
}

export interface StatsArgs {
  title?: string;
  items: StatItem[];
}

export function StatsRow({ title, items }: StatsArgs) {
  return (
    <Card>
      <BlockTitle title={title} />
      <div className="flex flex-wrap gap-2">
        {items.map((item, i) => {
          const up = (item.delta ?? 0) >= 0;
          const Trend = up ? TrendingUp : TrendingDown;
          // Up/down is semantic, not brand — success/danger, never `text-primary`.
          const trendClass = up ? 'text-success' : 'text-danger';
          return (
            <div
              key={`${item.label}-${i}`}
              className="min-w-[30%] flex-1 rounded-xl bg-surface-muted p-3"
            >
              <p className="truncate text-[0.75rem] text-label-secondary">{item.label}</p>
              <p className="mt-1 text-[1.25rem] font-semibold text-label">{item.value}</p>
              {typeof item.delta === 'number' ? (
                <p
                  className={cn(
                    'mt-1 flex items-center gap-1 text-[0.75rem] font-medium',
                    trendClass,
                  )}
                >
                  <Trend size={12} aria-hidden />
                  {up ? '+' : ''}
                  {item.delta}%
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ─── BarChart (single-series, one hue) ─────────────────────────────────────

export interface BarDatum {
  label: string;
  value: number;
}

export interface BarChartArgs {
  title?: string;
  unit?: string;
  data: BarDatum[];
}

/** Percentage-width divs, deliberately — no charting dependency. */
export function BarChart({ title, unit, data }: BarChartArgs) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <Card>
      <BlockTitle title={title} />
      <div className="flex flex-col gap-2.5">
        {data.map((d, i) => (
          <div key={`${d.label}-${i}`}>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[0.8125rem] text-label-secondary">{d.label}</span>
              <span className="shrink-0 text-[0.8125rem] font-medium text-label">
                {d.value}
                {unit ? ` ${unit}` : ''}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded bg-surface-muted">
              <div
                className="h-full rounded bg-primary"
                style={{ width: `${Math.max(0, (d.value / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── DataTable ─────────────────────────────────────────────────────────────

export interface DataTableArgs {
  title?: string;
  columns: string[];
  rows: (string | number)[][];
}

export function DataTable({ title, columns, rows }: DataTableArgs) {
  return (
    <Card>
      <BlockTitle title={title} />
      {/* Wide tables scroll horizontally rather than squashing or overflowing. */}
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-border">
              {columns.map((col, c) => (
                <th
                  key={`h-${c}`}
                  scope="col"
                  className="min-w-24 px-2 pb-2 text-left text-[0.75rem] font-semibold whitespace-nowrap text-label-secondary uppercase"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={`r-${r}`} className={r % 2 === 1 ? 'bg-surface-muted' : undefined}>
                {columns.map((_, c) => (
                  <td
                    key={`c-${r}-${c}`}
                    className="min-w-24 px-2 py-2 text-left text-[0.8125rem] whitespace-nowrap text-label"
                  >
                    {row[c] ?? EM_DASH}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ─── Alert (callout banner) ────────────────────────────────────────────────

export type AlertLevel = 'info' | 'success' | 'warning' | 'error';

/**
 * A tinted card per level, the way the native app has it. The border matches the
 * fill so every level keeps the same box metrics as the neutral `info` card.
 *
 * `info` has no token of its own and stays neutral — the brand blue is not a
 * semantic colour, so `primary` is deliberately not borrowed for it here.
 *
 * The icon takes its semantic step on its own tint, which measures 2.3–3.1:1 in
 * light. That is below the 3:1 a load-bearing graphic wants, and it is fine
 * here: the icon is redundant with a `text-label` title beside it at 11:1+.
 */
const ALERT_STYLE: Record<AlertLevel, { icon: LucideIcon; shell: string; tint: string }> = {
  info: { icon: Info, shell: 'border-border bg-surface', tint: 'text-label-secondary' },
  success: { icon: CheckCircle2, shell: 'border-success-tint bg-success-tint', tint: 'text-success' },
  warning: { icon: AlertTriangle, shell: 'border-warning-tint bg-warning-tint', tint: 'text-warning' },
  error: { icon: XCircle, shell: 'border-danger-tint bg-danger-tint', tint: 'text-danger' },
};

export interface AlertArgs {
  level: AlertLevel;
  title: string;
  message?: string;
}

export function AlertBlock({ level, title, message }: AlertArgs) {
  const style = ALERT_STYLE[level] ?? ALERT_STYLE.info;
  const Icon = style.icon;
  return (
    <div className={cn('my-2 flex gap-3 rounded-card border p-3.5', style.shell)} role="note">
      <Icon size={20} className={cn('mt-0.5 shrink-0', style.tint)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[0.875rem] font-semibold text-label">{title}</p>
        {message ? (
          <p className="mt-0.5 text-[0.8125rem] leading-5 text-label-secondary">{message}</p>
        ) : null}
      </div>
    </div>
  );
}

// ─── ContactCard ───────────────────────────────────────────────────────────

export interface ContactCardArgs {
  name: string;
  role?: string;
  phone?: string;
  initials?: string;
}

/** Round affordance next to a contact — 36px flat, not the composer IconButton. */
function ContactAction({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onPress}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-muted text-primary transition-transform duration-100 ease-out active:scale-90"
    >
      <Icon size={16} aria-hidden />
    </button>
  );
}

export function ContactCard({ name, role, phone, initials }: ContactCardArgs) {
  const badge = (initials ?? name.slice(0, 2)).toUpperCase();
  const { t } = useTranslation();

  // `tel:` / `sms:` go to the host: a WebView must not drive the dialer itself.
  const call = useCallback(() => {
    if (phone) send('generative.action', { action: 'open_url', params: { url: `tel:${phone}` } });
  }, [phone]);
  const message = useCallback(() => {
    if (phone) send('generative.action', { action: 'open_url', params: { url: `sms:${phone}` } });
  }, [phone]);
  const copyPhone = useCallback(() => {
    if (phone) send('generative.action', { action: 'copy', params: { text: phone } });
  }, [phone]);

  return (
    <Card>
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-muted">
          {badge ? (
            <span className="text-[0.9375rem] font-semibold text-label">{badge}</span>
          ) : (
            <User size={20} className="text-label-tertiary" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-semibold text-label">{name}</p>
          {role ? <p className="truncate text-[0.8125rem] text-label-secondary">{role}</p> : null}
        </div>
        {phone ? (
          <div className="flex gap-2">
            <ContactAction icon={Phone} label={t('blocks.call', { name })} onPress={call} />
            <ContactAction icon={MessageSquare} label={t('blocks.message', { name })} onPress={message} />
          </div>
        ) : null}
      </div>
      {phone ? (
        <button
          type="button"
          onClick={copyPhone}
          aria-label={t('blocks.copy', { value: phone })}
          className="mt-2 block text-left text-[0.8125rem] text-label-secondary active:opacity-70"
        >
          {phone}
        </button>
      ) : null}
    </Card>
  );
}

// ─── Showcase (dev-only) ───────────────────────────────────────────────────

/**
 * The dev-only block behind `/ui`. On native this rendered assistant-ui's
 * headless `ActionBarPrimitive` (copy / regenerate, bound to the live message
 * runtime); the web view has no assistant-ui, so it shows the other half of the
 * same story — that a block's actions leave over the native bridge, and that
 * both of these really fire from inside a rendered block.
 */
export function GenerativeShowcase() {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(() => {
    send('generative.action', {
      action: 'copy',
      params: { text: 'The backend sends { tool, args }; the web view maps tool to a component.' },
    });
    setCopied(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  }, []);

  const openLink = useCallback(() => {
    send('generative.action', { action: 'open_url', params: { url: 'https://example.com' } });
  }, []);

  return (
    <div className="my-2 rounded-card border border-dashed border-border bg-surface p-4">
      <p className="text-[0.8125rem] font-semibold text-label">Generative UI internals</p>
      <p className="mt-0.5 mb-3 text-[0.75rem] leading-5 text-label-secondary">
        Blocks are drawn client-side from <span className="font-medium">{'{ tool, args }'}</span>. A
        block never navigates — it posts an action to the native host.
      </p>
      <div className="flex items-center gap-5">
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 text-[0.8125rem] text-label-secondary active:opacity-70"
        >
          {copied ? (
            <Check size={16} className="text-success" aria-hidden />
          ) : (
            <Copy size={16} aria-hidden />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          onClick={openLink}
          className="flex items-center gap-1.5 text-[0.8125rem] text-label-secondary active:opacity-70"
        >
          <ExternalLink size={16} aria-hidden />
          Open link
        </button>
      </div>
    </div>
  );
}
