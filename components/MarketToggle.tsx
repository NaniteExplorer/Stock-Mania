"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

interface MarketToggleProps {
  market: "india" | "global";
}

export default function MarketToggle({ market }: MarketToggleProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    const next = market === "india" ? "global" : "india";
    const params = new URLSearchParams(searchParams.toString());
    params.set("market", next);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      className="flex items-center gap-1.5 rounded-full border border-gray-700 bg-gray-800/60 px-3 py-1 text-xs font-medium text-gray-300 transition-colors hover:border-brand-500 hover:text-brand-400 disabled:opacity-50"
      title={`Switch to ${market === "india" ? "Global" : "Indian"} market`}
    >
      <span>{market === "india" ? "🇮🇳" : "🌐"}</span>
      <span>{market === "india" ? "India" : "Global"}</span>
    </button>
  );
}
