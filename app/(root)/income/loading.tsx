import { Page, Panel } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

/** Skeleton strip + one skeleton stream (DESIGN §9d states). */
export default function IncomeLoading() {
  return <div role="status" aria-busy="true" aria-label="Loading income">
    <Page>
      <Skeleton />
      <Skeleton />
      <Panel title="Loading streams"><Skeleton /><Skeleton /></Panel>
    </Page>
  </div>;
}
