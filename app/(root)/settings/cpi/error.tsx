"use client";

import { useEffect } from "react";
import { Page, Masthead } from "../../../../components/ui/page-shell";
import { Banner } from "../../../../components/ui/banner";
import { Button } from "../../../../components/ui/button";

/** Names the failed read and offers Retry. Writes never reach here: the action reports its own failure. */
export default function CpiError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => { console.error("CPI series read failed", error); }, [error]);
  return <Page>
    <Masthead title="CPI Urban" />
    <Banner tone="error" title="Your CPI series could not be read" role="alert">
      <p>Nothing was changed. Retry to read it again.{error.digest ? ` Reference ${error.digest}.` : ""}</p>
      <Button variant="outline" onClick={() => retry()}>Retry</Button>
    </Banner>
  </Page>;
}
