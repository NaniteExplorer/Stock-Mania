"use client";

import { RotateCcw } from "lucide-react";
import { Banner } from "../../../../components/ui/banner";
import { useEffect } from "react";

export default function LiveDataError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Live Data Center failed to load", error);
  }, [error]);

  return (
    <Banner tone="error" role="alert" title={<h1>Live data status is unavailable</h1>}>
      <p>Stored holdings remain available. Retry the readiness check when the data service is reachable.</p>
      <button type="button" className="ghost-btn mt-2 h-10 px-4 text-xs" onClick={reset}>
        <RotateCcw className="size-4" aria-hidden />
        Try again
      </button>
    </Banner>
  );
}
