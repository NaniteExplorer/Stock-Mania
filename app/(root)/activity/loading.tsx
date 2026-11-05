import { Page, Panel } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

/** Three skeleton day groups (DESIGN §9e states). */
export default function ActivityLoading() {
  return <div role="status" aria-busy="true" aria-label="Loading activity">
    <Page>
      <Skeleton />
      <Panel title="Loading"><Skeleton /><Skeleton /></Panel>
      <Panel title="Loading"><Skeleton /><Skeleton /></Panel>
      <Panel title="Loading"><Skeleton /><Skeleton /></Panel>
    </Page>
  </div>;
}
