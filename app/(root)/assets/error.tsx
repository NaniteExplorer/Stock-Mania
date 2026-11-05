"use client";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Masthead, Page } from "@/components/ui/page-shell";

/** Unexpected failures; names the read that failed and offers Retry. */
export default function AssetsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <Page>
    <Masthead title="Assets" />
    <Banner tone="error" title="The assets screen could not be read"><p>Nothing was changed.</p><Button type="button" variant="outline" onClick={() => retry()}>Retry</Button></Banner>
  </Page>;
}
