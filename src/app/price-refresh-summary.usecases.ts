import type { RefreshPricesOutput } from "@/app/pricing.usecases";

export type PortfolioRefreshSummary =
  | { readonly ok: true; readonly persisted: number; readonly warnings: number; readonly message: string }
  | {
      readonly ok: false;
      readonly code: "PRICE_REFRESH_UNAVAILABLE";
      readonly persisted: 0;
      readonly warnings: number;
      readonly message: string;
    };

/** Turns grouped provider reports into the truthful state rendered by the action. */
export function summarizePortfolioRefresh(
  outputs: readonly RefreshPricesOutput[],
  additionalWarnings: readonly string[] = [],
): PortfolioRefreshSummary {
  const persisted = outputs.reduce((total, output) => total + output.persisted, 0);
  const warnings = outputs.reduce((total, output) => total + output.warnings.length, 0)
    + additionalWarnings.length;
  const attempts = outputs.flatMap((output) => output.reports.flatMap((report) => report.attempts));
  const receivedUsableQuote = attempts.some((attempt) => attempt.outcome === "OK" && attempt.quotes > 0);

  if (persisted === 0 && !receivedUsableQuote) {
    const failed = attempts.filter((attempt) =>
      attempt.outcome === "FAILED" || attempt.outcome === "SKIPPED_UNHEALTHY"
    ).length;
    return {
      ok: false,
      code: "PRICE_REFRESH_UNAVAILABLE",
      persisted: 0,
      warnings,
      message: failed > 0
        ? `No provider could supply a usable current price (${failed} provider attempt(s) failed). Stored and manual prices remain available.`
        : "No provider supplied a usable current price. Stored and manual prices remain available.",
    };
  }

  return {
    ok: true,
    persisted,
    warnings,
    message: `Saved ${persisted} price point(s)${warnings ? ` · ${warnings} warning(s)` : ""}.`,
  };
}
