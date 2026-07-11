"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { refreshInvestmentPrices } from "@/features/prices/price.actions";

export default function RefreshPricesButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const r = await refreshInvestmentPrices();
      if (r.success) {
        toast.success("Prices updated", {
          description:
            `${r.updated} updated` +
            (r.failed ? `, ${r.failed} unavailable` : "") +
            (r.skipped ? `, ${r.skipped} missing a symbol` : "") +
            ".",
        });
        router.refresh();
      } else {
        toast.error("Couldn't refresh prices", { description: r.error });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={run}
      disabled={loading}
      className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-600 bg-gray-800 px-4 text-sm font-semibold text-gray-300 transition-colors hover:border-brand-500/50 hover:text-brand-500 disabled:opacity-50"
    >
      <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      {loading ? "Refreshing…" : "Refresh prices"}
    </button>
  );
}
