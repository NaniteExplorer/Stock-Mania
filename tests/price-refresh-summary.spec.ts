import { readFileSync } from "node:fs";
import type { RefreshPricesOutput } from "@/app/pricing.usecases";
import { summarizePortfolioRefresh } from "@/app/price-refresh-summary.usecases";
import { check, checkTrue, done, section } from "./harness";

const output = (input: {
  persisted: number;
  attempts: readonly { providerId: string; outcome: "OK" | "SKIPPED_UNHEALTHY" | "SKIPPED_UNSUPPORTED" | "FAILED"; quotes: number; error: string | null }[];
  warnings?: readonly string[];
}): RefreshPricesOutput => ({
  persisted: input.persisted,
  warnings: input.warnings ?? [],
  reports: [{
    requested: 1,
    persisted: input.persisted,
    rejected: [],
    divergences: [],
    warnings: input.warnings ?? [],
    attempts: input.attempts,
  }],
});

section("portfolio refresh summary");
{
  const actionSource = readFileSync("app/(root)/investments/actions.ts", "utf8");
  checkTrue("the server action uses the tested summary contract", actionSource.includes("summarizePortfolioRefresh(refreshOutputs, fxErrors)"));
  checkTrue("the typed unavailable code reaches the client", actionSource.includes("code: summary.code"));

  const unavailable = summarizePortfolioRefresh([
    output({ persisted: 0, attempts: [
      { providerId: "manual", outcome: "OK", quotes: 0, error: null },
      { providerId: "mfapi", outcome: "FAILED", quotes: 0, error: "upstream unavailable" },
      { providerId: "amfi", outcome: "SKIPPED_UNHEALTHY", quotes: 0, error: "circuit open" },
      { providerId: "yahoo", outcome: "SKIPPED_UNSUPPORTED", quotes: 0, error: null },
    ] }),
  ]);
  check("zero usable quotes returns a typed failure", !unavailable.ok && unavailable.code, "PRICE_REFRESH_UNAVAILABLE");
  checkTrue("failure tells the user stored/manual tracking survives", unavailable.message.includes("Stored and manual prices remain available"));
  checkTrue("failure does not claim that zero prices were saved", !unavailable.message.startsWith("Saved 0"));

  const success = summarizePortfolioRefresh([
    output({ persisted: 1, attempts: [{ providerId: "amfi", outcome: "OK", quotes: 1, error: null }] }),
    output({ persisted: 2, attempts: [{ providerId: "finnhub", outcome: "OK", quotes: 2, error: null }], warnings: ["cross-check"] }),
  ], ["FX warning"]);
  check("grouped persisted rows are aggregated", success.persisted, 3);
  check("success remains typed as success", success.ok, true);
  checkTrue("all warning sources are aggregated", success.message.includes("2 warning(s)"));
}

done();
