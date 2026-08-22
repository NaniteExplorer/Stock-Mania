import type { Metadata } from "next";
import { CreditCard } from "lucide-react";
import { PageHeader, StatRow, PendingStat, EmptyPanel } from "@/ui/placeholder";

export const metadata: Metadata = { title: "Liabilities" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="Liabilities"
        subtitle="Credit cards and loans, with real amortisation schedules and payoff comparison."
        phase="Phase 3–4"
      />
      <StatRow>
        <PendingStat label="Outstanding" hint="Sum of liability postings" />
        <PendingStat label="Cards" hint="Open" />
        <PendingStat label="Loans" hint="Open" />
        <PendingStat label="Monthly outgo" hint="Scheduled instalments" />
      </StatRow>
      <EmptyPanel
        icon={CreditCard}
        title="No liabilities yet"
        body="Credit cards arrive in Phase 3; loan mathematics — EMI schedules, prepayment, avalanche versus snowball — in Phase 4."
        columns={["Liability", "Type", "Rate", "Outstanding"]}
      />
    </>
  );
}
