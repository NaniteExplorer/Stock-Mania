"use client";

import { Chart, DonutSeries } from "@/ui/charts";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { TextCell } from "../../../components/ui/data-cell";

export interface AllocationSlice {
  id: string;
  label: string;
  value: number;
  formatted: string;
}

function AllocationTable({ slices }: { slices: readonly AllocationSlice[] }) {
  return (
    <Table>
      <TableCaption className="sr-only">Portfolio allocation by valued holding group</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead className="text-left">Group</TableHead>
          <TableHead className="text-right">Value</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {slices.map((slice) => (
          <TableRow key={slice.id}>
            <TextCell>{slice.label}</TextCell>
            <TableCell className="tnum text-right">{slice.formatted}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
        empty={slices.length === 0 ? <p className="text-sm text-(--fg-muted)">No priced holdings to chart yet.</p> : undefined}
        tableView={() => <AllocationTable slices={slices} />}
      >
        <DonutSeries slices={slices} currency={reportingCurrency} />
      </Chart>
    </section>
  );
}
