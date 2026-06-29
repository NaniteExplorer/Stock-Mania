"use client";

import { useState } from "react";
import { Landmark, LineChart, PiggyBank, ShieldCheck, WalletCards } from "lucide-react";
import { findFinancialProvider } from "@/lib/financial-providers";

/**
 * Institution mark. Loads the logo from our same-origin proxy (/api/logo/<id>),
 * which resolves a curated local asset or the real bank icon and caches it. When
 * no real logo exists the proxy 404s and we render our own branded
 * gradient-initials badge.
 */
export default function ProviderMark({
  providerId,
  institution,
  className = "h-11 w-11",
}: {
  providerId?: string | null;
  institution?: string | null;
  className?: string;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const provider = findFinancialProvider(providerId) ?? findFinancialProvider(institution);

  if (!provider) {
    return (
      <span className={`icon-chip ${className}`}>
        <Landmark className="h-5 w-5" />
      </span>
    );
  }

  // Single same-origin proxy URL — it resolves a local asset or the real icon
  // server-side (cached) and 404s when none exists, so we fall to the badge.
  const sources = provider.domain || provider.logo ? [`/api/logo/${provider.id}`] : [];

  if (sourceIndex < sources.length) {
    return (
      <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ${className}`} title={provider.name}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={sources[sourceIndex]}
          alt={`${provider.name} logo`}
          className="h-full w-full object-contain p-1"
          loading="lazy"
          onError={() => setSourceIndex((index) => index + 1)}
        />
      </span>
    );
  }

  const Icon =
    provider.kind === "RETIREMENT" ? ShieldCheck :
    provider.kind === "SAVINGS" ? PiggyBank :
    provider.kind === "WALLET" ? WalletCards :
    provider.kind === "BROKER" ? LineChart :
    Landmark;

  return (
    <span
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl text-white shadow-sm ${className}`}
      style={{ background: `linear-gradient(135deg, ${provider.colors[0]}, ${provider.colors[1]})` }}
      title={provider.name}
      aria-label={`${provider.name} logo`}
    >
      <Icon className="absolute h-8 w-8 opacity-15" />
      <span className="relative text-[10px] font-black tracking-tight">{provider.shortName.slice(0, 6)}</span>
    </span>
  );
}
