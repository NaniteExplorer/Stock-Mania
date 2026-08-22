import type { Metadata } from "next";
import { LineChart } from "lucide-react";
import { PageHeader, StatRow, PendingStat, EmptyPanel } from "@/ui/placeholder";

export const metadata: Metadata = { title: "Investments" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Investments"
        subtitle="Holdings with exact cost basis, realised and unrealised gains, XIRR and true time-weighted return."
        phase="Phase 5"
      />
      <StatRow>
        <PendingStat label="Invested" hint="Cost plus buy charges" />
        <PendingStat label="Market value" hint="Open units at last price" />
        <PendingStat label="Unrealised" hint="Market value less invested" />
        <PendingStat label="XIRR" hint="Money-weighted return" />
      </StatRow>
      <EmptyPanel
        icon={LineChart}
        title="No holdings yet"
        body="Instruments, lots and corporate actions land in Phase 5. The tax, charge and pricing engines they depend on are built first, in Phase 1."
        columns={["Instrument", "Units", "Avg cost", "Market value", "Unrealised"]}
      />
    </>
  );
}
