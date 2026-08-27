"use client";

import { TrendingUp } from "lucide-react";
import { Chart, LineSeries, type SeriesPoint } from "@/ui/charts";
import { EmptyState } from "@/ui/primitives";

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
          <EmptyState
            icon={TrendingUp}
            title="No movements in this window"
            body="Import a statement or widen the date range."
          />
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
