/**
 * /signals — the Tier 2 board (DESIGN §8.3, tasks 6.3.s / 6.3.b).
 *
 * Covers the use case (composition of the existing rules, absent inputs reported), the
 * pure view model (percentile only with dispersion, refusals, stale), and the rendered
 * copy (no recommendation verbs anywhere, no interpretation on the macro panel, no action
 * on the page), across all six states. Made-up figures only.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { Ok, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate, FinancialYear } from "@/core/time";
import { Count, Days, Months } from "@/core/units";
import { ViewSourceHealth } from "@/app/source-health.usecases";
import { NO_OPTIONAL_INPUTS, ViewSignals, type SignalsReads } from "@/app/signals.usecases";
import type { StoredTaxSettings } from "@/domain/tax";
import {
  INTERPRETATION_WORDS,
  RECOMMENDATION_WORDS,
  allocationView,
  buildSignalsView,
  drawdownView,
  macroRow,
  type DrawdownEpisodes,
} from "../app/(root)/signals/signals-model";
import { SignalsScreen } from "../app/(root)/signals/signals-view";
import SignalsLoading from "../app/(root)/signals/loading";
import SignalsError from "../app/(root)/signals/error";
import { check, checkTrue, done, section } from "./harness";

const on = (iso: string) => CalendarDate.parse(iso);
const inr = (v: string) => Money.fromRupees(v);
const pct = (v: string) => Percentage.of(v);
const userId = UserId.from("user_signals_1");
const asOf = on("2027-03-11"); // 20 days before FY 2026-27 ends
const strip = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&");
const copyOf = (html: string) => `${strip(html)} ${[...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]).join(" ")}`;

type Position = { instrumentId: { value: string }; label: string; reportingMarketValue: Money | null };
const position = (id: string, value: string | null): Position => ({ instrumentId: { value: id }, label: id.toUpperCase(), reportingMarketValue: value === null ? null : inr(value) });

function reads(opts: { positions?: Position[]; stale?: string[]; settings?: boolean; used?: string; failValuation?: boolean } = {}): SignalsReads {
  const positions = opts.positions ?? [];
  const unpriced = positions.filter((p) => p.reportingMarketValue === null).map((p) => p.label);
  const total = unpriced.length > 0 || positions.length === 0 ? (positions.length === 0 ? Money.zero() : null)
    : positions.reduce((sum, p) => sum.plus(p.reportingMarketValue!), Money.zero());
  const settings: StoredTaxSettings = {
    financialYear: "2026-27", regimeKey: "IN-FY2025", marginalSlabRate: pct("30"), ltcgExemption: inr("125000"),
    usesNewRegime: true, totalIncome: inr("2000000"), residentStatus: "RESIDENT",
  };
  return {
    valuePortfolio: {
      execute: async () => {
        if (opts.failValuation) throw new Error("price ladder offline");
        return Ok({
          valued: positions, totalCost: null, totalMarketValue: total, unrealisedGain: null, realisedGain: null,
          income: Money.zero(), absoluteReturn: null, unpricedPositions: unpriced, stalePositions: opts.stale ?? [], unconvertedPositions: [],
        } as never);
      },
    },
    taxReport: { execute: async () => Ok({ assessment: { exemptionUsed: inr(opts.used ?? "0") }, events: [] } as never) },
    taxSettings: { findFor: async (_user: UserId, year: FinancialYear) => (opts.settings && year.label === "2026-27" ? settings : null) },
  };
}

const ruleOf = (snapshot: Awaited<ReturnType<ViewSignals["execute"]>>, kind: string) => snapshot.rules.find((r) => r.kind === kind)!;

section("use case: nothing wired, nothing held — every absent input is named, never guessed");
const bare = await new ViewSignals(reads()).execute({ userId, asOf });
check("holdings are known and zero", bare.holdings.state === "KNOWN" ? bare.holdings.count : "unknown", 0);
check("allocation with no holdings is empty", bare.allocation.state, "EMPTY");
check("five rules, in order", bare.rules.map((r) => r.kind).join(","), "TERM_BOUNDARY,EXEMPTION_UNUSED,CONCENTRATION,RUNWAY_BELOW_TARGET,SOURCE_FAILURE");
checkTrue("every rule is not evaluated", bare.rules.every((r) => r.status === "NOT_EVALUATED"));
const noSettings = ruleOf(bare, "EXEMPTION_UNUSED");
checkTrue("no stored tax settings: exemption rule names Settings", noSettings.status === "NOT_EVALUATED" && noSettings.reason.includes("Tax settings for FY 2026-27 are not stored"));
check("tax position unknown without settings, never an assumed slab", bare.tax.state, "UNKNOWN");
check("source health unknown until the monitor is wired", bare.sources.state, "UNKNOWN");

section("use case: the existing rules fire through, unchanged");
const sources = await new ViewSourceHealth({
  observationsFor: async (id) => {
    if (id === "broken") throw new Error("disk");
    return [];
  },
}).execute({ userId, asOf, sources: [{ id: "amfi", name: "AMFI NAV feed", maxAge: Days(3) }, { id: "broken", name: "Broken feed", maxAge: Days(3) }] });
const full = await new ViewSignals(reads({ positions: [position("a", "80000"), position("b", "20000")], settings: true, used: "25000" })).execute({
  userId,
  asOf,
  optional: {
    lotsNearBoundary: [{
      lotId: "l1", instrument: "A", acquiredOn: on("2026-03-20"), longTermFrom: on("2027-03-21"),
      unrealisedGain: inr("40000"), shortTermRate: pct("20"), longTermRate: pct("12.5"),
    }],
    concentrationThreshold: pct("50"),
    runway: { months: Months(1.5), target: Months(6) },
    allocation: {
      sleeves: [{ id: "eq", name: "Equity", value: inr("80000"), target: pct("60") }, { id: "debt", name: "Debt", value: inr("20000"), target: pct("40") }],
      band: { absolute: pct("6"), relative: pct("30") },
    },
    sources,
  },
});
const exemptionRule = ruleOf(full, "EXEMPTION_UNUSED");
check("exemption: the alerts.ts text, limit from the regime",
  exemptionRule.status === "FIRED" ? exemptionRule.alerts[0]!.text : exemptionRule.status,
  "₹1,00,000 of the ₹1,25,000 long-term equity exemption for 2026-27 is unused. The financial year ends 2027-03-31, in 20 days.");
check("tax position reads the report's exemption used", full.tax.state === "KNOWN" ? full.tax.used.toDecimalString() : "unknown", inr("25000").toDecimalString());
const term = ruleOf(full, "TERM_BOUNDARY");
checkTrue("term boundary fires inside the 30-day window and states both rates", term.status === "FIRED" && term.alerts[0]!.text.includes("20.00% short-term and 12.50% long-term"));
const conc = ruleOf(full, "CONCENTRATION");
check("concentration: only the holding above the threshold", conc.status === "FIRED" ? conc.alerts.map((a) => a.key).join(",") : conc.status, "concentration:a");
const runway = ruleOf(full, "RUNWAY_BELOW_TARGET");
check("runway below target", runway.status === "FIRED" ? runway.alerts[0]!.text : runway.status, "Emergency runway is 1.5 months of expenses. Your target is 6.0 months.");
const src = ruleOf(full, "SOURCE_FAILURE");
checkTrue("a never-succeeded source fires; an unreadable one is named, not guessed",
  src.status === "FIRED" && src.alerts.length === 1 && src.alerts[0]!.text.startsWith("AMFI NAV feed has never returned data") && (src.note ?? "").includes("Broken feed"));
check("header counts failing sources", full.sources.state === "KNOWN" ? full.sources.failing : "unknown", 1);
checkTrue("band standing composed from bandStanding", full.allocation.state === "STANDING" && full.allocation.standing.breached);

const unpricedRun = await new ViewSignals(reads({ positions: [position("a", "80000"), position("z", null)] })).execute({ userId, asOf, optional: { ...NO_OPTIONAL_INPUTS, concentrationThreshold: pct("50") } });
const unpricedConc = ruleOf(unpricedRun, "CONCENTRATION");
checkTrue("an unpriced holding makes concentration not evaluated, naming it", unpricedConc.status === "NOT_EVALUATED" && unpricedConc.reason.includes("Z"));
check("holdings but no stored target: allocation unknown", unpricedRun.allocation.state, "UNKNOWN");

const narrow = await new ViewSignals(reads({ positions: [position("a", "1")] })).execute({
  userId, asOf, optional: { ...NO_OPTIONAL_INPUTS, allocation: { sleeves: [{ id: "eq", name: "Equity", value: inr("1"), target: pct("100") }], band: { absolute: pct("5"), relative: pct("25") } } },
});
checkTrue("5/25 bands are refused by bandStanding, and the refusal is shown", narrow.allocation.state === "REFUSED" && narrow.allocation.reason.includes("wider than 5 points"));
const failedValuation = await new ViewSignals(reads({ failValuation: true })).execute({ userId, asOf });
checkTrue("a valuation failure is unknown with its cause, not an empty portfolio", failedValuation.holdings.state === "UNKNOWN" && failedValuation.holdings.reason.includes("price ladder offline"));

section("model: allocation — the cash-flow route first, as arithmetic");
const standingView = allocationView(full.allocation);
checkTrue("standing view", standingView.state === "standing");
if (standingView.state === "standing") {
  check("route states new money and no realised gain",
    standingView.route,
    "New money of ₹33,333.34 into Debt brings it to its 40.00% target without realising any gain. That alone puts every sleeve inside its band.");
  check("deviation in points, signed", standingView.rows[1]!.deviation, "−20.00 pp");
  check("band is the min of absolute and relative", standingView.rows[1]!.band, "±6.00 pp");
  check("status words are facts", standingView.rows.map((r) => r.status).join(","), "Outside band,Outside band");
}
const staleStanding = allocationView({ ...(full.allocation as Extract<typeof full.allocation, { state: "STANDING" }>), stale: ["A"] });
checkTrue("stale prices make the panel stale, values kept", staleStanding.state === "stale" && staleStanding.rows.length === 2 && (staleStanding.staleNote ?? "").includes("A"));

section("model: a percentile never renders without its dispersion");
const episodes: DrawdownEpisodes = {
  index: "Nifty 50", source: "NSE index history", asOf, stale: false, drawdown: pct("-8.4"), peakOn: on("2026-09-14"),
  sinceYear: 2000, deeperThan: pct("71"), episodes: Count(14),
  outcomes: { min: pct("-22"), q1: pct("2"), q3: pct("19"), max: pct("41") },
};
const shown = drawdownView({ state: "MEASURED", episodes });
checkTrue("shown", shown.state === "shown");
if (shown.state === "shown") {
  check("headline", shown.headline, "−8.4% from the high of 14 Sept");
  check("placement and dispersion are one sentence",
    shown.placement,
    "Deeper than 71% of days since 2000. After the 14 drawdowns this deep, the next 12 months ranged from −22% to +41%; the middle half from +2% to +19%.");
  checkTrue("strip ordered and zero inside it", shown.strip.min === 0 && shown.strip.max === 100 && shown.strip.q1 < shown.strip.q3 && shown.strip.zero > shown.strip.min && shown.strip.zero < shown.strip.max);
}
const refused = drawdownView({ state: "MEASURED", episodes: { ...episodes, episodes: Count(4) } });
checkTrue("under 10 episodes refuses, naming the count", refused.state === "refused" && refused.reason.startsWith("Too few past drawdowns this deep to show what followed") && refused.reason.includes("4 comparable episodes"));
checkTrue("a refused drawdown carries no percentile at all", !JSON.stringify(refused).includes("71"));
check("stale episodes are stale, not hidden", drawdownView({ state: "MEASURED", episodes: { ...episodes, stale: true } }).state, "stale");
check("no holdings: empty", drawdownView({ state: "NO_HOLDINGS" }).state, "empty");

const macro = macroRow({ id: "x", series: "INR per USD", source: "Frankfurter", observation: { level: "84.10" as never, asOf, stale: false, sinceYear: 2000, percentile: pct("88"), historyMin: "44.90" as never, historyMax: "88.40" as never } });
check("macro percentile always carries the own-history range", macro.placement, "Percentile 88 of readings since 2000; own range 44.90 to 88.40");
const absent = macroRow({ id: "y", series: "Crude oil", source: null, observation: null });
checkTrue("a series with no source is unknown with its reason, never approximated", typeof absent.level !== "string" && absent.level.reason === "No source is wired for this series.");

section("rendered: no advice, no action, no interpretation");
const happy = buildSignalsView(full, { drawdown: { state: "MEASURED", episodes }, macro: [{ id: "x", series: "INR per USD", source: "Frankfurter", observation: { level: "84.10" as never, asOf, stale: false, sinceYear: 2000, percentile: pct("88"), historyMin: "44.90" as never, historyMax: "88.40" as never } }] });
const happyHtml = render(h(SignalsScreen, { view: happy }));
const views = [
  happyHtml,
  render(h(SignalsScreen, { view: buildSignalsView(bare, { drawdown: null }) })),
  render(h(SignalsScreen, { view: buildSignalsView(unpricedRun, { drawdown: { state: "MEASURED", episodes: { ...episodes, episodes: Count(4) } } }) })),
  render(h(SignalsScreen, { view: buildSignalsView(narrow, { drawdown: null }) })),
  render(h(SignalsScreen, { view: buildSignalsView(failedValuation, { drawdown: null }) })),
];
for (const [i, html] of views.entries()) {
  const words = RECOMMENDATION_WORDS.exec(copyOf(html));
  check(`view ${i}: no recommendation verb in any rendered string`, words?.[0] ?? "none", "none");
  check(`view ${i}: no button or order link on the page`, (html.match(/<button\b/g) ?? []).length, 0);
  // The one other link is to the owner's own settings (allocation UNKNOWN state, owner request 2026-11-05) — never an order.
  checkTrue(`view ${i}: the only links are the data-source alert and the allocation settings`, [...html.matchAll(/href="([^"]*)"/g)].every((m) => m[1] === "#rule-SOURCE_FAILURE" || m[1] === "/settings/allocation"));
  check(`view ${i}: one h1`, (html.match(/<h1\b/g) ?? []).length, 1);
  const text = strip(html);
  checkTrue(`view ${i}: every "Deeper than" sentence carries "ranged from"`, (text.match(/Deeper than[^.]*\./g) ?? []).every((s) => text.includes(`${s} After the`) && text.includes("ranged from")));
}
const macroPanel = happyHtml.slice(happyHtml.indexOf(">Macro levels<"), happyHtml.indexOf(">FII/DII flows<"));
check("macro panel: no interpretation words", INTERPRETATION_WORDS.exec(strip(macroPanel))?.[0] ?? "none", "none");
checkTrue("macro panel: no arrows", !/[↑↓▲▼⬆⬇→←]/.test(macroPanel));
check("macro panel: no colour by value (no tone attributes)", /data-tone|data-polarity|\b(gain|loss)\b/.exec(macroPanel)?.[0] ?? "none", "none");
checkTrue("macro panel names no security held", !macroPanel.includes(">A<") && !macroPanel.includes("Equity"));
checkTrue("the strip renders beside the percentile, as one figure", /<figure[^>]*>[^]*Deeper than[^]*role="img"[^]*<\/figure>/.test(happyHtml));
checkTrue("stated alerts are rendered verbatim", strip(happyHtml).includes("A is 80.00% of the portfolio"));
checkTrue("the tax position is a fact", strip(happyHtml).includes("₹25,000 used of ₹1,25,000"));
checkTrue("deliberately missing series are listed", strip(happyHtml).includes("India 10-year G-Sec yield — no keyless source."));

section("the six states");
check("loading: skeleton with status role", /role="status"[^>]*aria-busy="true"/.test(render(h(SignalsLoading))), true);
const errorHtml = render(h(SignalsError, { error: Object.assign(new Error("x"), { digest: "d1" }), retry: () => undefined }));
checkTrue("error: names the read, offers Retry, references the digest", errorHtml.includes("Your signals could not be read") && errorHtml.includes("Retry") && errorHtml.includes("d1"));
checkTrue("empty: no holdings says so and the other panels still render", views[1]!.includes("No holdings recorded yet") && views[1]!.includes("Macro levels") && views[1]!.includes("Tax position"));
checkTrue("unknown: em-dash with reason, never ₹0", views[1]!.includes("—") && views[1]!.includes("Tax settings for FY 2026-27 are not stored") && !strip(views[1]!).includes("₹0"));
checkTrue("refused: drawdown and band refusals are shown by cause", views[2]!.includes("Too few past drawdowns") && views[3]!.includes("Band standing refused"));
const staleHtml = render(h(SignalsScreen, { view: { ...happy, allocation: staleStanding, drawdown: drawdownView({ state: "MEASURED", episodes: { ...episodes, stale: true } }) } }));
checkTrue("stale: amber banners, values kept", (staleHtml.match(/data-tone="warning"/g) ?? []).length >= 2 && staleHtml.includes("Deeper than 71%"));

done();
