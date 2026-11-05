"use client";

import { Page } from "@/components/ui/page-shell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";

/** Names the failed read and offers Retry; saved data is untouched. */
export default function IncomeError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <Page>
    <Banner tone="error" title="Your income streams could not be read">
      <p>Nothing was changed. Retry to read them again.{error.digest ? ` Reference ${error.digest}.` : ""}</p>
      <Button type="button" variant="outline" onClick={() => retry()}>Retry</Button>
    </Banner>
  </Page>;
}
