import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import {
  PageHeader,
  Pill,
  Stat,
  EmptyState,
  TableFrame,
} from "@/ui/primitives";
import type { ColumnSpec } from "@/ui/primitives";

export const metadata: Metadata = { title: "History" };

/**
 * History.
 *
 * The shape this screen keeps once data arrives: header, a KPI row, then the
 * primary surface. Figures render as an em-dash rather than zero until they are
 * derivable — this is a projection, so backdating an entry corrects history rather than contradicting it.
 */

const COLUMNS: readonly ColumnSpec[] = [
  { id: "month", header: "Month" },
  { id: "assets", header: "Assets", numeric: true },
  { id: "liabilities", header: "Liabilities", numeric: true },
  { id: "netWorth", header: "Net worth", numeric: true },
  { id: "change", header: "Change", numeric: true },
] as const;

export default function Page() {
  return (
    <>
      <PageHeader
        title="History"
        subtitle="Net worth month by month, rebuilt from postings rather than read back from a snapshot."
        badge={<Pill tone="brand">Phase 2</Pill>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Net worth" value={null} hint="Assets less liabilities" />
        <Stat label="12-month change" value={null} hint="Versus a year ago" />
        <Stat label="Savings rate" value={null} hint="Income less expenses" />
        <Stat label="Months tracked" value={null} hint="With postings" />
      </div>

      <TableFrame
        columns={COLUMNS}
        caption="Net worth by month: assets, liabilities, net worth and change"
      >
        <EmptyState
          icon={CalendarClock}
          title="No history yet"
          body="Once accounts and transactions exist this page is a projection over the journal — there is no stored balance that can drift out of step with it."
        />
      </TableFrame>
    </>
  );
}
