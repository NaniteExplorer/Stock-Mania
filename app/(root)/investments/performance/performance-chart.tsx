"use client";

import { Currency, Money } from "@/core/money";
import type { InvestmentWorkspaceOutput } from "@/app/investing.usecases";
import { BarSeries, Chart, type SeriesMeta, type SeriesPoint } from "@/ui/charts";
import { formatMoney } from "@/ui/format";

const SERIES: readonly SeriesMeta[] = [
  { id: "investedAmount", label: "Invested" },
  { id: "marketValue", label: "Market value" },
  { id: "realisedPnl", label: "Realised P&L" },
  { id: "unrealisedPnl", label: "Unrealised P&L" },
];

export default function PerformanceChart({
  metrics,
  reportingCurrency,
  asOf,
}: {
  metrics: InvestmentWorkspaceOutput["metrics"];
  reportingCurrency: string;
  asOf: string;
}) {
  const series = SERIES.filter((item) => metrics[item.id as keyof typeof metrics].status === "AVAILABLE");
  const point = series.reduce<SeriesPoint>(
    (row, item) => ({
      ...row,
      [item.id]: metricMinor(metrics[item.id as keyof typeof metrics], reportingCurrency),
    }),
    { x: asOf },
  );

  return (
    <div className="mb-6">
      <Chart
        title="Performance components"
        subtitle="Available money metrics only; unavailable income and total gain are left out rather than charted as zero."
        series={series}
        height={280}
        empty={series.length === 0 ? <p className="text-sm text-gray-500">No available money metrics to chart.</p> : undefined}
        tableView={() => <MetricTable metrics={metrics} reportingCurrency={reportingCurrency} series={series} />}
      >
        <BarSeries data={[point]} series={series} currency={reportingCurrency} />
      </Chart>
    </div>
  );
}

function MetricTable({
  metrics,
  reportingCurrency,
  series,
}: {
  metrics: InvestmentWorkspaceOutput["metrics"];
  reportingCurrency: string;
  series: readonly SeriesMeta[];
}) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Available performance metrics in reporting currency</caption>
      <tbody>
        {series.map((item) => {
          const metric = metrics[item.id as keyof typeof metrics];
          return (
            <tr key={item.id} className="border-b border-gray-600/50 last:border-0">
              <th scope="row" className="px-3 py-2 text-left font-medium text-gray-300">{item.label}</th>
              <td className="tnum px-3 py-2 text-right text-gray-200">
                {metric.status === "AVAILABLE"
                  ? formatMoney(Money.fromRupees(metric.value, Currency.of(metric.currency ?? reportingCurrency)))
                  : "Unavailable"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function metricMinor(
  metric: InvestmentWorkspaceOutput["metrics"][keyof InvestmentWorkspaceOutput["metrics"]],
  fallbackCurrency: string,
): number {
  if (metric.status !== "AVAILABLE") return 0;
  return Money.fromRupees(metric.value, Currency.of(metric.currency ?? fallbackCurrency)).toMinorNumber();
}
