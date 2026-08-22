import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import { PageHeader, StatRow, PendingStat, EmptyPanel } from "@/ui/placeholder";

export const metadata: Metadata = { title: "Accounts" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Every bank account, wallet and cash balance — with balances derived from the journal, never stored."
        phase="Phase 2"
      />
      <StatRow>
        <PendingStat label="Total balance" hint="Sum of asset postings" />
        <PendingStat label="Accounts" hint="Open, on-budget" />
        <PendingStat label="Money in" hint="Current month" />
        <PendingStat label="Money out" hint="Current month" />
      </StatRow>
      <EmptyPanel
        icon={Landmark}
        title="No accounts yet"
        body="Opening an account and importing a statement arrive in Phase 2, once the banking use cases sit on the new ledger."
        columns={["Account", "Type", "Currency", "Balance"]}
      />
    </>
  );
}
