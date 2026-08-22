import type { Metadata } from "next";
import { Gem } from "lucide-react";
import { PageHeader, StatRow, PendingStat, EmptyPanel } from "@/ui/placeholder";

export const metadata: Metadata = { title: "Assets" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Assets"
        subtitle="Property, vehicles, physical gold — anything valued by assertion rather than by a market quote."
        phase="Phase 4"
      />
      <StatRow>
        <PendingStat label="Total value" hint="Last asserted valuations" />
        <PendingStat label="Assets" hint="Tracked" />
        <PendingStat label="Last revalued" hint="Most recent assertion" />
        <PendingStat label="Share of net worth" hint="Of total assets" />
      </StatRow>
      <EmptyPanel
        icon={Gem}
        title="No assets yet"
        body="A physical asset is revalued by a dated assertion that posts the delta against an equity adjustment account, so the ledger stays balanced. Phase 4."
        columns={["Asset", "Class", "Valued on", "Value"]}
      />
    </>
  );
}
