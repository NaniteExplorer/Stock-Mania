import { Landmark, PiggyBank, ShieldCheck, WalletCards } from "lucide-react";
import { findFinancialProvider } from "@/lib/financial-providers";

export default function ProviderMark({ providerId, institution, className = "h-11 w-11" }: { providerId?: string | null; institution?: string | null; className?: string }) {
  const provider = findFinancialProvider(providerId) ?? findFinancialProvider(institution);
  if (!provider) return <span className={`icon-chip ${className}`}><Landmark className="h-5 w-5" /></span>;
  const Icon = provider.kind === "RETIREMENT" ? ShieldCheck : provider.kind === "SAVINGS" ? PiggyBank : provider.kind === "WALLET" ? WalletCards : Landmark;
  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl text-white shadow-sm ${className}`} style={{ background: `linear-gradient(135deg, ${provider.colors[0]}, ${provider.colors[1]})` }} title={provider.name} aria-label={`${provider.name} logo`}>
      <Icon className="absolute h-8 w-8 opacity-15" />
      <span className="relative text-[10px] font-black tracking-tight">{provider.shortName.slice(0, 6)}</span>
    </span>
  );
}
