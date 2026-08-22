"use client";

import * as React from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Money, Currency } from "@/core/money";
import { cn } from "@/lib/utils";
import { MoneyText } from "./primitives";
import { formatMoneyCompact } from "./format";

/**
 * The chart kit.
 *
 * One `<Chart>` wrapper owns everything that must be identical across charts —
 * the palette, the legend rule, the empty and loading states, the table view and
 * the reduced-motion path — so an individual chart cannot quietly disagree with
 * the others.
 *
 * Three rules are enforced structurally rather than by convention:
 *
 *  - **No dual axis.** There is no prop for a second y-scale. Two measures of
 *    different magnitude are two charts, or indexed to a common base. It is the
 *    most common charting mistake and the only defence is not offering it.
 *  - **Series colours are assigned in fixed order and never cycled.** Past the
 *    fifth series the palette is exhausted; `foldSeries` returns the top five plus
 *    an "Other" aggregate rather than inventing a sixth hue.
 *  - **Text never wears the series colour.** Marks carry identity; labels, ticks
 *    and tooltip text stay in the ink tokens.
 *
 * The palette itself is validated — see the comment on `--chart-*` in tokens.css.
 * Scatter and small-multiple forms, where any two marks can touch, are capped at
 * `SCATTER_SAFE_SERIES` because only the first three slots pass the harder
 * all-pairs colour-separation test.
 */

/** Fixed order. Index 0 is always series 1. */
export const CHART_SERIES = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/** Only the first three slots clear the all-pairs separation check. */
export const SCATTER_SAFE_SERIES = 3;

const GRID = "var(--border)";
const AXIS_TEXT = "var(--gray-500)";
const SURFACE = "var(--card)";

export interface SeriesMeta {
  /** Key into each datum. */
  id: string;
  label: string;
}

/**
 * Collapses a long series list into the five the palette can distinguish plus an
 * aggregate. A sixth hue would either repeat or be un-validated; neither is
 * acceptable, and "Other" is honest.
 */
export function foldSeries<T extends { id: string }>(
  series: readonly T[],
  limit = CHART_SERIES.length,
): { kept: readonly T[]; folded: readonly T[] } {
  if (series.length <= limit) return { kept: series, folded: [] };
  return { kept: series.slice(0, limit - 1), folded: series.slice(limit - 1) };
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPreference(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Respects the OS reduced-motion setting; Recharts animates by default.
 *
 * `useSyncExternalStore` rather than an effect writing state: matchMedia is
 * external state, and reading it in an effect means the first paint animates and
 * is then corrected — which is exactly the motion the setting asks us not to
 * show. The server snapshot is `false` so SSR markup stays stable.
 */
function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeToMotionPreference,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

const ChartContext = React.createContext<{ animate: boolean }>({ animate: true });

export const useChartAnimation = () => React.useContext(ChartContext).animate;

/* ═══ The wrapper ════════════════════════════════════════════════════════ */

export function Chart({
  title,
  subtitle,
  series,
  height = 260,
  empty,
  loading = false,
  tableView,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Drives the legend. One series renders no legend — the title names it. */
  series: readonly SeriesMeta[];
  height?: number;
  /** Rendered instead of the plot when there is nothing to draw. */
  empty?: React.ReactNode;
  loading?: boolean;
  /**
   * The same numbers as a table. This is the accessibility escape hatch and the
   * reason a contrast warning is never fatal: the values are always reachable.
   */
  tableView?: () => React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const reduced = usePrefersReducedMotion();
  const [showTable, setShowTable] = React.useState(false);

  return (
    <ChartContext.Provider value={{ animate: !reduced }}>
      <figure className={cn("panel p-5", className)}>
        <figcaption className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-100">{title}</h3>
            {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
          </div>
          {tableView && !empty && (
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              className="focus-brand rounded-lg border border-gray-600 px-2.5 py-1 text-xs font-medium text-gray-400 transition-colors hover:text-gray-100"
              aria-pressed={showTable}
            >
              {showTable ? "View chart" : "View as table"}
            </button>
          )}
        </figcaption>

        {/* A legend is the dependable identity channel: never colour alone. */}
        {series.length > 1 && !empty && (
          <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {series.map((item, index) => (
              <li key={item.id} className="flex items-center gap-1.5 text-xs text-gray-400">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: CHART_SERIES[index % CHART_SERIES.length] }}
                />
                {item.label}
              </li>
            ))}
          </ul>
        )}

        {empty ? (
          empty
        ) : loading ? (
          <div
            className="animate-pulse rounded-xl bg-gray-700/40"
            style={{ height }}
            aria-label="Loading chart"
          />
        ) : showTable && tableView ? (
          tableView()
        ) : (
          <div style={{ height }}>
            <ResponsiveContainer width="100%" height="100%">
              {children as React.ReactElement}
            </ResponsiveContainer>
          </div>
        )}
      </figure>
    </ChartContext.Provider>
  );
}

/* ═══ Shared axis / tooltip pieces ═══════════════════════════════════════ */

const axisProps = {
  stroke: GRID,
  strokeWidth: 1,
  tick: { fill: AXIS_TEXT, fontSize: 11 },
  tickLine: false,
} as const;

/**
 * Money ticks and tooltip values, compact — never a raw float.
 *
 * Recharts hands us plain numbers because that is what it can scale, so the minor
 * units come back through `Money.fromMinor` before anything is formatted. The
 * rounding is on the axis tick, not on a stored amount.
 */
const toMoney = (minor: number, code: string): Money =>
  Money.fromMinor(BigInt(Math.round(minor)), Currency.of(code));

const moneyTick = (minor: number, code: string) => formatMoneyCompact(toMoney(minor, code));

interface TooltipDatum {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
}

/**
 * The tooltip. Values render through `MoneyText`, so a figure in a tooltip is
 * formatted by exactly the same code as a figure in a table.
 */
function MoneyTooltip({
  active,
  payload,
  label,
  currency,
}: {
  active?: boolean;
  payload?: readonly TooltipDatum[];
  label?: string | number;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-gray-600 bg-gray-800 px-3 py-2 shadow-lg">
      {label !== undefined && (
        <p className="mb-1 text-xs font-medium text-gray-400">{String(label)}</p>
      )}
      <ul className="space-y-0.5">
        {payload.map((item) => (
          <li key={String(item.dataKey)} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: item.color }}
            />
            <span className="text-gray-400">{item.name}</span>
            <MoneyText
              className="ml-auto"
              tone="neutral"
              value={typeof item.value === "number" ? toMoney(item.value, currency) : null}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ═══ Line ═══════════════════════════════════════════════════════════════ */

export interface SeriesPoint {
  /** Category or date label for the x axis. */
  x: string;
  /** Minor units, keyed by series id. */
  [seriesId: string]: string | number;
}

export function LineSeries({
  data,
  series,
  currency = "INR",
  area = false,
}: {
  data: readonly SeriesPoint[];
  series: readonly SeriesMeta[];
  currency?: string;
  /** A single-series line may carry a 10% wash beneath it. Never for several. */
  area?: boolean;
}) {
  const animate = useChartAnimation();
  const single = series.length === 1;

  if (area && single) {
    return (
      <AreaChart data={data as SeriesPoint[]} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
        <XAxis dataKey="x" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v: number) => moneyTick(v, currency)} width={64} />
        <Tooltip content={<MoneyTooltip currency={currency} />} cursor={{ stroke: GRID }} />
        <Area
          type="monotone"
          dataKey={series[0].id}
          name={series[0].label}
          stroke={CHART_SERIES[0]}
          strokeWidth={2}
          fill={CHART_SERIES[0]}
          fillOpacity={0.1}
          isAnimationActive={animate}
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: SURFACE }}
        />
      </AreaChart>
    );
  }

  return (
    <LineChart data={data as SeriesPoint[]} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
      <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
      <XAxis dataKey="x" {...axisProps} />
      <YAxis {...axisProps} tickFormatter={(v: number) => moneyTick(v, currency)} width={64} />
      <Tooltip content={<MoneyTooltip currency={currency} />} cursor={{ stroke: GRID }} />
      {series.map((item, index) => (
        <Line
          key={item.id}
          type="monotone"
          dataKey={item.id}
          name={item.label}
          stroke={CHART_SERIES[index % CHART_SERIES.length]}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          dot={false}
          /* 2px surface ring keeps the marker legible where lines cross. */
          activeDot={{ r: 4, strokeWidth: 2, stroke: SURFACE }}
          isAnimationActive={animate}
        />
      ))}
    </LineChart>
  );
}

/* ═══ Bar ════════════════════════════════════════════════════════════════ */

export function BarSeries({
  data,
  series,
  currency = "INR",
  stacked = false,
}: {
  data: readonly SeriesPoint[];
  series: readonly SeriesMeta[];
  currency?: string;
  stacked?: boolean;
}) {
  const animate = useChartAnimation();

  return (
    <BarChart data={data as SeriesPoint[]} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
      <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
      <XAxis dataKey="x" {...axisProps} />
      <YAxis {...axisProps} tickFormatter={(v: number) => moneyTick(v, currency)} width={64} />
      <Tooltip content={<MoneyTooltip currency={currency} />} cursor={{ fill: "transparent" }} />
      {series.map((item, index) => (
        <Bar
          key={item.id}
          dataKey={item.id}
          name={item.label}
          stackId={stacked ? "one" : undefined}
          fill={CHART_SERIES[index % CHART_SERIES.length]}
          /* Cap the thickness — never fill the band; the leftover is air. */
          maxBarSize={24}
          /* 4px rounded data-end, square at the baseline. */
          radius={stacked ? 0 : [4, 4, 0, 0]}
          isAnimationActive={animate}
        />
      ))}
    </BarChart>
  );
}

/* ═══ Donut ══════════════════════════════════════════════════════════════ */

export interface Slice {
  id: string;
  label: string;
  /** Minor units. */
  value: number;
}

export function DonutSeries({
  slices,
  currency = "INR",
}: {
  slices: readonly Slice[];
  currency?: string;
}) {
  const animate = useChartAnimation();

  return (
    <PieChart>
      <Tooltip content={<MoneyTooltip currency={currency} />} />
      <Pie
        data={slices as Slice[]}
        dataKey="value"
        nameKey="label"
        innerRadius="58%"
        outerRadius="82%"
        /* 2px of surface between adjacent segments, the same everywhere. */
        paddingAngle={1}
        stroke={SURFACE}
        strokeWidth={2}
        isAnimationActive={animate}
      >
        {slices.map((slice, index) => (
          <Cell key={slice.id} fill={CHART_SERIES[index % CHART_SERIES.length]} />
        ))}
      </Pie>
      <Legend
        verticalAlign="bottom"
        formatter={(value: string) => <span className="text-xs text-gray-400">{value}</span>}
      />
    </PieChart>
  );
}
