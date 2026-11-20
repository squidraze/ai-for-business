/**
 * The components a generated view may use — the whitelist itself.
 *
 * `render_ui` sends **JSX source**, and the reference host on the backend side
 * renders it with AI Elements' `JSXPreview`, which is `react-jsx-parser` plus a
 * `components` map the host supplies. The map *is* the contract: a tag with no
 * entry here is not rendered, so this file is the exhaustive list of what the
 * model can put on this screen.
 *
 * ## The reference is the app's own screens, not a kit
 *
 * Everything below is a port of what home and insights already draw — the same
 * card, the same KPI tile, the same table, the same charts:
 *
 * | Here | Ported from |
 * | --- | --- |
 * | the card shell | `packages/ui/theme/screen.ts` — `CARD_SURFACE` + `useCardShadow` |
 * | `Stat` | `insights/.../KpiSection.tsx` — `KpiCard` |
 * | `Table` | `insights/.../InsightsTable.tsx` |
 * | the chart shell and legend | `insights/.../ChartCard.tsx`, `ChartLegend.tsx` |
 * | chart colours | `packages/ui/theme/colors.ts` — `chartSeries`, via `--chart-*` |
 * | `Progress` | `home/.../SegmentedProgressBar.tsx` |
 *
 * The point is not resemblance: a view the assistant draws should be
 * indistinguishable from one the app drew, and the only way to get that is to
 * copy the measurements rather than to approximate them.
 *
 * The app is React Native, so nothing here can import those components — this is
 * the same design expressed in the one language both sides share, which is the
 * design tokens. Change one of them and both move.
 *
 * ## Two rules that shape every component here
 *
 * **The model's `className` is thrown away** (stripped in `ArtifactView`), so
 * each of these owns its own look. Two independent reasons, either sufficient:
 * Tailwind emits only the classes it saw while scanning source, so one written
 * at runtime resolves to nothing; and the model writes `text-gray-500` and
 * `bg-white`, which have no dark mode. The layout intent survives anyway — the
 * model's own containers arrive classless and are laid out as a wrapping row by
 * the `.ai-artifact` rules in `index.css`.
 *
 * **Props arrive as `unknown`.** They were written by a model, so every one is
 * read through the guards below and a missing or wrong-typed field renders an em
 * dash or drops the block — never a thrown render, which would take out the
 * whole transcript.
 */
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  MapPin,
  Phone,
  Star,
  TrendingDown,
  TrendingUp,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { getHostLocale, useTranslation } from '@/i18n';
import { cn } from '@/lib/cn';

/* ---------------------------------------------------------------- */
/* Reading a model's props                                           */
/* ---------------------------------------------------------------- */

/** What a missing value renders as. Never blank, never a crash. */
const EM_DASH = '—';

type Props = { children?: ReactNode } & Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function text(value: unknown, fallback: string = EM_DASH): string {
  return optionalText(value) ?? fallback;
}

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/** `{ label, value }` rows — the shape all three charts take. */
export interface ChartDatum {
  label: string;
  value: number;
}

function toChartData(value: unknown): ChartDatum[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry): ChartDatum | null => {
      if (!isRecord(entry)) return null;
      const amount = optionalNumber(entry.value ?? entry.y ?? entry.amount);
      if (amount === undefined) return null;
      return { label: text(entry.label ?? entry.name ?? entry.x, EM_DASH), value: amount };
    })
    .filter((datum): datum is ChartDatum => datum !== null);
}

/** Grouped digits, so 42000 does not read as a phone number. */
function formatValue(value: number, unit?: string): string {
  const formatted = value.toLocaleString(getHostLocale());
  if (!unit) return formatted;
  // A currency mark belongs in front of the number, a measurement after it.
  return /^[$€£₽]$/.test(unit) ? `${unit}${formatted}` : `${formatted} ${unit}`;
}

/**
 * An axis tick. The app's `compactMoneyLabel` does the same job: a y-axis has
 * 42px for its label, and `184500` does not fit in it at 10px.
 */
function compactValue(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

/**
 * A round-ish ceiling for the axis, so the top rule carries a readable number
 * instead of the tallest bar's exact value.
 */
function axisMax(values: number[]): number {
  const peak = Math.max(0, ...values);
  if (peak <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(peak));
  return Math.ceil(peak / (magnitude / 2)) * (magnitude / 2);
}

/**
 * Show every Nth category label. Straight from the app's `labelStep`: at a
 * phone's width a dozen labels collide, and dropping every other one is what
 * the insights charts do rather than rotating or truncating them.
 */
function labelStep(count: number): number {
  if (count <= 6) return 1;
  if (count <= 12) return 2;
  return Math.ceil(count / 6);
}

/* ---------------------------------------------------------------- */
/* Shared shell                                                      */
/* ---------------------------------------------------------------- */

/**
 * The card every block sits in — the app's `CARD_SURFACE` plus its shadow, as
 * one class (`.ai-surface` in `index.css`, which owns the light/dark split).
 *
 * `ai-framed` is a hook, not a style: `index.css` uses it to strip the frame off
 * a block nested inside another one, because a card inside a card reads as a
 * mistake. `w-full` keeps a block on a row of its own inside the model's
 * wrapping containers.
 */
const FRAMED = 'ai-framed ai-surface my-2 w-full p-4';

/** The card header — `ChartCard`'s title over its subtitle. */
function BlockHeader({ title, subtitle }: { title?: string; subtitle?: string }) {
  if (!title && !subtitle) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {title ? <p className="text-base leading-5 font-semibold text-label">{title}</p> : null}
      {subtitle ? <p className="text-xs text-label-tertiary">{subtitle}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Card                                                              */
/* ---------------------------------------------------------------- */

export function Card({ children }: Props) {
  return <div className={cn(FRAMED, 'ai-card flex flex-col gap-3')}>{children}</div>;
}

export function CardHeader({ children }: Props) {
  return <div className="ai-card-header flex flex-col gap-0.5">{children}</div>;
}

export function CardTitle({ children }: Props) {
  return <p className="text-base leading-5 font-semibold text-label">{children}</p>;
}

export function CardDescription({ children }: Props) {
  return <p className="text-xs text-label-tertiary">{children}</p>;
}

export function CardContent({ children }: Props) {
  return (
    <div className="ai-card-content flex flex-col gap-1 text-[0.875rem] leading-5 text-label">
      {children}
    </div>
  );
}

/**
 * The footer is separated by a hairline rather than by spacing alone: it is
 * usually metadata ("ETA: tomorrow"), and on a card with several lines of
 * content the two ran together.
 */
export function CardFooter({ children }: Props) {
  return (
    <div className="ai-card-footer border-t border-border pt-2 text-[0.8125rem] leading-[1.125rem] text-label-tertiary">
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Badge                                                             */
/* ---------------------------------------------------------------- */

/**
 * shadcn's `variant`, mapped onto the app's status fills.
 *
 * The label keeps the default text colour on a tinted fill — the same choice
 * `StatusBadge` makes. Colouring the text as well doubles the signal and, on
 * the pale tints this app uses, costs contrast.
 */
const BADGE_VARIANT: Record<string, string> = {
  default: 'bg-primary-tint',
  secondary: 'bg-surface-muted',
  outline: 'border border-border',
  destructive: 'bg-danger-tint',
  success: 'bg-success-tint',
  warning: 'bg-warning-tint',
};

export function Badge({ children, variant }: Props) {
  const fill = BADGE_VARIANT[String(variant ?? 'default')] ?? BADGE_VARIANT.default;
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded-full px-2.5 py-1 text-[0.75rem] leading-4 font-medium text-label',
        fill,
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- */
/* Alert                                                             */
/* ---------------------------------------------------------------- */

/** Icon, shell and tint per level. */
const ALERT_VARIANT: Record<string, { icon: LucideIcon; shell: string; tint: string }> = {
  default: { icon: Info, shell: 'bg-surface-muted', tint: 'text-label-secondary' },
  info: { icon: Info, shell: 'bg-surface-muted', tint: 'text-label-secondary' },
  success: { icon: CheckCircle2, shell: 'bg-success-tint', tint: 'text-success' },
  warning: { icon: AlertTriangle, shell: 'bg-warning-tint', tint: 'text-warning' },
  destructive: { icon: XCircle, shell: 'bg-danger-tint', tint: 'text-danger' },
  error: { icon: XCircle, shell: 'bg-danger-tint', tint: 'text-danger' },
};

/**
 * An alert carries its level in an icon as well as in a fill. The fills are
 * pale by design, and a tint alone is easy to miss at a glance — and impossible
 * to read at all for the ~8% of men who cannot separate these hues.
 *
 * It takes the fill instead of the card, because a tinted card with a glow under
 * it reads as a surface that has come loose from the page.
 */
export function Alert({ children, variant }: Props) {
  const style = ALERT_VARIANT[String(variant ?? 'default')] ?? ALERT_VARIANT.default;
  const Icon = style.icon;
  return (
    <div
      role="note"
      className={cn('ai-alert my-2 flex w-full gap-3 rounded-[20px] p-4', style.shell)}
    >
      <Icon size={20} className={cn('mt-0.5 shrink-0', style.tint)} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{children}</div>
    </div>
  );
}

export function AlertTitle({ children }: Props) {
  return <p className="text-[0.875rem] leading-5 font-semibold text-label">{children}</p>;
}

export function AlertDescription({ children }: Props) {
  return <p className="text-[0.8125rem] leading-5 text-label-secondary">{children}</p>;
}

/* ---------------------------------------------------------------- */
/* Separator                                                         */
/* ---------------------------------------------------------------- */

export function Separator() {
  return <hr className="my-3 h-px w-full border-0 bg-border" />;
}

/* ---------------------------------------------------------------- */
/* Stat                                                              */
/* ---------------------------------------------------------------- */

const TREND = {
  up: { icon: TrendingUp, tint: 'text-success' },
  down: { icon: TrendingDown, tint: 'text-danger' },
} as const;

/**
 * A headline figure — the app's `KpiCard`, minus its icon square.
 *
 * The caps 11px label over a 20px figure is the app's KPI, so a number the
 * assistant produces reads the same as one the home screen leads with. The icon
 * tile is dropped because `Stat` has no icon prop and inventing one per label
 * would be a guess; the trend arrow takes that slot instead.
 *
 * `min-w-[45%] flex-1` because the model emits these in groups of two to four
 * inside one container, and the `.ai-artifact` rules let them share a row —
 * which is the 2-up grid the app's KPI section is laid out in.
 *
 * The trend colours mean profit and loss, not brand — a falling fuel bill is
 * good news and still renders red, because the arrow says which way it moved and
 * the reader supplies the rest. The real enum is `"up" | "down"`; anything else
 * falls through to no arrow, which reads fine.
 */
export function Stat({ label, value, trend, hint }: Props) {
  const direction = TREND[String(trend) as keyof typeof TREND];
  const Icon = direction?.icon;

  return (
    <div className={cn(FRAMED, 'ai-stat my-0 flex min-w-[45%] flex-1 flex-col gap-2 p-3')}>
      <span className="truncate text-[0.6875rem] leading-4 font-semibold tracking-wide text-label-secondary uppercase">
        {text(label)}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 truncate text-xl leading-[1.625rem] font-semibold text-label tabular-nums">
          {text(value)}
        </span>
        {Icon ? <Icon size={16} className={cn('shrink-0', direction.tint)} aria-hidden /> : null}
      </span>
      {optionalText(hint) ? (
        <span className="truncate text-xs text-label-tertiary">{text(hint)}</span>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Table                                                             */
/* ---------------------------------------------------------------- */

/**
 * The app's `InsightsTable`: a 28px heading rail in caps, hairline-divided 36px
 * rows, and figures that line up because they are tabular.
 *
 * A table is the one thing here that can genuinely outgrow a 390px screen, so it
 * scrolls inside its own box rather than pushing the transcript sideways.
 */
export function Table({ children }: Props) {
  return (
    <div className={cn(FRAMED, 'ai-table')}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">{children}</table>
      </div>
    </div>
  );
}

export function TableHeader({ children }: Props) {
  return <thead className="border-b border-border">{children}</thead>;
}

export function TableBody({ children }: Props) {
  return <tbody className="ai-table-body">{children}</tbody>;
}

export function TableFooter({ children }: Props) {
  return <tfoot className="border-t border-border">{children}</tfoot>;
}

export function TableRow({ children }: Props) {
  return <tr>{children}</tr>;
}

export function TableHead({ children }: Props) {
  return (
    <th
      scope="col"
      className="h-7 pr-3 text-left text-[0.6875rem] leading-4 font-semibold tracking-wider whitespace-nowrap text-label-secondary uppercase last:pr-0"
    >
      {children}
    </th>
  );
}

export function TableCell({ children }: Props) {
  return (
    <td className="h-9 pr-3 text-left text-[0.8125rem] leading-5 font-medium whitespace-nowrap text-label tabular-nums last:pr-0">
      {children}
    </td>
  );
}

export function TableCaption({ children }: Props) {
  return (
    <caption className="caption-bottom pt-2 text-left text-xs text-label-tertiary">
      {children}
    </caption>
  );
}

/* ---------------------------------------------------------------- */
/* Charts                                                            */
/* ---------------------------------------------------------------- */

/** The insights plot height, so a generated chart lines up with an app one. */
const PLOT_HEIGHT = 160;
/** Space the y-axis ticks get, as in `Y_AXIS_LABEL_WIDTH`. */
const AXIS_LABEL_WIDTH = 42;
/** The app draws four bands between the baseline and the top rule. */
const AXIS_SECTIONS = 4;

/** A categorical slot, by position — never cycled past the eighth. */
const seriesColor = (index: number): string => `var(--chart-${Math.min(index, 7) + 1})`;

function ChartFrame({
  title,
  subtitle,
  children,
}: {
  title?: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn(FRAMED, 'ai-chart flex flex-col gap-3')}>
      <BlockHeader title={title} subtitle={subtitle} />
      {children}
    </div>
  );
}

function EmptyChart({ title }: { title?: string }) {
  const { t } = useTranslation();
  return (
    <ChartFrame title={title}>
      <p className="text-[0.8125rem] text-label-tertiary">{t('charts.noData')}</p>
    </ChartFrame>
  );
}

/** `ChartLegend`: a dot and a caption per series, wrapped under the title. */
function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="flex items-center gap-1.5">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-xs text-label-secondary">{item.label}</span>
        </span>
      ))}
    </div>
  );
}

/** The y-axis ticks and the rules they sit on — shared by the two axis charts. */
function PlotGrid({ max, unit }: { max: number; unit?: string }) {
  return (
    <>
      {Array.from({ length: AXIS_SECTIONS + 1 }, (_, index) => {
        const fromTop = (index / AXIS_SECTIONS) * 100;
        const tick = max * (1 - index / AXIS_SECTIONS);
        return (
          <div
            key={index}
            className="pointer-events-none absolute inset-x-0 flex items-center"
            style={{ top: `${fromTop}%` }}
          >
            <span
              className="shrink-0 pr-2 text-right text-[0.625rem] leading-none text-label-tertiary tabular-nums"
              style={{ width: AXIS_LABEL_WIDTH }}
            >
              {unit && /^[$€£₽]$/.test(unit) ? unit : ''}
              {compactValue(tick)}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        );
      })}
    </>
  );
}

/** The category labels under a plot — the app's `AxisLabelsRow`. */
function AxisLabelsRow({ rows }: { rows: ChartDatum[] }) {
  const step = labelStep(rows.length);
  return (
    <div className="flex" style={{ paddingLeft: AXIS_LABEL_WIDTH }}>
      {rows.map((row, index) => (
        <span
          key={`${row.label}-${index}`}
          className="min-w-0 flex-1 truncate text-center text-[0.625rem] leading-4 text-label-tertiary"
        >
          {index % step === 0 ? row.label : ''}
        </span>
      ))}
    </div>
  );
}

/**
 * Vertical bars on a labelled axis — the shape `ProfitabilityTrendCard` draws.
 *
 * Built from elements rather than SVG: the text stays crisp at any width, and
 * the plot reflows with the card instead of being scaled from a fixed viewBox.
 * Bars keep the app's 3px top radius and its 22px cap, so two bars do not become
 * one slab on a short series.
 *
 * `horizontal` exists on the backend's `BarChart` and is read here only so its
 * presence is not a surprise; the app draws these vertically and so do we.
 */
export function BarChart({ title, subtitle, unit, data }: Props) {
  const rows = toChartData(data);
  const caption = optionalText(title);
  if (rows.length === 0) return <EmptyChart title={caption} />;

  const max = axisMax(rows.map((row) => row.value));

  return (
    <ChartFrame title={caption} subtitle={optionalText(subtitle)}>
      <div className="ai-plot">
        <div className="relative" style={{ height: PLOT_HEIGHT }}>
          <PlotGrid max={max} unit={optionalText(unit)} />
          <div
            className="absolute inset-0 flex items-end gap-1"
            style={{ paddingLeft: AXIS_LABEL_WIDTH }}
          >
            {rows.map((row, index) => (
              <span
                key={`${row.label}-${index}`}
                className="flex min-w-0 flex-1 justify-center"
                style={{ height: '100%' }}
                title={`${row.label}: ${formatValue(row.value, optionalText(unit))}`}
              >
                <span
                  className="mt-auto w-full max-w-[22px] rounded-t-[3px]"
                  style={{
                    height: `${Math.max(1, (Math.max(0, row.value) / max) * 100)}%`,
                    backgroundColor: seriesColor(0),
                  }}
                />
              </span>
            ))}
          </div>
        </div>
        <AxisLabelsRow rows={rows} />
      </div>
    </ChartFrame>
  );
}

/**
 * A trend, as the app draws it: a curved area chart, 2px stroke, its fill fading
 * from a quarter opacity at the line down to almost nothing at the baseline.
 *
 * SVG for the curve only — the axis labels are elements beside it, the same
 * split the app makes with `AxisLabelsRow`, because text inside a
 * `preserveAspectRatio="none"` viewBox would be stretched with it.
 */
export function LineChart({ title, subtitle, unit, data }: Props) {
  const { t } = useTranslation();
  const rows = toChartData(data);
  const caption = optionalText(title);
  if (rows.length === 0) return <EmptyChart title={caption} />;

  const max = axisMax(rows.map((row) => row.value));
  const width = 300;
  const height = 100;

  const points = rows.map((row, index) => ({
    x: rows.length > 1 ? (index / (rows.length - 1)) * width : width / 2,
    y: height - (Math.max(0, row.value) / max) * height,
  }));

  // Quadratic smoothing through the midpoints — the same rounded shape
  // `CurveType.QUADRATIC` gives, without a curve-fitting dependency.
  const line = points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
    const previous = points[index - 1];
    const midX = (previous.x + point.x) / 2;
    return `${path} Q ${previous.x.toFixed(1)} ${previous.y.toFixed(1)} ${midX.toFixed(1)} ${(
      (previous.y + point.y) /
      2
    ).toFixed(1)} T ${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
  }, '');
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const gradientId = `ai-line-fill-${rows.length}-${Math.round(max)}`;

  return (
    <ChartFrame title={caption} subtitle={optionalText(subtitle)}>
      <div className="ai-plot">
        <div className="relative" style={{ height: PLOT_HEIGHT }}>
          <PlotGrid max={max} unit={optionalText(unit)} />
          <div className="absolute inset-0" style={{ paddingLeft: AXIS_LABEL_WIDTH }}>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              className="size-full"
              role="img"
              aria-label={caption ?? t('charts.lineChart')}
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={seriesColor(0)} stopOpacity="0.25" />
                  <stop offset="100%" stopColor={seriesColor(0)} stopOpacity="0.03" />
                </linearGradient>
              </defs>
              <path d={area} fill={`url(#${gradientId})`} />
              <path
                d={line}
                fill="none"
                stroke={seriesColor(0)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        </div>
        <AxisLabelsRow rows={rows} />
      </div>
    </ChartFrame>
  );
}

/** Past this many slices the tail is collected into one — the app's rule. */
const MAX_SLICES = 5;
/** The donut's geometry: `radius` and `innerRadius = radius - 24` in the app. */
const DONUT_RADIUS = 60;
const DONUT_STROKE = 24;

/**
 * Shares of a whole, as the donut the load-status and factoring cards draw: the
 * total in the hole, the legend beside it carrying the identity.
 *
 * Drawn with one circle per slice and a dash offset rather than with arc paths —
 * a stroked circle is one element per slice, has no join seams between
 * neighbours, and needs no trigonometry to be right.
 *
 * The tail past five slices becomes "Other" in the tertiary ink. A donut with
 * fifteen wedges is a colour wheel, not a chart, and the app caps it for the
 * same reason.
 */
export function PieChart({ title, subtitle, unit, data }: Props) {
  const { t } = useTranslation();
  const rows = toChartData(data);
  const caption = optionalText(title);
  if (rows.length === 0) return <EmptyChart title={caption} />;

  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, MAX_SLICES);
  const tail = sorted.slice(MAX_SLICES);
  const slices =
    tail.length > 0
      ? [...head, { label: t('charts.other'), value: tail.reduce((sum, row) => sum + row.value, 0) }]
      : head;

  const total = slices.reduce((sum, row) => sum + Math.max(0, row.value), 0);
  if (total <= 0) return <EmptyChart title={caption} />;

  /** The collected tail is grey — it is a remainder, not a category. */
  const sliceColor = (label: string, index: number): string =>
    label === t('charts.other') && tail.length > 0 ? 'var(--color-label-tertiary)' : seriesColor(index);

  const circumference = 2 * Math.PI * DONUT_RADIUS;
  const box = (DONUT_RADIUS + DONUT_STROKE / 2) * 2;

  // Each slice's arc and where it starts, resolved before the JSX rather than by
  // a running total inside the map: a render pass must not carry state forward
  // between its own elements, and the offsets are a property of the data anyway.
  const arcs = slices.reduce<{ dash: number; start: number; label: string; value: number }[]>(
    (out, slice) => {
      const dash = (Math.max(0, slice.value) / total) * circumference;
      const start = out.length > 0 ? out[out.length - 1].start + out[out.length - 1].dash : 0;
      out.push({ dash, start, label: slice.label, value: slice.value });
      return out;
    },
    [],
  );

  return (
    <ChartFrame title={caption} subtitle={optionalText(subtitle)}>
      <div className="flex flex-col items-center gap-4">
        <div className="relative" style={{ width: box, height: box }}>
          <svg viewBox={`0 0 ${box} ${box}`} className="size-full" role="img" aria-label={caption}>
            {/* -90° so the first slice starts at twelve o'clock. */}
            <g transform={`rotate(-90 ${box / 2} ${box / 2})`}>
              {arcs.map((arc, index) => (
                <circle
                  key={`${arc.label}-${index}`}
                  cx={box / 2}
                  cy={box / 2}
                  r={DONUT_RADIUS}
                  fill="none"
                  stroke={sliceColor(arc.label, index)}
                  strokeWidth={DONUT_STROKE}
                  strokeDasharray={`${arc.dash} ${circumference - arc.dash}`}
                  strokeDashoffset={-arc.start}
                />
              ))}
            </g>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg leading-6 font-semibold text-label tabular-nums">
              {formatValue(total, optionalText(unit))}
            </span>
            <span className="text-xs text-label-secondary">{t('charts.total')}</span>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2">
          <ChartLegend
            items={slices.map((slice, index) => ({
              label: slice.label,
              color: sliceColor(slice.label, index),
            }))}
          />
          {slices.map((slice, index) => (
            <div key={`${slice.label}-${index}`} className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-label-secondary">
                {slice.label}
              </span>
              <span className="shrink-0 text-[0.8125rem] font-medium text-label tabular-nums">
                {formatValue(slice.value, optionalText(unit))}
              </span>
              <span className="w-9 shrink-0 text-right text-xs text-label-tertiary tabular-nums">
                {Math.round((Math.max(0, slice.value) / total) * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </ChartFrame>
  );
}

/* ---------------------------------------------------------------- */
/* PlacesMap                                                         */
/* ---------------------------------------------------------------- */

interface Place {
  name: string;
  address?: string;
  phone?: string;
  rating?: number;
}

/**
 * Places, as a list.
 *
 * Deliberately not a map: the page is served from `file://` under a CSP that
 * blocks every external host, so there are no tiles to draw and no geocoder to
 * call — a map frame here could only ever be an empty grey box. The name,
 * address, rating and phone are what the answer was actually about, and the
 * coordinates are carried but not shown, since a lat/lng pair means nothing to
 * read.
 *
 * The rows are hairline-divided like the app's tables, and the icon sits in the
 * app's `TILE_SURFACE` square.
 */
export function PlacesMap({ places }: Props) {
  const rows: Place[] = (Array.isArray(places) ? places : [])
    .map((entry): Place | null => {
      if (!isRecord(entry)) return null;
      const name = optionalText(entry.name ?? entry.title);
      if (!name) return null;
      return {
        name,
        address: optionalText(entry.address ?? entry.vicinity),
        phone: optionalText(entry.phone ?? entry.phone_number),
        rating: optionalNumber(entry.rating),
      };
    })
    .filter((place): place is Place => place !== null);

  if (rows.length === 0) return null;

  return (
    <div className={cn(FRAMED, 'ai-places flex flex-col')}>
      {rows.map((place, index) => (
        <div
          key={`${place.name}-${index}`}
          className="flex items-start gap-3 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
        >
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-surface-muted text-label">
            <MapPin size={16} aria-hidden />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-[0.8125rem] leading-5 font-medium text-label">{place.name}</span>
            {place.address ? (
              <span className="text-xs leading-[1.125rem] text-label-secondary">
                {place.address}
              </span>
            ) : null}
            {place.rating !== undefined || place.phone ? (
              <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                {place.rating !== undefined ? (
                  <span className="flex items-center gap-1 text-xs text-label-tertiary tabular-nums">
                    <Star size={12} aria-hidden />
                    {place.rating.toFixed(1)}
                  </span>
                ) : null}
                {place.phone ? (
                  <span className="flex items-center gap-1 text-xs text-label-tertiary">
                    <Phone size={12} aria-hidden />
                    {place.phone}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Progress                                                          */
/* ---------------------------------------------------------------- */

/** The mockup's units, from `SegmentedProgressBar` (Figma `2440-45972`). */
const SEGMENT_WIDTH = 6;
const SEGMENT_GAP = 1;
const BAR_HEIGHT = 20;

/**
 * A completion bar — the app's `SegmentedProgressBar`.
 *
 * Not a plain two-part strip: the remainder is drawn as individual 6px blocks
 * with a hairline between them, which is the form the home screen's mockup is
 * in. `value` is the **percentage itself** (`70`, not `0.7`) and `label` is a
 * caption beside it.
 *
 * The native one can also draw one block per outstanding *unit* when it is given
 * a count small enough to take in at a glance. The model sends no such count, so
 * this is the proportional form only — the blocks tile the empty part of the
 * track and stand for nothing in particular, which is the same fallback the app
 * takes when the count does not fit.
 */
export function Progress({ value, label }: Props) {
  const pct = Math.min(100, Math.max(0, optionalNumber(value) ?? 0));
  const caption = optionalText(label);

  return (
    <div className="ai-progress my-2 flex w-full flex-col gap-1.5">
      {caption ? (
        <div className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 truncate text-[0.8125rem] text-label-secondary">{caption}</span>
          <span className="shrink-0 text-[0.8125rem] font-medium text-label tabular-nums">
            {Math.round(pct)}%
          </span>
        </div>
      ) : null}
      <div
        className="flex w-full overflow-hidden rounded-md"
        style={{ height: BAR_HEIGHT, gap: SEGMENT_GAP }}
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={caption}
      >
        {pct > 0 ? <span className="bg-primary-disabled" style={{ flexGrow: pct }} /> : null}
        {pct < 100 ? (
          // The track, tiled: `repeating-linear-gradient` draws the blocks and
          // their hairlines in one element, so the count follows the width with
          // no measurement — the native version needs `onLayout` for this only
          // because React Native has no gradients in a class.
          <span
            style={{
              flexGrow: 100 - pct,
              backgroundImage: `repeating-linear-gradient(to right, var(--color-primary-tint) 0 ${SEGMENT_WIDTH}px, transparent ${SEGMENT_WIDTH}px ${SEGMENT_WIDTH + SEGMENT_GAP}px)`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The model's own layout container.
 *
 * `div` is mapped through the whitelist like any other tag so that a box the
 * *model* wrote is marked, positively, with a class of its own. The layout rules
 * in `index.css` then key on `.ai-box` rather than on a div *lacking* a class.
 *
 * That distinction is not academic: keying on the absence of a class silently
 * captured our own wrappers too, and a classless `<div>` inside `BarChart` and
 * `LineChart` was turned into a wrapping flex row — which laid the plot beside
 * its axis labels and collapsed both. Only `PieChart`, whose wrapper happened to
 * carry a class, survived. A positive mark cannot do that.
 */
export function ArtifactBox({ children }: Props) {
  return <div className="ai-box">{children}</div>;
}

/**
 * Tags the model reaches for that must not behave like themselves.
 *
 * A link or a button in a generated view has nothing to do — there is no route
 * to follow and no handler to fire, and the page is inside a WebView where a
 * navigation would replace the chat. Rendering the label as plain text keeps the
 * sentence intact without offering a control that does nothing.
 */
export function InertText({ children }: Props) {
  return <span className="text-label">{children}</span>;
}
