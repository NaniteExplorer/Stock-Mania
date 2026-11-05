/** Tasks 3.1, 3.3–3.5, 3.10: three states, cited thresholds, placeholder tiers, score card, badge criteria table. */
import { Ratio } from "@/core/units";
import { BADGE_CRITERIA, badgesHeld } from "@/domain/scoring/badges";
import { composite, pillarDisplay, UNKNOWN_MARK, type Measurement } from "@/domain/scoring/composite";
import { INDICATORS } from "@/domain/scoring/indicators";
import { pendingOwnerDecisions } from "@/domain/scoring/provenance";
import { scoreCard } from "@/domain/scoring/score-card";
import { SENSITIVITY_AXES } from "@/domain/scoring/sensitivity";
import { DEMOTION_MARGIN_SOURCE, FOIR_CEILING, HEALTH_CEILING, TIER_FLOOR_SOURCE, TIER_LABEL, tierFor } from "@/domain/scoring/tiers";
import { assertProperty, check, checkDeep, checkTrue, done, genInt, section } from "./harness";

const measured = (value: number): Measurement => ({ state: "measured", value: Ratio(value) });
const healthy = () =>
  new Map<string, Measurement>([
    ["runway-months", measured(6)],
    ["savings-rate", measured(1)],
    ["debt-service-ratio", measured(0.1)],
    ["foir-ceiling", measured(0.3)],
    ["income-stability", measured(1)],
    ["health-cover-present", measured(1)],
    ["term-cover-present", measured(1)],
    ["independence-multiple", measured(33)],
  ]);
const fine = { healthCover: "covered", foir: Ratio(0.3) } as const;

section("3.1 three states: measured / unknown / not-applicable");
const unknownRunway = healthy();
unknownRunway.delete("runway-months");
const refused = composite(unknownRunway);
check("a missing indicator refuses the composite", refused.state, "refused");
checkDeep("and names the missing pillar", refused.state === "refused" ? refused.missingPillars : [], ["RUNWAY"]);
check("the refusal reason names it too", refused.state === "refused" && refused.reason.includes("RUNWAY"), true);
check("the unknown pillar shows an em-dash", pillarDisplay(refused.pillars.find((p) => p.pillar === "RUNWAY")!), UNKNOWN_MARK);
check("the em-dash is the em-dash", UNKNOWN_MARK, "—");
const noDependents = healthy();
noDependents.set("term-cover-present", { state: "not-applicable", reason: "nobody depends on this income" });
noDependents.set("health-cover-present", measured(1));
const na = composite(noDependents);
check("not-applicable is not zero: Protect still scores 1 on health cover alone", na.state === "scored" ? na.score : -1, 1);
const noDebt = healthy();
noDebt.set("debt-service-ratio", { state: "not-applicable", reason: "no debt" });
noDebt.set("foir-ceiling", { state: "not-applicable", reason: "no debt" });
const naPillar = composite(noDebt);
check("an all-not-applicable pillar leaves the composite rather than refusing it", naPillar.state, "scored");
check("and shows n/a, not a dash", pillarDisplay(naPillar.pillars.find((p) => p.pillar === "DEBT")!), "n/a");
const absent = healthy();
absent.set("term-cover-present", { state: "declared-absent" });
check("declared absence is a measurement that scores low, unlike not-applicable", composite(absent).state === "scored" && (composite(absent) as { score: number }).score < 1, true);

section("3.2 property: a zero pillar is never compensated (seeded)");
assertProperty(
  "zero Protect, any strength elsewhere, composite stays 0",
  genInt(1, 1000),
  (n) => {
    const m = healthy();
    m.set("runway-months", measured(n));
    m.set("independence-multiple", measured(n));
    m.set("health-cover-present", { state: "declared-absent" });
    m.set("term-cover-present", { state: "declared-absent" });
    const c = composite(m);
    return c.state === "scored" && c.score === 0;
  },
);

section("3.3 every threshold carries a citation or is owner-set");
check("tier floors are cited", Object.values(TIER_FLOOR_SOURCE).every((t) => t.provenance.kind === "CITED"), true);
check("the FOIR ceiling is the registry's cited 50%", `${FOIR_CEILING.value}:${FOIR_CEILING.provenance.kind}`, "0.5:CITED");
check("the health ceiling is a product rule, owner-set and confirmed", HEALTH_CEILING.provenance.kind, "OWNER_SET");
checkDeep("no owner decision is pending once the margin is approved (2026-11-03 16:11)", pendingOwnerDecisions([DEMOTION_MARGIN_SOURCE, HEALTH_CEILING, FOIR_CEILING]).length, 0);
checkDeep("an unconfirmed owner-set threshold is still listed", pendingOwnerDecisions([{ value: 1, provenance: { kind: "OWNER_SET", decision: "made-up test item", confirmed: false } }]).length, 1);
checkDeep("tier names are neutral placeholders", Object.values(TIER_LABEL), ["Tier 1", "Tier 2", "Tier 3"]);
const capped = tierFor(Ratio(0.99), { healthCover: "declared-absent", foir: Ratio(0.2) }, null);
check("ceiling applies before the label: label is the capped tier's", capped.label, TIER_LABEL.MIDDLE);

section("3.4 a drop is never celebrated");
const fell = tierFor(Ratio(0.3), fine, "UPPER");
check("a drop records where it fell from", fell.droppedFrom, "UPPER");
check("no celebratory wording anywhere in a drop", /congrat|well done|great|!|🎉/i.test(JSON.stringify(fell)), false);

section("3.5 coverage and range on every score");
const card = scoreCard(healthy(), fine, null);
checkDeep("a full card has coverage, range, axes and tier", [card.coverage, card.range !== null, card.axes.length, card.tier?.tier], [1, true, 3, "UPPER"]);
checkDeep("the three named axes", SENSITIVITY_AXES.map((a) => a.id), ["runway-3-vs-6", "swr-3-vs-4", "multiple-10-vs-15"]);
const thin = healthy();
thin.set("runway-months", measured(4));
thin.set("independence-multiple", measured(28));
const axes = scoreCard(thin, fine, null).axes;
const spread = (id: string) => {
  const r = axes.find((a) => a.axis.id === id)!.range;
  return r !== null && r.low < r.high;
};
check("4 months runway moves under 3-vs-6", spread("runway-3-vs-6"), true);
check("28x moves under 3%-vs-4% SWR", spread("swr-3-vs-4"), true);
check("10x-vs-15x has no carrier and says so", axes.find((a) => a.axis.id === "multiple-10-vs-15")!.range, null);
const refusedCard = scoreCard(unknownRunway, fine, null);
checkDeep("a refused card still reports coverage, but no range or tier", [refusedCard.coverage < 1, refusedCard.range, refusedCard.tier], [true, null, null]);

section("QA repair 2026-11-03: demotion margin disclosed; owner confirmed it 2026-11-03 16:11");
{
  const held = tierFor(Ratio(0.79), { healthCover: "covered", foir: Ratio(0.2) }, "UPPER");
  checkDeep("Codex's reproduction: 0.79 with UPPER held is UPPER, and says the margin held it", [held.tier, held.heldByMargin], ["UPPER", true]);
  check("a tier earned outright is not held by the margin", tierFor(Ratio(0.85), fine, "UPPER").heldByMargin, false);
  check("a first reading is never held", tierFor(Ratio(0.79), fine, null).heldByMargin, false);
  const heldCard = scoreCard(healthy(), fine, null);
  const margin = heldCard.thresholds.find((entry) => entry.id === "demotion-margin")!;
  checkDeep("the card carries the margin's provenance: owner-set, confirmed", [margin.threshold.provenance.kind, "confirmed" in margin.threshold.provenance && margin.threshold.provenance.confirmed], ["OWNER_SET", true]);
  check("nothing is pending once the margin is confirmed", heldCard.pending.length, 0);
  checkTrue("a refused card still carries the thresholds", scoreCard(unknownRunway, fine, null).pending.length === 0 && scoreCard(unknownRunway, fine, null).thresholds.length === 5);
  checkTrue("every tier threshold carries a provenance", heldCard.thresholds.every((entry) => entry.threshold.provenance.kind === "CITED" || entry.threshold.provenance.kind === "OWNER_SET"));
}

section("QA repair 2026-11-03: 10x-vs-15x is pending an owner decision, unscored, never invented");
{
  const axis = scoreCard(healthy(), fine, null).axes.find((a) => a.axis.id === "multiple-10-vs-15")!;
  checkDeep("status pending-decision, no range", [axis.status, axis.range], ["pending-decision", null]);
  checkTrue("the note says pending, unscored, and no insurance income score", axis.axis.note.startsWith("Pending an owner/product decision, unscored") && axis.axis.note.includes("no insurance income score"));
  check("no indicator was invented to carry it", INDICATORS.some((i) => i.alternatives.some((v) => v === 10 || v === 15)), false);
  check("a computable axis says ranged", scoreCard(healthy(), fine, null).axes.find((a) => a.axis.id === "runway-3-vs-6")!.status, "ranged");
  check("a refused composite makes a computable axis refused", scoreCard(unknownRunway, fine, null).axes.find((a) => a.axis.id === "runway-3-vs-6")!.status, "refused");
  check("…while 10x-vs-15x stays pending", scoreCard(unknownRunway, fine, null).axes.find((a) => a.axis.id === "multiple-10-vs-15")!.status, "pending-decision");
}

section("3.10 badge criteria table");
check("no criterion references a count or frequency", BADGE_CRITERIA.some((c) => /count|frequen|times|per (day|week|month)|streak|rank|leader/i.test(JSON.stringify(c))), false);
check("every valued criterion carries provenance", BADGE_CRITERIA.every((c) => c.threshold === null || c.threshold.provenance.kind === "CITED"), true);
check("runway badge threshold is the cited 6 months", BADGE_CRITERIA.find((c) => c.badgeId === "runway-six")!.threshold?.value, 6);
check("unknown runway earns nothing", badgesHeld({ runway: null, healthCover: "unknown", termCover: "unknown", loansClosed: [], revolvingCardDebt: null }).length, 0);

done();
