import type { Metadata } from "next";
import { ArrowLeftRight } from "lucide-react";
import {
  PageHeader,
  Pill,
  Stat,
  EmptyState,
  TableFrame,
} from "@/ui/primitives";
import type { ColumnSpec } from "@/ui/primitives";

export const metadata: Metadata = { title: "Transactions" };

/**
 * Transactions.
 *
 * The shape this screen keeps once data arrives: header, a KPI row, then the
 * primary surface. Figures render as an em-dash rather than zero until they are
 * derivable — nothing reaches the ledger from an import until it is confirmed.
 */

const COLUMNS: readonly ColumnSpec[] = [
  { id: "date", header: "Date" },
  { id: "narration", header: "Narration" },
  { id: "category", header: "Category" },
  { id: "account", header: "Account" },
  { id: "amount", header: "Amount", numeric: true },
] as const;

export default function Page() {
  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="The register: every posting, keyboard-driven, categorised by your own keyword rules."
        badge={<Pill tone="brand">Phase 2</Pill>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Inflow" value={null} hint="Current month" />
        <Stat label="Outflow" value={null} hint="Current month" />
        <Stat label="Net" value={null} hint="Inflow less outflow" />
        <Stat label="Uncategorised" value={null} hint="Awaiting a rule" />
      </div>

      <TableFrame
        columns={COLUMNS}
        caption="Transaction register: date, narration, category, account and amount"
      >
        <EmptyState
          icon={ArrowLeftRight}
          title="No transactions yet"
          body="Statement import, the three-pass duplicate matcher and keyword categorisation all arrive in Phase 2."
        />
      </TableFrame>
    </>
  );
}
