import { Page, Panel } from "../../../components/ui/page-shell";
import { Skeleton } from "../../../components/ui/skeleton";

/** Skeleton masthead and one skeleton per panel (DESIGN §5, §8.3 states). */
export default function SignalsLoading() {
  return <div role="status" aria-busy="true" aria-label="Loading signals">
    <Page>
      <Skeleton />
      <Panel title="Loading alerts"><Skeleton /><Skeleton /></Panel>
      <Panel title="Loading market context"><Skeleton /><Skeleton /></Panel>
    </Page>
  </div>;
}
