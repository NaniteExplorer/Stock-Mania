"use client";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Masthead, Page } from "@/components/ui/page-shell";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <Page>
      <Masthead title="This view could not be synchronized" />
      <Banner tone="error" title="Your saved data is unchanged.">
        <p>Check the connection and retry this view.</p>
        {error.digest && <p className="font-mono text-[10px]">Reference {error.digest}</p>}
        <Button type="button" onClick={reset} className="mt-3">Retry</Button>
      </Banner>
    </Page>
  );
}
