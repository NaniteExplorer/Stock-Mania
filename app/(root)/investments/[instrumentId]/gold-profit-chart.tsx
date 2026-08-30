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
}: {
  points: readonly GoldProfitPoint[];
  currency?: string;
}) {
  const [range, setRange] = React.useState<(typeof RANGES)[number]["id"]>("3Y");
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
        </>
      )}
    </div>
  );
}
