import { Page, Panel } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

/** The engine is slow: skeleton plus what it is doing (DESIGN §8.2). */
export default function ProjectionLoading() {
  return <div role="status" aria-busy="true" aria-label="Loading projection">
    <Page>
      <Skeleton />
      <Panel title="Replaying 100 stretches…"><Skeleton /><Skeleton /><Skeleton /></Panel>
    </Page>
  </div>;
}
