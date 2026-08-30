"use client";

import { Chart, DonutSeries } from "@/ui/charts";

export interface AllocationSlice {
  id: string;
  label: string;
  value: number;
  formatted: string;
  weight: string;
}

export interface CategoryAllocation {
  id: string;
  label: string;
  subtitle: string;
  slices: readonly AllocationSlice[];
}

function AllocationTable({ slices }: { slices: readonly AllocationSlice[] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="border-b border-gray-600 text-left text-gray-500"><th className="pb-2">Investment</th><th className="pb-2 text-right">Value</th><th className="pb-2 text-right">Share</th></tr></thead>
      <tbody>{slices.map((slice) => <tr key={slice.id} className="border-b border-gray-600/50 last:border-0"><td className="py-2 text-gray-300">{slice.label}</td><td className="py-2 text-right tnum text-gray-200">{slice.formatted}</td><td className="py-2 text-right tnum text-gray-500">{slice.weight}%</td></tr>)}</tbody>
    </table>
  );
}

export default function AllocationDashboard({ overall, categories }: { overall: readonly AllocationSlice[]; categories: readonly CategoryAllocation[] }) {
  if (overall.length === 0) return null;
  return (
    <section className="mb-6" aria-labelledby="portfolio-analytics-title">
      <div className="mb-3"><h2 id="portfolio-analytics-title" className="text-base font-semibold text-gray-100">Portfolio analytics</h2><p className="mt-1 text-sm text-gray-500">Drill from your total portfolio into every asset category and investment type.</p></div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Chart title="Portfolio allocation" subtitle="Market value by broad asset category" series={overall} height={300} tableView={() => <AllocationTable slices={overall} />}>
          <DonutSeries slices={overall} />
        </Chart>
        {categories.map((category) => (
          <Chart key={category.id} title={`${category.label} breakdown`} subtitle={category.subtitle} series={category.slices} height={300} tableView={() => <AllocationTable slices={category.slices} />}>
            <DonutSeries slices={category.slices} />
          </Chart>
        ))}
      </div>
    </section>
  );
}
