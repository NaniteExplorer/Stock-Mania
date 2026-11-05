import type { Metadata } from "next";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import { currentUserId, services } from "@/infra/container";
import { StandingMeasurements, standingSourcesFrom } from "@/app/standing.usecases";
import { scoreCard } from "@/domain/scoring/score-card";
import { buildStandingView } from "./standing-model";
import { StandingEmpty, StandingScreen } from "./standing-view";
import { placementRows } from "./placement-section";
import { REFERENCE_DISTRIBUTIONS } from "@/domain/scoring/percentile-references";

export const metadata: Metadata = { title: "Standing" };

const GROUP_CODES = new Set(["Assets:Bank", "Assets:Cash", "Assets:Wallets"]);

/**
 * The scoring dashboard (DESIGN §9f). Every indicator is measured from the owner's
 * own records by `StandingMeasurements`; one the records cannot support is unknown
 * with its reason, and the composite refuses naming those pillars. Nothing is
 * fabricated to fill a gap. Tier history is not persisted, so `previous` is null.
 */
export default async function Page() {
  await connection();
  const userId = await currentUserId();
  const { banking, clock, repositories } = services();
  const today = CalendarDate.parse(clock.today());

  const positions = await banking.listCashPositions.execute({ userId, asOf: today, includeClosed: false });
  if (!positions.ok) throw new Error(positions.error.message);
  if (!positions.value.positions.some((p) => !GROUP_CODES.has(p.asset.account.code.toString()))) return <StandingEmpty />;

  // Built here rather than in the container, which another task owns; the sources are the container's repositories.
  const result = await new StandingMeasurements(standingSourcesFrom(repositories)).execute({ userId, today });
  if (!result.ok) throw new Error(result.error.message);
  const { measurements, facts, previous, oldestInput, limitations } = result.value;

  const card = scoreCard(measurements, facts, previous);
  // Placement (3.8): no owner income/net-worth figure is wired to it yet, and no reference table is transcribed; every scale refuses with its reason.
  const placement = placementRows(REFERENCE_DISTRIBUTIONS, null, null, "Your income and net worth are not yet wired to placement.");
  return <StandingScreen view={buildStandingView({ card, measurements, previous, oldestInput, today, limitations })} placement={placement} />;
}
