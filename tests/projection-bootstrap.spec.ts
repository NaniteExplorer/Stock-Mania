/** Task 5.1 acceptance: stationary blocks; equity and debt resampled jointly by year; no correlation matrix. */
import { Currency, Money } from "@/core/money";
import { Count, Ratio, Years } from "@/core/units";
import { mulberry32, resampleYears, simulatePaths, type AnnualReturns, type Plan } from "@/domain/projection/bootstrap";
import { lastedToHorizon } from "@/domain/projection/scenarios";
import { check, checkDeep, done, section, throws } from "./harness";

const year = (y: number, equity: number, debt: number, inflation: number): AnnualReturns => ({
  year: Count(y), equity: Ratio(equity), debt: Ratio(debt), inflation: Ratio(inflation),
});
const history = Array.from({ length: 30 }, (_, i) => year(1995 + i, ((i * 37) % 11) / 20 - 0.15, 0.07 + (i % 3) / 100, 0.05 + (i % 4) / 100));
const plan: Plan = {
  startWealth: Money.fromRupees("1000000"),
  currentAge: Years(35),
  retirementAge: Years(55),
  horizonAge: Years(90),
  annualContribution: Money.fromRupees("600000"),
  contributionIndexed: true,
  equityShare: Ratio(0.7),
  withdrawalRate: Ratio(0.03),
};

section("reproducible");
const a = simulatePaths(plan, history, Count(4), { paths: Count(50), seed: Count(7) });
const b = simulatePaths(plan, history, Count(4), { paths: Count(50), seed: Count(7) });
check("same seed, same paths", a.every((p, i) => p.wealth.every((w, j) => w.equals(b[i]!.wealth[j]!))), true);
const c = simulatePaths(plan, history, Count(4), { paths: Count(50), seed: Count(8) });
check("a different seed differs", a.some((p, i) => !p.wealth[55]!.equals(c[i]!.wealth[55]!)), true);
check("55 simulated years plus today", a[0]!.wealth.length, 56);
check("index 0 is today's wealth", a[0]!.wealth[0]!.toDecimalString(), "1000000.00");

section("joint resampling by year");
// Equity and debt identical in every year: if both are drawn from the same year, a pure-equity
// and a pure-debt portfolio follow identical paths under the same seed.
const twin = history.map((y) => year(y.year, y.equity, y.equity, y.inflation));
const allEquity = simulatePaths({ ...plan, equityShare: Ratio(1) }, twin, Count(4), { paths: Count(20), seed: Count(3) });
const allDebt = simulatePaths({ ...plan, equityShare: Ratio(0) }, twin, Count(4), { paths: Count(20), seed: Count(3) });
check("co-moving inputs stay co-moving in every path", allEquity.every((p, i) => p.wealth.every((w, j) => w.equals(allDebt[i]!.wealth[j]!))), true);

section("stationary blocks");
const random = mulberry32(Count(11));
const picks = resampleYears(Count(30), Count(20000), Count(4), random);
let blocks = 1;
for (let i = 1; i < picks.length; i += 1) if (picks[i] !== (picks[i - 1]! + 1) % 30) blocks += 1;
const meanLength = picks.length / blocks;
check("mean block length is near 4 (geometric, continuation 3/4)", meanLength > 3.5 && meanLength < 4.6, true);
check("indices stay inside the series", picks.every((i) => i >= 0 && i < 30), true);
check("blocks wrap round the end of the series", picks.some((p, i) => i > 0 && picks[i - 1] === 29 && p === 0), true);
throws("a series too short for its blocks is refused", () => resampleYears(Count(7), Count(10), Count(4), random), "at least 8");

section("real terms, contributions, withdrawals");
const flat = Array.from({ length: 10 }, (_, i) => year(2000 + i, 0.06, 0.06, 0.06));
const still = simulatePaths({ ...plan, annualContribution: Money.fromRupees("0"), retirementAge: Years(89) }, flat, Count(4), { paths: Count(1), seed: Count(1) })[0]!;
check("6% nominal under 6% inflation is flat in today's rupees", still.wealth[30]!.toDecimalString(), "1000000.00");
const saver = simulatePaths({ ...plan, retirementAge: Years(36), horizonAge: Years(38), withdrawalRate: Ratio(0.03) }, flat, Count(4), { paths: Count(1), seed: Count(1) })[0]!;
checkDeep("one year of contribution, then 3% of 16L withdrawn each year", saver.wealth.map((w) => w.toDecimalString()), ["1000000.00", "1600000.00", "1552000.00", "1504000.00"]);
const spender = simulatePaths({ ...plan, annualContribution: Money.fromRupees("0"), retirementAge: Years(35), withdrawalRate: Ratio(0.5) }, flat, Count(4), { paths: Count(1), seed: Count(1) })[0]!;
check("a 50% withdrawal runs out, and says when", spender.depletedAt, 36);
check("a depleted path stays at zero, never negative", spender.wealth.slice(3).every((w) => w.isZero), true);

section("refusals and immutability");
throws("retirement after the horizon", () => simulatePaths({ ...plan, retirementAge: Years(95) }, history, Count(4), { paths: Count(1), seed: Count(1) }), "Ages must run");
throws("zero paths", () => simulatePaths(plan, history, Count(4), { paths: Count(0), seed: Count(1) }), "at least one path");
check("paths and their wealth arrays are frozen", Object.isFrozen(a) && a.every((p) => Object.isFrozen(p) && Object.isFrozen(p.wealth)), true);

section("review regressions (2026-10-30)");
const broke = simulatePaths({ ...plan, startWealth: Money.fromRupees("0"), suspension: { fromAge: Years(35), untilAge: Years(37) } }, history, Count(4), { paths: Count(5), seed: Count(2) });
check("a zero balance while saving is not depletion", broke.every((p) => p.depletedAt === null || p.depletedAt >= 55), true);
throws("a negative start is refused, not erased", () => simulatePaths({ ...plan, startWealth: Money.fromRupees("-1000000") }, history, Count(4), { paths: Count(1), seed: Count(1) }), "negative");
throws("mixed currency is refused", () => simulatePaths({ ...plan, annualContribution: Money.fromMinor(100n, Currency.USD) }, history, Count(4), { paths: Count(1), seed: Count(1) }), "one currency");
const fixedSip = simulatePaths({ ...plan, contributionIndexed: false }, history, Count(4), { paths: Count(1), seed: Count(5) })[0]!;
const indexedSip = simulatePaths(plan, history, Count(4), { paths: Count(1), seed: Count(5) })[0]!;
check("a fixed nominal SIP builds less than an indexed one", fixedSip.wealth[20]!.isLessThan(indexedSip.wealth[20]!), true);

section("QA repair 2026-11-04: depletion after the year's return, and boundary invariants");
const crash = Array.from({ length: 8 }, (_, i) => year(2000 + i, -1, 0, 0));
const lastYear: Plan = {
  startWealth: Money.fromRupees("100"), currentAge: Years(60), retirementAge: Years(60), horizonAge: Years(61),
  annualContribution: Money.fromRupees("0"), contributionIndexed: true, equityShare: Ratio(1), withdrawalRate: Ratio(0.03),
};
const once = { paths: Count(1), seed: Count(1) };
const wiped = simulatePaths(lastYear, crash, Count(4), once)[0]!;
check("a final-year total loss ends at 0.00", wiped.wealth[wiped.wealth.length - 1]!.toDecimalString(), "0.00");
check("and is recorded as depleted at the age reached with nothing", wiped.depletedAt, 61);
check("so the scenario count does not call it lasting", lastedToHorizon([wiped]).reached, 0);
const withdrawnOut = simulatePaths({ ...lastYear, withdrawalRate: Ratio(1) }, history, Count(4), once)[0]!;
check("a withdrawal that empties the pot depletes at that year's age", withdrawnOut.depletedAt, 60);
throws("an equity share above 1 refuses", () => simulatePaths({ ...lastYear, equityShare: Ratio(2) }, crash, Count(4), once), "equity share");
throws("a negative equity share refuses", () => simulatePaths({ ...lastYear, equityShare: Ratio(-0.1) }, crash, Count(4), once), "equity share");
throws("a negative contribution refuses, not clamps", () => simulatePaths({ ...lastYear, retirementAge: Years(61), horizonAge: Years(62), annualContribution: Money.fromRupees("-1000") }, crash, Count(4), once), "contribution is negative");
throws("a withdrawal rate above 1 refuses", () => simulatePaths({ ...lastYear, withdrawalRate: Ratio(1.5) }, crash, Count(4), once), "withdrawal rate");
throws("a gross return below -100% refuses", () => simulatePaths(lastYear, [...crash.slice(1), year(2010, -1.5, 0, 0)], Count(4), once), "below -100%");
throws("inflation of -100% refuses", () => simulatePaths(lastYear, [...crash.slice(1), year(2010, 0, 0, -1)], Count(4), once), "inflation");

done();
