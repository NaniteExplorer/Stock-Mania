"use client";

import { PieChart, TrendingUp } from "lucide-react";
import { Chart, DonutSeries, LineSeries } from "./charts";
import { EmptyState } from "./primitives";

/**
 * The dashboard's two charts, in their empty state.
 *
 * They are wired now rather than at Phase 2 so the chart kit is exercised by a
 * real route: the wrapper, the legend rule, the empty state and the token palette
 * are all on a page that renders, instead of being code nobody has run.
 *
 * When the ledger can answer, the `empty` prop falls away and `data` arrives from
 * a use case; the surrounding markup does not change.
 */

export function AllocationChart() {
  return (
    <Chart
      title="Allocation"
      subtitle="How net worth splits across cash, investments, physical assets and retirement schemes."
      series={[]}
      empty={
        <EmptyState
          icon={PieChart}
          title="Nothing to allocate yet"
          body="Needs accounts before it can say anything true. Adding one is the first step on the checklist below."
        />
      }
    >
      <DonutSeries slices={[]} />
    </Chart>
  );
}

export function NetWorthTrendChart() {
  return (
    <Chart
      title="Net worth over time"
      subtitle="A monthly series projected from postings, rebuilt on demand rather than snapshotted."
      series={[{ id: "netWorth", label: "Net worth" }]}
      empty={
        <EmptyState
          icon={TrendingUp}
          title="No history yet"
          body="Once transactions exist this is derived from the journal, so a backdated entry corrects history instead of contradicting it."
        />
      }
    >
      <LineSeries data={[]} series={[{ id: "netWorth", label: "Net worth" }]} area />
    </Chart>
  );
}
