import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { Currency, Money } from "@/core/money";
import { Days, Ordinal } from "@/core/units";
import { decomposeMove, logRatioToMedian, place, type OwnerFigure } from "@/domain/scoring/percentile";
import { REFERENCE_DISTRIBUTIONS, type ReferenceDistribution } from "@/domain/scoring/percentile-references";
import { FUNDAMENTALS_UNAVAILABLE, holdingContext } from "@/domain/scoring/position";
import { PlacementPanel, placementRows } from "../app/(root)/standing/placement-section";
import { check, checkTrue, done, section } from "./harness";

// Made-up distributions and figures only; none of these is a real statistic.
const rs = (rupees: number) => Money.fromRupees(rupees);
const fake = (over: Partial<ReferenceDistribution> = {}): ReferenceDistribution => ({
  id: "fake", scale: "INDIA", measure: "income", unit: "adult", basis: "INR_NOMINAL", referenceYear: "2020",
  source: "Made-up", url: "https://example.invalid", published: "2020-01-01", pendingReason: null, limits: [],
  thresholds: [10, 25, 50, 75, 90, 99].map((p, i) => ({ percentile: Ordinal(p), minor: BigInt([1, 2, 4, 8, 16, 64][i]) * 100_000_00n })),
  ...over,
});
const income = (rupees: number, unit: OwnerFigure["unit"] = "adult"): OwnerFigure => ({ measure: "income", unit, amount: rs(rupees) });

section("3.8 placement: bands, never a point");
{
  const p = place(income(500_000), fake());
  check("band lower", p.state === "placed" && p.lower, 50);
  check("band upper", p.state === "placed" && p.upper, 75);
  check("label", p.state === "placed" && p.label, "Between the 50th and 75th percentile");
  const low = place(income(50_000), fake());
  check("below first cut", low.state === "placed" && `${low.lower}-${low.upper}`, "0-10");
}

section("3.8 placement: India stops at top 10%; widening above 90th");
{
  const top = place(income(10_000_000), fake());
  check("india top band", top.state === "placed" && top.label, "Top 10%");
  const world = place(income(2_000_000), fake({ scale: "WORLD" }));
  check("world above 90th widens to top", world.state === "placed" && world.label, "Top 10%");
  const worldTop = place(income(10_000_000), fake({ scale: "WORLD" }));
  check("world above last cut", worldTop.state === "placed" && worldTop.label, "Top 1%");
}

section("3.8 placement: refusals and stated mismatch");
{
  check("measure mismatch", place({ measure: "wealth", unit: "adult", amount: rs(1) }, fake()).state, "refused");
  const pending = place(income(1), fake({ thresholds: null, pendingReason: "pending" }));
  check("pending table refuses with reason", pending.state === "refused" && pending.reason, "pending");
  check("nominal USD refuses", place(income(1), fake({ basis: "USD_NOMINAL" })).state, "refused");
  check("PPP without factor refuses", place(income(1), fake({ basis: "INTL_PPP" })).state, "refused");
  check("non-INR owner refuses", place({ measure: "income", unit: "adult", amount: Money.fromRupees(1, Currency.USD) }, fake()).state, "refused");
  const hh = place(income(500_000, "household"), fake());
  check("unit mismatch widens", hh.state === "placed" && `${hh.lower}-${hh.upper}`, "25-90");
  checkTrue("unit mismatch stated", hh.state === "placed" && hh.notes.some((n) => n.includes("Unit mismatch")));
  // 1 intl$ = 25 INR (made up): ₹5,00,000 -> 20,000 intl$, against intl$ cuts.
  const ppp = { inrPerUnitNumerator: 25n, inrPerUnitDenominator: 1n, year: "2021", source: "made-up" };
  const w = place(income(500_000), fake({ scale: "WORLD", basis: "INTL_PPP", thresholds: [{ percentile: Ordinal(50), minor: 1_000_000n }, { percentile: Ordinal(75), minor: 3_000_000n }] }), ppp);
  check("PPP placement", w.state === "placed" && w.label, "Between the 50th and 75th percentile");
  checkTrue("PPP stated", w.state === "placed" && w.notes.some((n) => n.includes("PPP")));
}

section("3.8 stored references: every entry cited, dated, and refuses while pending");
for (const r of REFERENCE_DISTRIBUTIONS) {
  checkTrue(`${r.id} cited`, r.url.startsWith("https://") && r.source.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.published));
  check(`${r.id} refuses`, place(income(500_000), r).state, "refused");
}

section("3.9 log-ratio-to-median and decomposition");
{
  check("at median", logRatioToMedian(rs(100), rs(100)), 0);
  check("twice median", Number(logRatioToMedian(rs(200), rs(100))?.toFixed(6)), Number(Math.log(2).toFixed(6)));
  check("non-positive is null", logRatioToMedian(rs(0), rs(100)), null);
  const d = decomposeMove({ amount: rs(100_000), median: rs(50_000) }, { amount: rs(121_000), median: rs(55_000) }, rs(10_000));
  checkTrue("decomposed", d.state === "decomposed");
  if (d.state === "decomposed") {
    check("contributions ln(1.1)", d.contributions.toFixed(9), Math.log(1.1).toFixed(9));
    check("market ln(1.1)", d.market.toFixed(9), Math.log(1.1).toFixed(9));
    check("reference ln(1.1)", d.reference.toFixed(9), Math.log(1.1).toFixed(9));
    check("identity", (d.contributions + d.market - d.reference - d.total).toFixed(12), "0.000000000000");
    checkTrue("sentence names all three", d.sentence.includes("new money 10.0%") && d.sentence.includes("median changed 10.0%"));
  }
  const fell = decomposeMove({ amount: rs(100), median: rs(100) }, { amount: rs(103), median: rs(106) }, rs(0));
  checkTrue("income: percentile-style fall explained", fell.state === "decomposed" && fell.sentence.includes("fell") && fell.sentence.includes("3.0%") && fell.sentence.includes("6.0%"));
  check("mixed currency refused", decomposeMove({ amount: rs(1), median: rs(1) }, { amount: rs(1), median: Money.fromRupees(1, Currency.USD) }, rs(0)).state, "refused");
}

section("3.7 holding context: descriptive, unavailable rather than invented");
{
  const c = holdingContext({ name: "Made-up Ltd", costBasis: rs(100), marketValue: rs(150), portfolioValue: rs(600), priceAgeDays: Days(2) });
  check("weight", c.weight.state === "available" && c.weight.value, 0.25);
  check("return", c.unrealisedReturn.state === "available" && c.unrealisedReturn.value, 0.5);
  check("price age", c.priceAge.state === "available" && c.priceAge.value, 2);
  check("fundamentals unavailable", c.fundamentals.state === "unavailable" && c.fundamentals.reason, FUNDAMENTALS_UNAVAILABLE);
  const bare = holdingContext({ name: "x", costBasis: null, marketValue: null, portfolioValue: null, priceAgeDays: null });
  checkTrue("all unavailable", [bare.weight, bare.unrealisedReturn, bare.priceAge].every((f) => f.state === "unavailable"));
  const text = JSON.stringify(c);
  checkTrue("no advice words", !/\b(buy|sell|hold now|recommend(ed)? (to|you)|rating:|strong|weak)\b/i.test(text.replace("recommends no action", "")));
}

section("standing placement panel: guess gate");
{
  const placed = placementRows([fake()], income(500_000), null, "n/a");
  const hidden = render(h(PlacementPanel, { rows: placed, revealed: false }));
  checkTrue("withheld before guess", hidden.includes("Shown after your guess") && !hidden.includes("50th"));
  const shown = render(h(PlacementPanel, { rows: placed, revealed: true }));
  checkTrue("revealed after guess", shown.includes("Between the 50th and 75th percentile"));
  const prod = render(h(PlacementPanel, { rows: placementRows(REFERENCE_DISTRIBUTIONS, null, null, "not wired"), revealed: false }));
  checkTrue("production refuses with sources", prod.includes("not yet transcribed") && prod.includes("wid.world"));
}

done();
