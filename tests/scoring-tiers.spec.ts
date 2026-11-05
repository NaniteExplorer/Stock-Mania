import { Ratio } from "@/core/units";
import { tierFor, type CeilingFacts } from "@/domain/scoring/tiers";
import { assertProperty, check, checkDeep, done, genInt, section } from "./harness";

const fine: CeilingFacts = { healthCover: "covered", foir: Ratio(0.3) };
const r = (n: number) => Ratio(n);

section("three tiers at 0.40 and 0.80");
checkDeep("0.39 / 0.40 / 0.80", [tierFor(r(0.39), fine, null).tier, tierFor(r(0.4), fine, null).tier, tierFor(r(0.8), fine, null).tier], ["LOWER", "MIDDLE", "UPPER"]);
check("labels are neutral placeholders until the owner names the tiers", tierFor(r(0.9), fine, null).label, "Tier 3");
check("distance to the next tier is stated", tierFor(r(0.7), fine, null).toNext?.toFixed(2), "0.10");
check("none at the top", tierFor(r(0.95), fine, null).toNext, null);

section("ceilings apply before the label, and are named");
const noCover = tierFor(r(0.95), { healthCover: "declared-absent", foir: r(0.3) }, null);
checkDeep("0.95 with no health cover is Steady, earned Strong, and says why", [noCover.tier, noCover.label, noCover.earned, noCover.ceilings.length], ["MIDDLE", "Tier 2", "UPPER", 1]);
check("a blocked next tier has no distance — it is not a matter of points", noCover.toNext, null);
const highFoir = tierFor(r(0.92), { healthCover: "covered", foir: r(0.55) }, null);
check("FOIR 55% bars the top tier", highFoir.tier, "MIDDLE");
check("and names the figure", highFoir.ceilings[0]?.reason.includes("55%"), true);
check("a ceiling that blocks the next tier is shown, so the missing distance is explained", tierFor(r(0.5), { healthCover: "declared-absent", foir: r(0.3) }, null).ceilings.length, 1);
check("a ceiling irrelevant to a Building score is not shown", tierFor(r(0.2), { healthCover: "covered", foir: r(0.55) }, null).ceilings.length, 0);
check("but it still blocks the climb past it", tierFor(r(0.5), { healthCover: "declared-absent", foir: r(0.3) }, null).toNext, null);

section("hysteresis on demotion: no flicker");
check("first time at 0.79: Steady", tierFor(r(0.79), fine, null).tier, "MIDDLE");
check("held Strong, dips to 0.79: still Strong", tierFor(r(0.79), fine, "UPPER").tier, "UPPER");
check("held Strong, falls to 0.77 (the margin): still Strong", tierFor(r(0.77), fine, "UPPER").tier, "UPPER");
check("held Strong, falls to 0.76: Steady, and the drop is recorded plainly", tierFor(r(0.76), fine, "UPPER").droppedFrom, "UPPER");
check("promotion is immediate", tierFor(r(0.8), fine, "MIDDLE").tier, "UPPER");
assertProperty(
  "a score oscillating within the margin below a held boundary never flickers",
  genInt(770, 830),
  (milli) => tierFor(r(milli / 1000), fine, "UPPER").tier === "UPPER",
);

done();
