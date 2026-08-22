import type { Metadata } from "next";
import { ArrowLeftRight } from "lucide-react";
import { PageHeader, StatRow, PendingStat, EmptyPanel } from "@/ui/placeholder";

export const metadata: Metadata = { title: "Transactions" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="The register: every posting, keyboard-driven, categorised by your own keyword rules."
        phase="Phase 2"
      />
      <StatRow>
        <PendingStat label="Inflow" hint="Current month" />
        <PendingStat label="Outflow" hint="Current month" />
        <PendingStat label="Net" hint="Inflow less outflow" />
        <PendingStat label="Uncategorised" hint="Awaiting a rule" />
      </StatRow>
      <EmptyPanel
        icon={ArrowLeftRight}
        title="No transactions yet"
        body="Statement import, the three-pass duplicate matcher and keyword categorisation all arrive in Phase 2."
        columns={["Date", "Narration", "Category", "Account", "Amount"]}
      />
    </>
  );
}
