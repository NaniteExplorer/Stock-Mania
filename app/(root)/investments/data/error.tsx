"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

export default function LiveDataError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Live Data Center failed to load", error);
  }, [error]);

  return (
    <section className="panel flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center" role="alert">
      <span className="icon-chip h-12 w-12"><AlertTriangle className="size-5 text-red-500" aria-hidden /></span>
      <h1 className="text-lg font-semibold text-gray-100">Live data status is unavailable</h1>
      <p className="max-w-md text-sm text-gray-500">Stored holdings remain available. Retry the readiness check when the data service is reachable.</p>
      <button type="button" className="ghost-btn mt-2 h-10 px-4 text-xs" onClick={reset}>
        <RotateCcw className="size-4" aria-hidden />
        Try again
      </button>
    </section>
  );
}
