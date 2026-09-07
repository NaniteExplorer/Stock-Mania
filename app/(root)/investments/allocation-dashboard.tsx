"use client";

import { Chart, DonutSeries } from "@/ui/charts";

export interface AllocationSlice {
  id: string;
  label: string;
  value: number;
  formatted: string;
}

function AllocationTable({ slices }: { slices: readonly AllocationSlice[] }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Portfolio allocation by valued holding group</caption>
      <thead>
        <tr className="border-b border-gray-600">
          <th scope="col" className="metric-label px-3 py-2 text-left">Group</th>
          <th scope="col" className="metric-label px-3 py-2 text-right">Value</th>
        </tr>
      </thead>
      <tbody>
        {slices.map((slice) => (
          <tr key={slice.id} className="border-b border-gray-600/50 last:border-0">
            <td className="px-3 py-2 text-gray-300">{slice.label}</td>
            <td className="tnum px-3 py-2 text-right text-gray-200">{slice.formatted}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AllocationDashboard({
  slices,
  reportingCurrency,
}: {
  slices: readonly AllocationSlice[];
  reportingCurrency: string;
}) {
  return (
    <section className="mb-6" aria-labelledby="allocation-title">
      <Chart
        title="Portfolio allocation"
        subtitle="Only holdings with resolved reporting-currency values are included."
        series={slices}
        height={300}
        empty={slices.length === 0 ? <p className="text-sm text-gray-500">No priced holdings to chart yet.</p> : undefined}
        tableView={() => <AllocationTable slices={slices} />}
      >
        <DonutSeries slices={slices} currency={reportingCurrency} />
      </Chart>
    </section>
  );
}
