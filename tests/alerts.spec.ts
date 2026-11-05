/** Task 6.1 acceptance: each alert states facts and suggests nothing; the boundary alert states both rates. */
import { Currency, Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate, FinancialYear } from "@/core/time";
import { Days, Months } from "@/core/units";
import {
  concentrationAlert,
  exemptionUnusedAlert,
  runwayAlert,
  sourceFailureAlert,
  termBoundaryAlert,
  type Alert,
} from "@/domain/alerts";
import { check, done, section } from "./harness";

const d = CalendarDate.parse;
const refusal = (run: () => unknown): string => {
  try {
    run();
    return "";
  } catch (error) {
    return (error as Error).message;
  }
};
const rupees = (value: string) => Money.fromRupees(value);
const asOf = d("2026-03-04");

const lot = {
  lotId: "L1",
  instrument: "INFY",
  acquiredOn: d("2025-03-12"),
  longTermFrom: d("2026-03-13"),
  unrealisedGain: rupees("40000") as Money | null,
  shortTermRate: Percentage.of("20"),
  longTermRate: Percentage.of("12.5"),
};

section("term boundary");
const boundary = termBoundaryAlert(lot, asOf, Days(30));
check(
  "states the date, the days left and both rates",
  boundary?.text,
  "INFY bought 2025-03-12 becomes long-term on 2026-03-13, in 9 days. Its unrealised gain of ₹40,000.00 is taxed at 20.00% short-term and 12.50% long-term.",
);
check("keyed by lot, so a repeat is the same alert", boundary?.key, "term:L1");
check("outside the window: nothing", termBoundaryAlert(lot, asOf, Days(5)), null);
check("a loss: nothing", termBoundaryAlert({ ...lot, unrealisedGain: rupees("-100") }, asOf, Days(30)), null);
check("an unknown gain is not a gain", termBoundaryAlert({ ...lot, unrealisedGain: null }, asOf, Days(30)), null);
check("already long-term: nothing", termBoundaryAlert(lot, d("2026-03-13"), Days(30)), null);
check("the day before: 1 day", termBoundaryAlert(lot, d("2026-03-12"), Days(30))?.text.includes("in 1 day."), true);

section("unused exemption");
const fy = FinancialYear.containing(asOf);
const exemption = exemptionUnusedAlert(fy, rupees("125000"), rupees("25000"), d("2026-03-11"), Days(30));
check("states unused, total and days left", exemption?.text, `₹1,00,000 of the ₹1,25,000 long-term equity exemption for ${fy.label} is unused. The financial year ends 2026-03-31, in 20 days.`);
check("fully used: nothing", exemptionUnusedAlert(fy, rupees("125000"), rupees("125000"), asOf, Days(30)), null);
check("early in the year: nothing", exemptionUnusedAlert(fy, rupees("125000"), rupees("0"), d("2025-06-01"), Days(30)), null);
check("asOf outside the year: nothing", exemptionUnusedAlert(fy, rupees("125000"), rupees("0"), d("2026-04-02"), Days(400)), null);

section("concentration");
const holding = { id: "H1", name: "HDFC Bank", value: rupees("250000") };
check(
  "above threshold: states share, amounts and the owner's threshold",
  concentrationAlert(holding, rupees("1000000"), Percentage.of("20"), asOf)?.text,
  "HDFC Bank is 25.00% of the portfolio (₹2,50,000 of ₹10,00,000). Your threshold is 20.00%.",
);
check("exactly at threshold: nothing", concentrationAlert(holding, rupees("1250000"), Percentage.of("20"), asOf), null);
check("one paisa over: fires (exact comparison)", concentrationAlert({ ...holding, value: rupees("250000.01") }, rupees("1250000.01"), Percentage.of("20"), asOf)?.kind, "CONCENTRATION");
check("unknown total: nothing", concentrationAlert(holding, null, Percentage.of("20"), asOf), null);
check("zero total: nothing", concentrationAlert(holding, rupees("0"), Percentage.of("20"), asOf), null);
let mixed = "";
try {
  concentrationAlert({ ...holding, value: Money.fromMinor(100n, Currency.USD) }, rupees("100"), Percentage.of("1"), asOf);
} catch (error) {
  mixed = (error as Error).message;
}
check("mixed currency refuses", mixed.includes("one currency"), true);

section("runway");
check("below target", runwayAlert(Months(2.5), Months(6), asOf)?.text, "Emergency runway is 2.5 months of expenses. Your target is 6.0 months.");
check("at target: nothing", runwayAlert(Months(6), Months(6), asOf), null);
check("unknown runway is not a shortfall", runwayAlert(null, Months(6), asOf), null);

section("source failure");
const source = { id: "amfi", name: "AMFI NAV feed", lastSuccessOn: d("2026-02-28") as CalendarDate | null };
check("stale past its allowed age", sourceFailureAlert(source, Days(3), asOf)?.text, "AMFI NAV feed last returned data on 2026-02-28, 4 days ago. Figures that depend on it are stale.");
check("within age: nothing", sourceFailureAlert(source, Days(4), asOf), null);
check("never succeeded: alerts", sourceFailureAlert({ ...source, lastSuccessOn: null }, Days(3), asOf)?.kind, "SOURCE_FAILURE");

section("QA regressions (Codex, 2026-10-30)")
check(
  "a success after asOf is refused by name, not a Days(-1) crash",
  refusal(() => sourceFailureAlert({ ...source, lastSuccessOn: d("2026-04-01") }, Days(3), d("2026-03-31"))).includes("after the evaluation date"),
  true,
);
check("same-day success: fresh, no alert", sourceFailureAlert({ ...source, lastSuccessOn: asOf }, Days(0), asOf), null);
check("1.96 months against 2 reads 1.9, never 2.0", runwayAlert(Months(1.96), Months(2), asOf)?.text.startsWith("Emergency runway is 1.9 months"), true);
check("2.5 still reads 2.5", runwayAlert(Months(2.5), Months(6), asOf)?.text.includes("2.5 months"), true);

section("review regressions (2026-10-30)")
check("just over the threshold reads as over", concentrationAlert({ ...holding, value: rupees("200400") }, rupees("1000000"), Percentage.of("20"), asOf)?.text.includes("20.04%"), true);
check("a fractional target is not float noise", runwayAlert(Months(0.1), Months(1 / 3), asOf)?.text.endsWith("Your target is 0.3 months."), true);

section("copy states facts and suggests nothing");
const all = [
  boundary,
  exemption,
  concentrationAlert(holding, rupees("1000000"), Percentage.of("20"), asOf),
  runwayAlert(Months(2.5), Months(6), asOf),
  sourceFailureAlert(source, Days(3), asOf),
  sourceFailureAlert({ ...source, lastSuccessOn: null }, Days(3), asOf),
].filter((a): a is Alert => a !== null);
check("every rule produced an alert", all.length, 6);
const advice = /\b(should|consider|sell|buy|recommend|wait|hold off|will rise|will fall|expected to|likely)\b/i;
check("no advice verb or forecast in any text", all.filter((a) => advice.test(a.text)).map((a) => a.kind).join(","), "");
check("every alert is frozen", all.every(Object.isFrozen), true);

done();
