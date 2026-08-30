"use client";

import { Chart, LineSeries, type SeriesPoint } from "@/ui/charts";

export interface NetWorthChartPoint {
  month: string;
  netWorthMinor: number;
}

export default function NetWorthChart({ points }: { points: readonly NetWorthChartPoint[] }) {
  const data: SeriesPoint[] = points.map((point) => ({
    x: point.month,
    netWorth: point.netWorthMinor,
  }));

  return (
    <Chart
      title="Net worth over time"
      subtitle="Month-end value reconstructed from posted journal entries"
      series={[{ id: "netWorth", label: "Net worth" }]}
      className="mb-6"
      tableView={() => (
        <table className="w-full text-sm">
          <thead><tr><th className="px-3 py-2 text-left">Month</th><th className="px-3 py-2 text-right">Net worth (paise)</th></tr></thead>
          <tbody>{points.map((point) => <tr key={point.month}><td className="px-3 py-2">{point.month}</td><td className="tnum px-3 py-2 text-right">{point.netWorthMinor}</td></tr>)}</tbody>
        </table>
      )}
    >
      <LineSeries data={data} series={[{ id: "netWorth", label: "Net worth" }]} area />
    </Chart>
  );
}
