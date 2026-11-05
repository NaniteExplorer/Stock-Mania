"use client";

import { Page } from "@/components/ui/page-shell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";

/** Names the failed run and offers Retry; saved data is untouched. */
export default function ProjectionError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <Page>
    <Banner tone="error" title="The projection could not be run">
      <p>Nothing was changed. Retry to run it again.{error.digest ? ` Reference ${error.digest}.` : ""}</p>
      <Button type="button" variant="outline" onClick={() => retry()}>Retry</Button>
    </Banner>
  </Page>;
}
