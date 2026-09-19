"use client";

import { Currency, Money } from "@/core/money";
import type { InvestmentAnalysisRow } from "@/app/investment-analysis.usecases";
import { Chart, LineSeries, type SeriesMeta, type SeriesPoint } from "@/ui/charts";
import { formatMoney } from "@/ui/format";

const SERIES: readonly SeriesMeta[] = [{ id: "close", label: "Daily close" }];

export default function AnalysisChart({ row }: { row: InvestmentAnalysisRow }) {
  const data: SeriesPoint[] = row.series.map((point) => ({
    x: point.on,
    close: Money.fromRupees(point.close, Currency.of(row.currency)).toMinorNumber(),
  }));

  return (
    <Chart
      title={`${row.symbol} price trend`}
      subtitle={`${row.barsUsed} stored daily bars through ${row.asOf ?? "no observation"}. This is descriptive history, not a forecast or recommendation.`}
      series={SERIES}
      height={320}
      empty={data.length === 0 ? <p className="text-sm text-gray-500">No stored daily bars are available for this range.</p> : undefined}
      tableView={() => (
        <div className="table-scroll">
          <table className="w-full text-sm">
            <caption className="sr-only">Daily closing prices for {row.symbol}</caption>
            <thead><tr className="border-b border-gray-600"><th className="metric-label px-3 py-2 text-left" scope="col">Date</th><th className="metric-label px-3 py-2 text-right" scope="col">Close</th></tr></thead>
            <tbody>{row.series.map((point) => <tr key={point.on} className="border-b border-gray-600/50 last:border-0"><th scope="row" className="px-3 py-2 text-left font-normal text-gray-300">{point.on}</th><td className="tnum px-3 py-2 text-right text-gray-100">{formatMoney(Money.fromRupees(point.close, Currency.of(row.currency)))}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    >
      <LineSeries data={data} series={SERIES} currency={row.currency} area />
    </Chart>
  );
}
