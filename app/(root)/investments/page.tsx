import type { Metadata } from "next";
import { LineChart } from "lucide-react";
import {
  PageHeader,
  Pill,
  Stat,
  EmptyState,
  TableFrame,
} from "@/ui/primitives";
import type { ColumnSpec } from "@/ui/primitives";

export const metadata: Metadata = { title: "Investments" };

/**
 * Investments.
 *
 * The shape this screen keeps once data arrives: header, a KPI row, then the
 * primary surface. Figures render as an em-dash rather than zero until they are
 * derivable — a missing price shows as no price, never as a zero valuation.
 */

const COLUMNS: readonly ColumnSpec[] = [
  { id: "instrument", header: "Instrument" },
  { id: "units", header: "Units", numeric: true },
  { id: "avgCost", header: "Avg cost", numeric: true },
  { id: "marketValue", header: "Market value", numeric: true },
  { id: "unrealised", header: "Unrealised", numeric: true },
] as const;

export default function Page() {
  return (
    <>
      <PageHeader
        title="Investments"
        subtitle="Holdings with exact cost basis, realised and unrealised gains, XIRR and true time-weighted return."
        badge={<Pill tone="brand">Phase 5</Pill>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Invested" value={null} hint="Cost plus buy charges" />
        <Stat
          label="Market value"
          value={null}
          hint="Open units at last price"
        />
        <Stat
          label="Unrealised"
          value={null}
          hint="Market value less invested"
        />
        <Stat label="XIRR" value={null} hint="Money-weighted return" />
      </div>

      <TableFrame
        columns={COLUMNS}
        caption="Holdings: instrument, units, average cost, market value and unrealised gain"
      >
        <EmptyState
          icon={LineChart}
          title="No holdings yet"
          body="Instruments, lots and corporate actions land in Phase 5. The tax, charge and pricing engines they depend on are built first, in Phase 1."
        />
      </TableFrame>
    </>
  );
}
