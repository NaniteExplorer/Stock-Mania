import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import {
  PageHeader,
  Pill,
  Stat,
  EmptyState,
  TableFrame,
} from "@/ui/primitives";
import type { ColumnSpec } from "@/ui/primitives";

export const metadata: Metadata = { title: "Liabilities" };

/**
 * Liabilities.
 *
 * The shape this screen keeps once data arrives: header, a KPI row, then the
 * primary surface. Figures render as an em-dash rather than zero until they are
 * derivable — a card payment is a transfer between your own accounts, never an expense.
 */

const COLUMNS: readonly ColumnSpec[] = [
  { id: "liability", header: "Liability" },
  { id: "type", header: "Type" },
  { id: "rate", header: "Rate", numeric: true },
  { id: "outstanding", header: "Outstanding", numeric: true },
] as const;

export default function Page() {
  return (
    <>
      <PageHeader
        title="Liabilities"
        subtitle="Credit cards and loans, with real amortisation schedules and payoff comparison."
        badge={<Pill tone="brand">Phase 3–4</Pill>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Outstanding"
          value={null}
          hint="Sum of liability postings"
        />
        <Stat label="Cards" value={null} hint="Open" />
        <Stat label="Loans" value={null} hint="Open" />
        <Stat label="Monthly outgo" value={null} hint="Scheduled instalments" />
      </div>

      <TableFrame
        columns={COLUMNS}
        caption="Liabilities: name, type, interest rate and outstanding balance"
      >
        <EmptyState
          icon={CreditCard}
          title="No liabilities yet"
          body="Credit cards arrive in Phase 3; loan mathematics — EMI schedules, prepayment, avalanche versus snowball — in Phase 4."
        />
      </TableFrame>
    </>
  );
}
