import { Page, Panel } from "../../../components/ui/page-shell";
import { Skeleton } from "../../../components/ui/skeleton";

/** Skeleton hero + table (DESIGN §9f states). */
export default function StandingLoading() {
  return <div role="status" aria-busy="true" aria-label="Loading standing">
    <Page>
      <Skeleton />
      <Panel title="Loading indicators"><Skeleton /><Skeleton /><Skeleton /></Panel>
    </Page>
  </div>;
}
