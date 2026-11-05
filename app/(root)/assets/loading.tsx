import { Page } from "@/components/ui/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return <Page><div role="status" aria-busy="true" aria-label="Loading assets">
    <Skeleton /><Skeleton /><Skeleton />
  </div></Page>;
}
