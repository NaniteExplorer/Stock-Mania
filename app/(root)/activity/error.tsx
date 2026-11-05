"use client";

import { Page } from "@/components/ui/page-shell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";

/** Names the failed read and offers Retry; no verb is offered while activity is unread. */
export default function ActivityError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <Page>
    <Banner tone="error" title="Activity could not be loaded">
      <p>Nothing was changed, and Undo and Redo are unavailable until it loads.{error.digest ? ` Reference ${error.digest}.` : ""}</p>
      <Button type="button" variant="outline" onClick={() => retry()}>Retry</Button>
    </Banner>
  </Page>;
}
