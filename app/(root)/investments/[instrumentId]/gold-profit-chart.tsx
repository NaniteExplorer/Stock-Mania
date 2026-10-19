"use client";

/**
 * Profit over the years, split by where it came from.
 *
 * Two plots rather than one, because the two quantities do not share a scale: a
 * gram price sits in the thousands and a profit in the lakhs, and drawing them on
 * one axis makes whichever is smaller a flat line along the bottom. Stacking them
 * vertically keeps the same x axis, so the eye still reads "the price fell here,
 * and that is the dip in profit there" — which is the whole point of the pair.
 *
 * The range buttons filter points already on the client. The server sends the
 * whole window once; re-fetching for a shorter view would be a round trip to
 * throw data away.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Chart, LineSeries, type SeriesPoint } from "@/ui/charts";

export interface GoldProfitPoint {
  month: string;
  /** Minor units. `null` where no price was published for that month. */
  totalProfitMinor: number | null;
  priceProfitMinor: number | null;
  leaseProfitMinor: number | null;
  investedMinor: number;
  marketValueMinor: number | null;
  /** Minor units per gram, so the rate plot formats through `Money` too. */
  rateMinor: number | null;
  grams: string;
  leaseGrams: string;
}

const RANGES = [
  { id: "1Y", months: 12 },
  { id: "3Y", months: 36 },
  { id: "5Y", months: 60 },
  { id: "All", months: Number.MAX_SAFE_INTEGER },
] as const;

const PROFIT_SERIES = [
  { id: "total", label: "Total profit" },
  { id: "price", label: "From gold price" },
  { id: "lease", label: "From lease interest" },
] as const;

export default function GoldProfitChart({
  points,
  currency = "INR",
  instrumentId,
}: {
  points: readonly GoldProfitPoint[];
  currency?: string;
  /** Omitted, the chart still draws — it just cannot fetch its own history. */
  instrumentId?: string;
}) {
  const router = useRouter();
  const [range, setRange] = React.useState<(typeof RANGES)[number]["id"]>("3Y");
  const [historyState, setHistoryState] = React.useState<
    { status: "idle" | "loading" | "error" | "success"; message: string }
  >({ status: "idle", message: "" });
  const months = RANGES.find((one) => one.id === range)?.months ?? 36;
  const shown = React.useMemo(
    () => (points.length > months ? points.slice(points.length - months) : points),
    [points, months],
  );

  /*
   * Recharts cannot plot `null` as "unknown" without a gap, which is what we
   * want: a month with no published price should break the line rather than draw
   * a straight segment across it implying a value nobody recorded.
   */
  const profitData: SeriesPoint[] = shown.map((point) => ({
    x: point.month,
    ...(point.totalProfitMinor !== null ? { total: point.totalProfitMinor } : {}),
    ...(point.priceProfitMinor !== null ? { price: point.priceProfitMinor } : {}),
    ...(point.leaseProfitMinor !== null ? { lease: point.leaseProfitMinor } : {}),
  }));

  const rateData: SeriesPoint[] = shown.map((point) => ({
    x: point.month,
    ...(point.rateMinor !== null ? { rate: point.rateMinor } : {}),
  }));

  const controls = (
    <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Chart range">
      {RANGES.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => setRange(option.id)}
          aria-pressed={range === option.id}
          className={
            range === option.id
              ? "focus-brand rounded-lg border border-gray-500 bg-gray-700 px-2.5 py-1 text-xs font-medium text-gray-100"
              : "focus-brand rounded-lg border border-gray-600 px-2.5 py-1 text-xs font-medium text-gray-400 transition-colors hover:text-gray-100"
          }
        >
          {option.id}
        </button>
      ))}
    </div>
  );

  /*
   * The months are drawn from stored gram quotes, and until this runs there are
   * only the few days the live IBJA feed has fetched — which is why this chart
   * rendered with correct axes and no line at all. IBJA publishes no free
   * history, so the backfill behind this call derives it from a domestic ETF for
   * the same metal, calibrated to the last published IBJA rate. That is an estimate, and the note
   * under the chart says so rather than letting it pass as a published rate.
   */
  const rated = rateData.filter((point) => point.rate !== undefined).length;

  async function loadHistory(id: string) {
    setHistoryState({ status: "loading", message: "Loading gram-rate history..." });
    try {
      const response = await fetch(`/api/instruments/${id}/backfill`, { method: "POST" });
      const body = (await response.json()) as {
        ok?: boolean;
        appended?: number;
        skipped?: string | null;
        error?: string;
      };
      if (!response.ok || !body.ok) {
        setHistoryState({
          status: "error",
          message: body.error ?? "Gram-rate history could not be loaded.",
        });
        return;
      }
      const appended = body.appended ?? 0;
      setHistoryState({
        status: "success",
        message:
          appended > 0
            ? `Loaded ${appended} estimated daily gram rates.`
            : (body.skipped ?? "History is already current."),
      });
      if (appended > 0) router.refresh();
    } catch {
      setHistoryState({
        status: "error",
        message: "Gram-rate history could not be loaded. Try again later.",
      });
    }
  }

  // One attempt per mount. A failed fetch leaves the message, not a retry loop.
  const shouldPreload = Boolean(instrumentId) && points.length > 0 && rated < 2;
  const preloadStarted = React.useRef(false);
  React.useEffect(() => {
    if (!shouldPreload || preloadStarted.current || !instrumentId) return;
    preloadStarted.current = true;
    void loadHistory(instrumentId);
  }, [shouldPreload, instrumentId]);

  const empty =
    points.length === 0 ? (
      <p className="py-10 text-center text-sm text-gray-500">
        Nothing to plot yet. Record a purchase and refresh prices, and the months fill in from
        there.
      </p>
    ) : undefined;

  return (
    <div className="mb-6 space-y-4">
      {!empty && controls}
      <Chart
        title="Profit across the years"
        subtitle="Month end, split by source: what the gold price made, and what the lease paid in grams. The two add to the total exactly."
        series={PROFIT_SERIES}
        height={300}
        empty={empty}
        tableView={() => (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">Month-end profit split by source</caption>
              <thead>
                <tr className="border-b border-gray-600">
                  <th className="metric-label px-3 py-2 text-left">Month</th>
                  <th className="metric-label px-3 py-2 text-right">Grams</th>
                  <th className="metric-label px-3 py-2 text-right">From lease</th>
                  <th className="metric-label px-3 py-2 text-right">Invested</th>
                  <th className="metric-label px-3 py-2 text-right">Value</th>
                  <th className="metric-label px-3 py-2 text-right">Profit</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((point) => (
                  <tr key={point.month} className="border-b border-gray-600/50 last:border-0">
                    <td className="px-3 py-2 text-gray-400">{point.month}</td>
                    <td className="tnum px-3 py-2 text-right text-gray-300">{point.grams}g</td>
                    <td className="tnum px-3 py-2 text-right text-green-500">
                      {point.leaseGrams}g
                    </td>
                    <td className="tnum px-3 py-2 text-right text-gray-400">
                      {point.investedMinor}
                    </td>
                    <td className="tnum px-3 py-2 text-right text-gray-400">
                      {point.marketValueMinor ?? "—"}
                    </td>
                    <td className="tnum px-3 py-2 text-right text-gray-200">
                      {point.totalProfitMinor ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      >
        <LineSeries data={profitData} series={[...PROFIT_SERIES]} currency={currency} />
      </Chart>

      {!empty && (
        <>
          <Chart
            title="Gold rate per gram"
            subtitle="The price that drives the line above. A gap is a month with no published rate, not a month at zero."
            series={[{ id: "rate", label: "Rate / gram" }]}
            height={200}
            tableView={() => (
              <table className="w-full text-sm">
                <caption className="sr-only">Month-end gram rate</caption>
                <thead>
                  <tr className="border-b border-gray-600">
                    <th className="metric-label px-3 py-2 text-left">Month</th>
                    <th className="metric-label px-3 py-2 text-right">Rate (minor units)</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((point) => (
                    <tr key={point.month} className="border-b border-gray-600/50 last:border-0">
                      <td className="px-3 py-2 text-gray-400">{point.month}</td>
                      <td className="tnum px-3 py-2 text-right text-gray-300">
                        {point.rateMinor ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          >
            <LineSeries
              data={rateData}
              series={[{ id: "rate", label: "Rate / gram" }]}
              currency={currency}
              area
            />
          </Chart>

          {/*
            * Said once, under the plot it qualifies. Anything older than IBJA's
            * own few published days is an ETF proxy scaled to the last real rate,
            * and a chart that looked identical to published data would be the one
            * dishonest thing in this view.
            */}
          {rated > 0 && (
            <p className="px-1 text-xs text-gray-500">
              History before the latest published rates is <strong className="font-medium text-gray-400">estimated</strong>:
              IBJA publishes no free rate history, so earlier months are derived from a domestic
              exchange-traded fund for the same metal, calibrated to the most recent published IBJA
              rate. Today&rsquo;s valuation always uses the published rate itself.
            </p>
          )}

          {historyState.status !== "idle" && (
            <p
              role="status"
              className={
                historyState.status === "error"
                  ? "px-1 text-xs text-rose-400"
                  : "px-1 text-xs text-gray-500"
              }
            >
              {historyState.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
