"use client";

/**
 * Inception to today, from `price_bars`, with the live last price on the end.
 *
 * Three things this chart refuses to do, because each of them is a way a price
 * chart lies:
 *
 *  - **It does not connect across a hole.** A missing day is `null`, not an
 *    interpolated point, so a series with all of 2019 absent draws a break rather
 *    than a smooth line through a year nobody has data for. `coverage` cannot see
 *    that — it reports outer bounds — which is why the server hands us `gaps()`
 *    and why the count is spelled out under the plot instead of being left to the
 *    eye.
 *  - **It does not thin by dropping points.** Twenty years of daily bars is more
 *    marks than pixels, so long ranges are bucketed; but a bucket with no bar
 *    stays `null`, so bucketing narrows the resolution without ever closing a
 *    gap. The bucket width is named in the subtitle rather than implied.
 *  - **It does not present a stale quote as current.** When the catalogue has
 *    marked the quote key dead (C6) the badge says so and names the key, because
 *    the holding is still valued at its last known close and the user is the only
 *    one who can decide whether that is acceptable.
 *
 * Built on `src/ui/charts.tsx`: `Chart` owns the legend, the empty state, the
 * loading skeleton, the table view and the reduced-motion context, so this file
 * owns only the range selector and the shape of the series.
 */

import * as React from "react";
import { DatabaseZap } from "lucide-react";
import { useRouter } from "next/navigation";
import { Chart, LineSeries, type SeriesPoint } from "@/ui/charts";

export interface PriceHistoryPoint {
  /** ISO date. */
  on: string;
  /** Minor units of the instrument's currency. `null` where no bar exists. */
  closeMinor: number | null;
}

export interface PriceHistoryGap {
  from: string;
  to: string;
  weekdays: number;
}

const RANGES = [
  { id: "1M", days: 31 },
  { id: "6M", days: 186 },
  { id: "1Y", days: 366 },
  { id: "5Y", days: 1827 },
  { id: "All", days: Number.MAX_SAFE_INTEGER },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

/** More marks than this and the line is drawing over itself, not informing. */
const MAX_DRAWN_POINTS = 420;

const SERIES = [{ id: "close", label: "Close" }] as const;

export default function PriceHistoryChart({
  symbol,
  instrumentId,
  currency,
  points,
  live,
  gaps,
  quoteKey,
  quoteStale,
  firstTradeDate,
  error = null,
  loading = false,
}: {
  symbol: string;
  instrumentId: string;
  currency: string;
  points: readonly PriceHistoryPoint[];
  /** The latest resolved quote, appended past the last stored bar. */
  live: { on: string; closeMinor: number } | null;
  gaps: readonly PriceHistoryGap[];
  quoteKey: string | null;
  quoteStale: boolean;
  firstTradeDate: string | null;
  error?: string | null;
  loading?: boolean;
}) {
  const router = useRouter();
  const [range, setRange] = React.useState<RangeId>("1Y");
  const [historyState, setHistoryState] = React.useState<{
    status: "idle" | "loading" | "success" | "error";
    message: string;
  }>({ status: "idle", message: "" });

  const series = React.useMemo<readonly PriceHistoryPoint[]>(() => {
    if (!live) return points;
    const last = points[points.length - 1];
    if (last && last.on >= live.on) return points;
    return [...points, { on: live.on, closeMinor: live.closeMinor }];
  }, [points, live]);

  const days = RANGES.find((option) => option.id === range)?.days ?? 366;
  const windowed = React.useMemo(
    () => (series.length > days ? series.slice(series.length - days) : series),
    [series, days],
  );

  /*
   * Bucket only when there is more data than the plot can draw. `stride === 1`
   * is the common case and costs nothing; above it, each bucket reports its last
   * non-null close, and reports `null` when the whole bucket is a hole.
   */
  const stride = Math.max(1, Math.ceil(windowed.length / MAX_DRAWN_POINTS));
  const data = React.useMemo<SeriesPoint[]>(() => {
    const out: SeriesPoint[] = [];
    for (let index = 0; index < windowed.length; index += stride) {
      const bucket = windowed.slice(index, index + stride);
      let close: number | null = null;
      for (let step = bucket.length - 1; step >= 0; step -= 1) {
        if (bucket[step].closeMinor !== null) {
          close = bucket[step].closeMinor;
          break;
        }
      }
      const label = bucket[bucket.length - 1].on;
      out.push(close === null ? { x: label } : { x: label, close });
    }
    return out;
  }, [windowed, stride]);

  const drawn = data.filter((point) => point.close !== undefined).length;
  const visibleGaps = windowed.length > 0
    ? gaps.filter((gap) => gap.to >= windowed[0].on && gap.from <= windowed[windowed.length - 1].on)
    : [];

  const subtitle = [
    quoteKey ? `Adjusted daily closes for ${quoteKey}` : `Adjusted daily closes for ${symbol}`,
    firstTradeDate ? `first traded ${firstTradeDate}` : null,
    stride > 1 ? `bucketed to ${stride} trading days at this range` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  async function loadHistory() {
    setHistoryState({ status: "loading", message: "Loading daily history..." });
    try {
      const response = await fetch(`/api/instruments/${instrumentId}/backfill`, { method: "POST" });
      const body = await response.json() as {
        ok?: boolean;
        appended?: number;
        skipped?: string | null;
        error?: string;
      };
      if (!response.ok || !body.ok) {
        setHistoryState({ status: "error", message: body.error ?? "Price history could not be loaded." });
        return;
      }
      const appended = body.appended ?? 0;
      setHistoryState({
        status: "success",
        message: appended > 0
          ? `Loaded ${appended} daily price points.`
          : (body.skipped ?? "History is already current."),
      });
      router.refresh();
    } catch {
      setHistoryState({ status: "error", message: "Price history could not be loaded. Try again later." });
    }
  }

  const controls = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Chart range">
        {RANGES.map((option) => {
        const active = option.id === range;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => setRange(option.id)}
            className={
              active
                ? "focus-brand rounded-lg border border-brand-500/70 bg-brand-500/10 px-2.5 py-1 text-xs font-medium text-brand-200"
                : "focus-brand rounded-lg border border-gray-600 px-2.5 py-1 text-xs font-medium text-gray-400 transition-colors hover:text-gray-100"
            }
          >
            {option.id}
          </button>
        );
        })}
      </div>
      <button
        type="button"
        onClick={loadHistory}
        disabled={historyState.status === "loading"}
        className="ghost-btn h-8 gap-2 px-3 text-xs disabled:cursor-wait disabled:opacity-60"
      >
        <DatabaseZap aria-hidden="true" className="h-3.5 w-3.5" />
        {historyState.status === "loading" ? "Loading history" : "Load price history"}
      </button>
    </div>
  );

  const badges = (
    <div className="mb-3 flex flex-wrap gap-2">
      {quoteStale && (
        <span className="rounded border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
          Quote key {quoteKey ?? symbol} has stopped resolving. The holding is still valued at its last known close.
        </span>
      )}
      {live && (
        <span className="rounded border border-gray-600 px-2 py-1 text-[11px] text-gray-400">
          Latest stored close {live.on}
        </span>
      )}
      {historyState.message && (
        <span
          role={historyState.status === "error" ? "alert" : "status"}
          className={historyState.status === "error" ? "text-xs text-red-300" : "text-xs text-green-400"}
        >
          {historyState.message}
        </span>
      )}
    </div>
  );

  const empty = error ? (
    <p role="alert" className="rounded-lg border border-red-500/40 bg-red-500/[0.06] p-4 text-sm text-red-300">
      {error}
    </p>
  ) : drawn < 2 ? (
    <p className="rounded-lg border border-gray-600/70 p-4 text-sm text-gray-500">
      {drawn === 0 ? "No daily history is stored" : "Only one closing observation is stored"} for {symbol}. Load price
      history to draw a trend; a single point cannot show performance.
    </p>
  ) : undefined;

  return (
    <div>
      {badges}
      {controls}
      <Chart
        title={`${symbol} price history`}
        subtitle={subtitle}
        series={SERIES}
        height={300}
        loading={loading}
        empty={empty}
        tableView={() => (
          <div className="table-scroll max-h-80">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-800">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left text-xs text-gray-500">Date</th>
                  <th scope="col" className="px-3 py-2 text-right text-xs text-gray-500">Close ({currency})</th>
                </tr>
              </thead>
              <tbody>
                {data.map((point) => (
                  <tr key={String(point.x)} className="border-t border-gray-700">
                    <td className="px-3 py-1.5 text-gray-300">{String(point.x)}</td>
                    <td className="tnum px-3 py-1.5 text-right text-gray-200">
                      {point.close === undefined ? "—" : (Number(point.close) / 100).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      >
        <LineSeries data={data} series={SERIES} currency={currency} area />
      </Chart>

      {!empty && (
        <p className="mt-2 text-xs text-gray-500">
          {drawn} of {data.length} plotted points carry a close.{" "}
          {visibleGaps.length === 0
            ? "No weekday gaps in this range."
            : `${visibleGaps.length} weekday gap${visibleGaps.length === 1 ? "" : "s"} in this range: ` +
              visibleGaps
                .slice(0, 4)
                .map((gap) => `${gap.from} to ${gap.to}`)
                .join(", ") +
              (visibleGaps.length > 4 ? ", and more." : ".") +
              " Market holidays read as short gaps; there is no per-exchange calendar."}
        </p>
      )}
    </div>
  );
}
