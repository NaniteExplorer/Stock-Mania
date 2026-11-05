import type { Metadata } from "next";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import { currentUserId, services } from "@/infra/container";
import { NO_OPTIONAL_INPUTS, ViewSignals } from "@/app/signals.usecases";
import { buildSignalsView } from "./signals-model";
import { SignalsScreen } from "./signals-view";

export const metadata: Metadata = { title: "Signals" };

/**
 * The Tier 2 board (DESIGN §8.3). In-app only. Composes the Tier 1 alert rules, the tax
 * position and the band standing from existing reads; every input with no store or reader
 * yet is passed as absent and shown as not evaluated or unknown, never filled in.
 */
export default async function Page() {
  await connection();
  const userId = await currentUserId();
  const { clock, investing, reports, repositories, targetAllocation, rebalancingBand } = services();
  const today = CalendarDate.parse(clock.today());

  const signals = new ViewSignals({
    valuePortfolio: investing.valuePortfolio,
    taxReport: reports.tax,
    taxSettings: repositories.taxSettings,
  });
  // Unwired today: per-lot gains, concentration threshold, runway, fetch log.
  // The stored target allocation and band are read (/settings/allocation); either missing is reported, not defaulted.
  const [stored, band] = await Promise.all([targetAllocation.load.execute({ userId }), rebalancingBand.load.execute({ userId })]);
  const optional = { ...NO_OPTIONAL_INPUTS, storedTarget: stored.ok ? stored.value : null, band: band.ok ? band.value : null };
  const snapshot = await signals.execute({ userId, asOf: today, optional });
  // No index history is stored, so the drawdown panel is unknown (or empty with no holdings).
  return <SignalsScreen view={buildSignalsView(snapshot, { drawdown: null })} />;
}
