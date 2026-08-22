import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import {
  PageHeader,
  Pill,
  Stat,
  EmptyState,
  TableFrame,
} from "@/ui/primitives";
import type { ColumnSpec } from "@/ui/primitives";

export const metadata: Metadata = { title: "Accounts" };

/**
 * Accounts.
 *
 * The shape this screen keeps once data arrives: header, a KPI row, then the
 * primary surface. Figures render as an em-dash rather than zero until they are
 * derivable — a stored balance is what drifted in v1, so these are summed from postings.
 */

const COLUMNS: readonly ColumnSpec[] = [
  { id: "account", header: "Account" },
  { id: "type", header: "Type" },
  { id: "currency", header: "Currency" },
  { id: "balance", header: "Balance", numeric: true },
] as const;

export default function Page() {
  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Every bank account, wallet and cash balance — with balances derived from the journal, never stored."
        badge={<Pill tone="brand">Phase 2</Pill>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total balance" value={null} hint="Sum of asset postings" />
        <Stat label="Accounts" value={null} hint="Open, on-budget" />
        <Stat label="Money in" value={null} hint="Current month" />
        <Stat label="Money out" value={null} hint="Current month" />
      </div>

      <TableFrame
        columns={COLUMNS}
        caption="Accounts, with type, currency and derived balance"
      >
        <EmptyState
          icon={Landmark}
          title="No accounts yet"
          body="Opening an account and importing a statement arrive in Phase 2, once the banking use cases sit on the new ledger."
        />
      </TableFrame>
    </>
  );
}
