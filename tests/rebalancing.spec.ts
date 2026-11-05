/** Task 6.2 acceptance: bands wider than 5/25; the cash-flow route first, realising no gain. */
import { Currency, Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { bandStanding, type Band, type Sleeve } from "@/domain/portfolio";
import { check, checkDeep, done, section } from "./harness";

const rupees = (value: string) => Money.fromRupees(value);
const pct = (value: string) => Percentage.of(value);
const band: Band = { absolute: pct("6"), relative: pct("30") };
const sleeve = (id: string, value: string, target: string): Sleeve => ({ id, name: id, value: rupees(value), target: pct(target) });
const refusal = (run: () => unknown): string => {
  try {
    run();
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};

section("breach is |actual − target| > min(absolute, relative × target); band 6/30");
const drifted = bandStanding([sleeve("equity", "80000", "60"), sleeve("debt", "20000", "40")], band);
checkDeep("80/20 against 60/40 breaches both", drifted.sleeves.map((s) => s.breached), [true, true]);
checkDeep("tolerances are min(6, 30% of target)", drifted.sleeves.map((s) => s.tolerance.scaled), [6_000_000n, 6_000_000n]);
checkDeep("deviation is signed points", drifted.sleeves.map((s) => s.deviation.scaled), [20_000_000n, -20_000_000n]);
check("within band: no breach, no route", bandStanding([sleeve("equity", "62000", "60"), sleeve("debt", "38000", "40")], band).cashFlowRoute, null);
check("exactly at tolerance is not a breach", bandStanding([sleeve("equity", "66000", "60"), sleeve("debt", "34000", "40")], band).breached, false);
const small = bandStanding([sleeve("equity", "86500", "90"), sleeve("gold", "13500", "10")], band);
check("a 10% sleeve's band is 3 points (relative wins)", small.sleeves[1]!.tolerance.scaled, 3_000_000n);
checkDeep("so 13.5% gold breaches while 86.5% equity does not", small.sleeves.map((s) => s.breached), [false, true]);

section("the cash-flow route comes first");
check("money goes to the underweight sleeve", drifted.cashFlowRoute?.sleeveId, "debt");
check("enough to reach target, rounded up to the paisa", drifted.cashFlowRoute?.contribution.toDecimalString(), "33333.34");
check("and that alone restores every band", drifted.cashFlowRoute?.restoresAll, true);
check("small sleeve breach routes new money to equity", small.cashFlowRoute?.contribution.toDecimalString(), "35000.00");
const three = bandStanding([sleeve("equity", "70000", "50"), sleeve("debt", "15000", "30"), sleeve("gold", "15000", "20")], band);
check("three sleeves: the most underweight gets it", three.cashFlowRoute?.sleeveId, "debt");
check("and the report says when contribution alone is not enough", three.cashFlowRoute?.restoresAll, false);
checkDeep("a route has no sale in it", Object.keys(drifted.cashFlowRoute ?? {}).sort(), ["contribution", "restoresAll", "sleeveId"]);

section("refusals");
check("a band narrower than 5 points", refusal(() => bandStanding([sleeve("a", "1", "100")], { ...band, absolute: pct("4") })).includes("wider than 5"), true);
check("a band narrower than 25% relative", refusal(() => bandStanding([sleeve("a", "1", "100")], { ...band, relative: pct("20") })).includes("wider than 5"), true);
check("exactly 5/25 is refused (owner: strictly wider)", refusal(() => bandStanding([sleeve("a", "1", "100")], { absolute: pct("5"), relative: pct("25") })).includes("wider than 5"), true);
check("targets not summing to 100%", refusal(() => bandStanding([sleeve("a", "1", "60"), sleeve("b", "1", "39.999999")], band)), "Targets must sum to exactly 100%.");
check("duplicate ids", refusal(() => bandStanding([sleeve("a", "1", "50"), sleeve("a", "1", "50")], band)), "Sleeve ids must be unique.");
check(
  "mixed currency",
  refusal(() => bandStanding([sleeve("a", "1", "50"), { id: "b", name: "b", value: Money.fromMinor(100n, Currency.USD), target: pct("50") }], band)),
  "Sleeves must share one currency.",
);
check("nothing invested", refusal(() => bandStanding([sleeve("a", "0", "50"), sleeve("b", "0", "50")], band)).startsWith("Nothing is invested"), true);

section("QA regression (Codex, 2026-10-30): exact rational relative tolerance");
// Target 33.333333%: 30% of it is 9.9999999 points, which truncates to 9.999999.
// A deviation of 9.9999995 points lies between the two: inside the true band.
const exact = bandStanding(
  [
    { id: "a", name: "a", value: Money.fromMinor(4333333250n), target: pct("33.333333") },
    { id: "b", name: "b", value: Money.fromMinor(5666666750n), target: pct("66.666667") },
  ],
  { absolute: pct("10"), relative: pct("30") },
);
check("inside the exact band, though outside the truncated one: not breached", exact.sleeves[0]!.breached, false);

section("frozen");
check("standing, sleeves and route are frozen", [drifted, drifted.sleeves, drifted.sleeves[0], drifted.cashFlowRoute].every(Object.isFrozen), true);

done();
