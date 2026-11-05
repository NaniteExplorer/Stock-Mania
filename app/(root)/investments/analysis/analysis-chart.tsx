"use client";

import { Currency, Money } from "@/core/money";
import type { InvestmentAnalysisRow } from "@/app/investment-analysis.usecases";
import { Chart, LineSeries, type SeriesMeta, type SeriesPoint } from "@/ui/charts";
import { formatMoney } from "@/ui/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";

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
      empty={data.length === 0 ? <p className="text-sm text-(--fg-muted)">No stored daily bars are available for this range.</p> : undefined}
      tableView={() => (
        <Table>
          <caption className="sr-only">Daily closing prices for {row.symbol}</caption>
          <TableHeader><TableRow><TableHead className="text-left">Date</TableHead><TableHead className="text-right">Close</TableHead></TableRow></TableHeader>
          <TableBody>{row.series.map((point) => <TableRow key={point.on}><TableHead scope="row" className="text-left font-normal">{point.on}</TableHead><TableCell className="tnum text-right">{formatMoney(Money.fromRupees(point.close, Currency.of(row.currency)))}</TableCell></TableRow>)}</TableBody>
        </Table>
      )}
    >
      <LineSeries data={data} series={SERIES} currency={row.currency} area />
    </Chart>
  );
}
