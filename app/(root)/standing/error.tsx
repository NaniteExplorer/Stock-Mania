"use client";

import { Page } from "../../../components/ui/page-shell";
import { Banner } from "../../../components/ui/banner";
import { Button } from "../../../components/ui/button";

/** Names the failed read and offers Retry; nothing was changed. */
export default function StandingError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <Page>
    <Banner tone="error" title="Your standing could not be computed">
      <p>Nothing was changed. Retry to read your records again.{error.digest ? ` Reference ${error.digest}.` : ""}</p>
      <Button type="button" variant="outline" onClick={() => retry()}>Retry</Button>
    </Banner>
  </Page>;
}
