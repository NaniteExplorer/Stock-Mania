"use client";

/**
 * Several instruments and a benchmark on one axis, rebased to 100.
 *
 * Rebasing is not decoration, it is the only honest way to put a ₹40 000 share
 * and a 24 000-point index on the same plot: `src/ui/charts.tsx` refuses a second
 * y-scale on purpose, and "indexed to a common base" is the escape it names.
 * Every series here therefore starts at exactly 100 on the same day, and the day
 * is stated rather than assumed — a series that has no bar on the common start
 * date is not silently shifted to whichever day it does have.
 *
 * **Why this file draws its own `LineChart` instead of using `LineSeries`.**
 * `LineSeries` formats every value through `Money`, which is right for a price
 * and wrong for an index: "₹127.40" for "up 27.4%" is a number that means
 * nothing. So the wrapper — legend, empty state, table view, reduced-motion
 * context — is reused as-is, and only the axis and tooltip formatting differ.
 * No charting dependency is added; recharts is the same one `src/ui/charts.tsx`
 * already draws with.
 *
 * The index is carried as an integer in **hundredths of a point**: 100.00 is
 * 10 000. The division happens once, on the server, on scaled integers (C8), and
 * this file only ever divides by 100 to print.
 */

import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CHART_SERIES, Chart, useChartAnimation, type SeriesMeta } from "@/ui/charts";

export interface ComparisonSeries {
  id: string;
  label: string;
  /** True for the index the holdings are being measured against. */
  benchmark: boolean;
  /** The first date this series has a bar for, which may be after the base date. */
  firstPoint: string | null;
  points: number;
}

export interface ComparisonPoint {
  x: string;
  /** Index in hundredths of a point, keyed by series id. Absent where no bar. */
  [seriesId: string]: string | number | undefined;
}

const GRID = "var(--border)";
const AXIS_TEXT = "var(--gray-500)";
const SURFACE = "var(--card)";

const formatIndex = (value: number): string => (value / 100).toFixed(0);

function IndexTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: readonly { name?: string; value?: number | string; color?: string; dataKey?: string | number }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-gray-600 bg-gray-800 px-3 py-2 shadow-lg">
      {label !== undefined && <p className="mb-1 text-xs font-medium text-gray-400">{String(label)}</p>}
      <ul className="space-y-0.5">
        {payload.map((item) => (
          <li key={String(item.dataKey)} className="flex items-center gap-2 text-xs">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: item.color }} />
            <span className="text-gray-400">{item.name}</span>
            <span className="tnum ml-auto text-gray-100">
              {typeof item.value === "number" ? (item.value / 100).toFixed(2) : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ComparisonChart({
  series,
  data,
  baseDate,
  partial = [],
}: {
  series: readonly ComparisonSeries[];
  data: readonly ComparisonPoint[];
  baseDate: string | null;
  /** Series that could not start on the base date, and why. */
  partial?: readonly string[];
}) {
  const animate = useChartAnimation();
  const legend: readonly SeriesMeta[] = series.map((one) => ({ id: one.id, label: one.label }));

  const empty =
    series.length === 0 ? (
      <p className="rounded-lg border border-gray-600/70 p-4 text-sm text-gray-500">
        Choose at least one holding to compare. A benchmark on its own has nothing to be a benchmark for.
      </p>
    ) : data.length === 0 ? (
      <p className="rounded-lg border border-gray-600/70 p-4 text-sm text-gray-500">
        None of the chosen series has stored daily bars in a shared window, so there is no common start date to rebase
        from. Back-fill their histories and try again — a chart drawn from one series and a guess is worse than none.
      </p>
    ) : undefined;

  return (
    <div>
      {partial.length > 0 && (
        <p role="status" className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 text-xs text-amber-300">
          Partial coverage: {partial.join(" ")} Those lines begin where their data does, not at the base date, so their
          first visible point is not 100.
        </p>
      )}

      <Chart
        title="Indexed performance"
        subtitle={baseDate ? `Every series rebased to 100 on ${baseDate}` : "No common start date"}
        series={legend}
        height={320}
        empty={empty}
        tableView={() => (
          <div className="table-scroll max-h-80">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-800">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left text-xs text-gray-500">Date</th>
                  {series.map((one) => (
                    <th key={one.id} scope="col" className="px-3 py-2 text-right text-xs text-gray-500">
                      {one.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((point) => (
                  <tr key={point.x} className="border-t border-gray-700">
                    <td className="px-3 py-1.5 text-gray-300">{point.x}</td>
                    {series.map((one) => (
                      <td key={one.id} className="tnum px-3 py-1.5 text-right text-gray-200">
                        {typeof point[one.id] === "number" ? (Number(point[one.id]) / 100).toFixed(2) : "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      >
        <LineChart data={data as ComparisonPoint[]} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
          <XAxis dataKey="x" stroke={GRID} strokeWidth={1} tickLine={false} tick={{ fill: AXIS_TEXT, fontSize: 11 }} />
          <YAxis
            stroke={GRID}
            strokeWidth={1}
            tickLine={false}
            tick={{ fill: AXIS_TEXT, fontSize: 11 }}
            tickFormatter={formatIndex}
            width={52}
          />
          {/* The base line. Above it the series has gained since the start date. */}
          <ReferenceLine y={10000} stroke={GRID} strokeDasharray="4 4" />
          <Tooltip content={<IndexTooltip />} cursor={{ stroke: GRID }} />
          {series.map((one, index) => (
            <Line
              key={one.id}
              type="monotone"
              dataKey={one.id}
              name={one.label}
              stroke={CHART_SERIES[index % CHART_SERIES.length]}
              /* The benchmark is deliberately thinner and dashed: it is the
                 reference, not a holding, and colour alone would not say so. */
              strokeWidth={one.benchmark ? 1.5 : 2}
              strokeDasharray={one.benchmark ? "5 4" : undefined}
              strokeLinecap="round"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: SURFACE }}
              isAnimationActive={animate}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </Chart>

      <ul className="mt-3 space-y-1 text-xs text-gray-500">
        {series.map((one, index) => (
          <li key={one.id} className="flex flex-wrap items-center gap-2">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: CHART_SERIES[index % CHART_SERIES.length] }}
            />
            <span className="text-gray-300">{one.label}</span>
            <span>{one.benchmark ? "benchmark" : "holding"}</span>
            <span>· {one.points} daily bars</span>
            {one.firstPoint && <span>· from {one.firstPoint}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
