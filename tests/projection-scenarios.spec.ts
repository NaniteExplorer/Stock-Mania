/** Tasks 5.4 and 5.2: a scenario count, never a probability; a SIP pause costed at the lower band, in rupees and years. */
import { Money } from "@/core/money";
import { Count, Ordinal, Ratio, Years } from "@/core/units";
import { simulatePaths, type AnnualReturns, type Path, type Plan } from "@/domain/projection/bootstrap";
import { fanBands, headline, lastedToHorizon, reachedTarget, SCENARIO_CAVEAT, suspensionCost } from "@/domain/projection/scenarios";
import { check, done, section, throws } from "./harness";

const rupees = (v: string) => Money.fromRupees(v);
const path = (...values: string[]): Path => ({ wealth: values.map(rupees), depletedAt: null });

section("exact nearest-rank bands");
const ten = Array.from({ length: 10 }, (_, i) => path("0", String((i + 1) * 100)));
const bands = fanBands(ten);
check("median of 100..1000 is 500 (nearest rank)", bands[1]![50].toDecimalString(), "500.00");
check("10th percentile is 100", bands[1]![10].toDecimalString(), "100.00");
check("95th percentile is 1000", bands[1]![95].toDecimalString(), "1000.00");
check("bands are ordered", (() => { const b = bands[1]!; return [b[5], b[10], b[25], b[50], b[75], b[90], b[95]].every((m, i, all) => i === 0 || all[i - 1]!.isLessThanOrEqual(m)); })(), true);
throws("ragged paths are refused", () => fanBands([path("1"), path("1", "2")]), "same years");

section("a count, never a probability");
const count = reachedTarget(ten, rupees("700"), Ordinal(1));
check("4 of 10 reach 700", `${count.reached} of ${count.of}`, "4 of 10");
check("a path that touched the target earlier counts", reachedTarget([path("800", "100"), path("0", "0")], rupees("700"), Ordinal(1)).reached, 1);
const text = headline(count, Years(60));
check("headline", text, "In 4 of 10 scenarios replayed from Indian market history, the corpus reached your target by 60.");
check("no percent sign or probability word", /%|probab|likely|chance/i.test(text + SCENARIO_CAVEAT), false);
check("lasted counts depletion", lastedToHorizon([{ wealth: [rupees("1")], depletedAt: Years(70) }, path("1")]).reached, 1);
throws("a target year past the paths is refused", () => reachedTarget(ten, rupees("1"), Ordinal(5)), "past the end");

section("SIP suspension re-runs the full path set");
const history: AnnualReturns[] = Array.from({ length: 30 }, (_, i) => ({
  year: Count(1995 + i), equity: Ratio(((i * 37) % 11) / 20 - 0.15), debt: Ratio(0.07), inflation: Ratio(0.05),
}));
const plan: Plan = {
  startWealth: rupees("1000000"), currentAge: Years(35), retirementAge: Years(60), horizonAge: Years(85),
  annualContribution: rupees("600000"), contributionIndexed: true, equityShare: Ratio(0.7), withdrawalRate: Ratio(0.03),
};
const run = { paths: Count(200), seed: Count(42) };
const original = simulatePaths(plan, history, Count(4), run);
const paused = simulatePaths({ ...plan, suspension: { fromAge: Years(40), untilAge: Years(45) } }, history, Count(4), run);
const stopped = simulatePaths({ ...plan, suspension: { fromAge: Years(40), untilAge: null } }, history, Count(4), run);
check("same seed and path count: every path re-run", paused.length, original.length);
check("before the pause the paths are identical", original.every((p, i) => p.wealth[5]!.equals(paused[i]!.wealth[5]!)), true);
check("after it, every path is lower", original.every((p, i) => paused[i]!.wealth[10]!.isLessThan(p.wealth[10]!)), true);
check("stopping for good costs more than pausing", fanBands(stopped)[25]![50].isLessThan(fanBands(paused)[25]![50]), true);
const target = fanBands(original)[20]![50]; // the original median reaches it at year 20
const cost = suspensionCost(original, paused, target, Ordinal(25));
check("the cost is stated at the 10th percentile, in rupees", cost.rupeesAtTenth.isPositive, true);
check("and at the median", cost.rupeesAtMedian.isPositive, true);
check("and in years at the median", cost.yearsAtMedian !== null && cost.yearsAtMedian >= 1, true);
check("a band that never reaches the target says null, not a number", suspensionCost(original, paused, rupees("999999999999"), Ordinal(25)).yearsAtTenth, null);
throws("runs of different sizes are refused", () => suspensionCost(original, paused.slice(1), target, Ordinal(25)), "same number of paths");
throws("a suspension that ends before it starts", () => simulatePaths({ ...plan, suspension: { fromAge: Years(45), untilAge: Years(40) } }, history, Count(4), run), "end after it starts");
check("bands and cost are frozen", Object.isFrozen(bands) && Object.isFrozen(bands[0]) && Object.isFrozen(cost), true);

done();
