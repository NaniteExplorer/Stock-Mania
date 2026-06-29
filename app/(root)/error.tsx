"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="cockpit-panel mx-auto flex max-w-xl flex-col items-center px-6 py-14 text-center">
      <span className="icon-chip h-12 w-12 text-red-500"><AlertTriangle className="h-5 w-5" /></span>
      <h1 className="mt-5 text-xl font-semibold text-gray-100">This view could not be synchronized</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-gray-500">Your saved data is unchanged. Check the connection and retry this view.</p>
      {error.digest && <p className="mt-2 font-mono text-[10px] text-gray-600">Reference {error.digest}</p>}
      <button type="button" onClick={reset} className="yellow-btn mt-6 inline-flex items-center gap-2 px-5"><RotateCcw className="h-4 w-4" /> Retry</button>
    </div>
  );
}
