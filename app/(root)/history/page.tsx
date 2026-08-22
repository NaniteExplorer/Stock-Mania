import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { PageHeader, StatRow, PendingStat, EmptyPanel } from "@/ui/placeholder";

export const metadata: Metadata = { title: "History" };

export default function Page() {
  return (
    <>
      <PageHeader
        title="History"
        subtitle="Net worth month by month, rebuilt from postings rather than read back from a snapshot."
        phase="Phase 2"
      />
      <StatRow>
        <PendingStat label="Net worth" hint="Assets less liabilities" />
        <PendingStat label="12-month change" hint="Versus a year ago" />
        <PendingStat label="Savings rate" hint="Income less expenses" />
        <PendingStat label="Months tracked" hint="With postings" />
      </StatRow>
      <EmptyPanel
        icon={CalendarClock}
        title="No history yet"
        body="Once accounts and transactions exist this page is a projection over the journal — there is no stored balance that can drift out of step with it."
        columns={["Month", "Assets", "Liabilities", "Net worth", "Change"]}
      />
    </>
  );
}
