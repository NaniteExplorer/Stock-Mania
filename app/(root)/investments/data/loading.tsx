import { DatabaseZap } from "lucide-react";

export default function LoadingLiveData() {
  return (
    <div className="panel flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center" role="status" aria-live="polite">
      <span className="icon-chip h-12 w-12"><DatabaseZap className="size-5 animate-pulse" aria-hidden /></span>
      <p className="text-base font-semibold text-gray-100">Loading market-data readiness</p>
      <p className="max-w-md text-sm text-gray-500">Checking provider configuration, catalogue freshness and tracked instruments.</p>
    </div>
  );
}
