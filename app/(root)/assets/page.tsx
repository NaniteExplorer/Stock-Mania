import type { Metadata } from "next";
import { Gem } from "lucide-react";
import {
  PageHeader,
  Pill,
  Stat,
  EmptyState,
  TableFrame,
} from "@/ui/primitives";
import type { ColumnSpec } from "@/ui/primitives";

export const metadata: Metadata = { title: "Assets" };

/**
 * Assets.
 *
 * The shape this screen keeps once data arrives: header, a KPI row, then the
 * primary surface. Figures render as an em-dash rather than zero until they are
 * derivable — a revaluation posts the delta against an equity account, so the ledger stays balanced.
 */

const COLUMNS: readonly ColumnSpec[] = [
  { id: "asset", header: "Asset" },
  { id: "class", header: "Class" },
  { id: "valuedOn", header: "Valued on" },
  { id: "value", header: "Value", numeric: true },
] as const;

export default function Page() {
  return (
    <>
      <PageHeader
        title="Assets"
        subtitle="Property, vehicles, physical gold — anything valued by assertion rather than by a market quote."
        badge={<Pill tone="brand">Phase 4</Pill>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Total value"
          value={null}
          hint="Last asserted valuations"
        />
        <Stat label="Assets" value={null} hint="Tracked" />
        <Stat label="Last revalued" value={null} hint="Most recent assertion" />
        <Stat label="Share of assets" value={null} hint="Of total assets" />
      </div>

      <TableFrame
        columns={COLUMNS}
        caption="Assets: name, class, valuation date and asserted value"
      >
        <EmptyState
          icon={Gem}
          title="No assets yet"
          body="A physical asset is revalued by a dated assertion that posts the delta against an equity adjustment account, so the ledger stays balanced. Phase 4."
        />
      </TableFrame>
    </>
  );
}
