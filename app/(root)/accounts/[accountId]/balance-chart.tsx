"use client";

import { Chart, LineSeries, type SeriesPoint } from "@/ui/charts";
import { Banner } from "@/components/ui/banner";

/**
 * The account's running balance.
 *
 * Points arrive as minor units in **strings**, which is what `SeriesPoint`
 * expects: the chart library needs numbers eventually, but the conversion
 * happens once, inside the chart kit, on a value already scaled for display —
 * rather than here, where a `Number()` on a rupee amount would be one more place
 * a balance could quietly lose a paisa.
 */
export default function BalanceChart({
  points,
  currency,
}: {
  points: readonly SeriesPoint[];
  currency: string;
}) {
  return (
    <Chart
      title="Balance over time"
      subtitle="Summed from postings on the way out of the database — there is no stored balance to drift."
      series={[{ id: "balance", label: "Balance" }]}
      height={220}
      className="mb-6"
      empty={
        points.length === 0 ? (
          <Banner title="No movements in this window">
            <p>Import a statement or widen the date range.</p>
          </Banner>
        ) : undefined
      }
    >
      <LineSeries
        data={points}
        series={[{ id: "balance", label: "Balance" }]}
        currency={currency}
        area
      />
    </Chart>
  );
}
