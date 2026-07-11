import { TrendingUp } from "lucide-react";
import { INVESTMENT_KIND_LABELS } from "@/features/investments/investment.types";
import type { PortfolioReturn } from "@/features/returns/returns.types";
import { formatINRCompact, formatSignedPercent } from "@/lib/utils";

/** Format an XIRR decimal (0.12 → "+12.0%") or an em dash when undefined. */
function xirrLabel(value: number | null): { text: string; positive: boolean } {
  if (value == null) return { text: "—", positive: true };
  return { text: formatSignedPercent(value * 100), positive: value >= 0 };
}

/**
 * Annualized (XIRR) returns — portfolio headline, per-asset-class, and the
 * holdings with the strongest/weakest money-weighted returns. Ledger-derived
 * where trades exist; approximated from cost basis for manual-only holdings.
 */
export default function ReturnsSummary({ returns }: { returns: PortfolioReturn }) {
  if (returns.byHolding.length === 0) return null;
  const portfolio = xirrLabel(returns.xirr);
  const topHoldings = returns.byHolding.filter((h) => h.xirr != null).slice(0, 6);
  const hasApprox = returns.byHolding.some((h) => h.method === "SNAPSHOT");

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-center gap-2">
        <TrendingUp className="h-5 w-5 text-brand-500" />
        <h2 className="font-semibold text-gray-100">Annualized returns (XIRR)</h2>
        <span className="pill ml-auto" title="Money-weighted annual return across all your cash flows">
          Portfolio{" "}
          <span className={portfolio.positive ? "text-green-500" : "text-red-500"}>{portfolio.text}</span>
        </span>
      </div>

      {/* Per asset class */}
      {returns.byClass.length > 0 && (
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {returns.byClass.map((c) => {
            const label = xirrLabel(c.xirr);
            return (
              <div key={c.kind} className="flex items-center justify-between rounded-xl bg-gray-700/40 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-200">{INVESTMENT_KIND_LABELS[c.kind]}</p>
                  <p className="text-xs text-gray-500 tnum">{formatINRCompact(c.currentValue)}</p>
                </div>
                <span className={`text-sm font-semibold tnum ${label.positive ? "text-green-500" : "text-red-500"}`}>
                  {label.text}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Per holding */}
      {topHoldings.length > 0 && (
        <div className="mt-4 space-y-2">
          {topHoldings.map((h) => {
            const label = xirrLabel(h.xirr);
            return (
              <div key={h.holdingKey} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm text-gray-300">
                  {h.symbol || h.name}
                  {h.method === "SNAPSHOT" && <span className="ml-1 text-[10px] text-gray-500">≈</span>}
                </span>
                <span className="w-24 shrink-0 text-right text-xs text-gray-500 tnum">{formatINRCompact(h.currentValue)}</span>
                <span className={`w-20 shrink-0 text-right text-sm font-semibold tnum ${label.positive ? "text-green-500" : "text-red-500"}`}>
                  {label.text}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {hasApprox && (
        <p className="mt-3 text-xs text-gray-500">
          ≈ approximated from cost basis and holding date (no trade history). Add trades for a precise XIRR.
        </p>
      )}
    </section>
  );
}
