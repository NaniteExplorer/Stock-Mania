/**
 * Net worth against age (DESIGN §8.1, tasks 4.2.s / 4.2.b): the pure view model
 * and the rendered panel. Made-up figures only.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import type { NetWorthPoint } from "@/domain/reports";
import {
  BREAK_NOT_JOINED, BREAK_SPLICED_PREFIX, buildNetWorthAgeView, DOB_PROMPT, EMPTY_REASON, historyFromSeries, LATEST_UNKNOWN,
  NO_CPI, SEGMENT_LABELS, viewCopy, type CpiMonth, type CpiSeries, type ExpenseMonth, type NetWorthAgeInputs, type NetWorthAgeView,
  type NetWorthMonth,
} from "../app/(root)/dashboard/net-worth-age-model";
import { NetWorthAgeError, NetWorthAgeLoading, NetWorthAgePanel } from "../app/(root)/dashboard/net-worth-age-view";
import { check, checkTrue, done, section } from "./harness";

const inr = (v: string) => Money.fromRupees(v);
const strip = (html: string) => html.replace(/<[^>]*>/g, " ");
const monthKey = (start: string, offset: number) => CalendarDate.parse(`${start}-01`).plusMonths(offset).toMonthKey();

/** Month ends from `start`, one per value; null is a month with no figure. */
function months(start: string, values: readonly (string | null)[]): NetWorthMonth[] {
  return values.map((v, i) => {
    const month = monthKey(start, i);
    return { month, on: CalendarDate.parse(`${month}-01`).endOfMonth(), netWorth: v === null ? null : inr(v) };
  });
}
function expenses(start: string, count: number, each: string): ExpenseMonth[] {
  return Array.from({ length: count }, (_, i) => ({ month: monthKey(start, i), expense: inr(each) }));
}
/** CPI rows for a run of months, on the base each month belongs to. */
function cpiRows(start: string, indices: readonly string[]): CpiMonth[] {
  return indices.map((index, i) => {
    const month = monthKey(start, i);
    return { month, base: month < "2026-01" ? "2012" : "2024", index };
  });
}

const TODAY = CalendarDate.parse("2026-10-30");
const BORN = CalendarDate.parse("1996-04-15");
// Mar 2026 → Oct 2026, no break inside.
const calm = months("2026-03", ["1000000", "1050000", "1100000", "1150000", "1200000", "1250000", "1300000", "1350000"]);
const base: NetWorthAgeInputs = { history: calm, expenses: expenses("2025-11", 12, "10000"), bornOn: BORN, today: TODAY, cpi: null, requested: "real" };
const ready = (v: NetWorthAgeView) => {
  if (v.kind === "empty") throw new Error("expected a drawn view");
  return v;
};
const renderPanel = (view: NetWorthAgeView) => render(h(NetWorthAgePanel, { view }));

section("history starts at the first recorded month, not the series' leading zeros");
const zero = Money.zero();
const point = (on: string, a: string, l: string): NetWorthPoint => ({ on: CalendarDate.parse(on), assets: inr(a), liabilities: inr(l), netWorth: inr(a).minus(inr(l)) });
const trimmed = historyFromSeries([point("2026-01-31", "0", "0"), point("2026-02-28", "0", "0"), point("2026-03-31", "500", "0"), point("2026-04-30", "0", "0")]);
check("leading empty months dropped", trimmed.length, 2);
check("starts at the first recorded month", trimmed[0]!.month, "2026-03");
check("a later zero month is kept", trimmed[1]!.netWorth!.toString(), zero.toString());
check("nothing recorded: no history", historyFromSeries([point("2026-01-31", "0", "0")]).length, 0);

section("no CPI series: real is unknown with a reason, nominal is drawn, no rate invented");
const noCpi = ready(buildNetWorthAgeView(base));
check("basis falls back to nominal", noCpi.basis, "nominal");
check("real refusal is named", noCpi.realRefusal, NO_CPI);
checkTrue("summary says real is unknown", noCpi.summary.includes("Real values are unknown"));
check("headline is the nominal latest", noCpi.headline, "₹13.50L");
check("basis label", noCpi.basisLabel, "In rupees of each month");
check("table carries no second (nominal) column", noCpi.table[0]!.nominal, null);
const noCpiHtml = renderPanel(noCpi);
checkTrue("Real toggle rendered disabled", /aria-disabled="true"[^>]*>Real</.test(noCpiHtml));
checkTrue("refusal banner rendered", strip(noCpiHtml).includes("no CPI Urban series is recorded"));
checkTrue("no inflation percentage on screen", !/\d+(\.\d+)?\s*%\s*(inflation|a year)/i.test(strip(noCpiHtml)));

section("axis: age with a date of birth, calendar years without — never a refusal");
check("age axis", noCpi.axis, "age");
check("no date-of-birth prompt", noCpi.dobPrompt, null);
checkTrue("summary speaks in ages", noCpi.summary.includes("at age 29") && noCpi.summary.includes("at age 30"));
checkTrue("age ticks are whole years", noCpi.chart.xTicks.every((t) => /^\d+$/.test(t.label)));
const noDob = ready(buildNetWorthAgeView({ ...base, bornOn: null }));
check("calendar axis", noDob.axis, "calendar");
check("kind still drawn", noDob.kind, "ready");
check("date-of-birth prompt", noDob.dobPrompt, DOB_PROMPT);
checkTrue("summary speaks in months", noDob.summary.includes("in Mar 2026") && noDob.summary.includes("in Oct 2026"));
checkTrue("prompt links to Settings", renderPanel(noDob).includes('href="/settings"'));
const longNoDob = ready(buildNetWorthAgeView({ ...base, bornOn: null, history: months("2023-01", Array.from({ length: 46 }, (_, i) => String(500000 + i * 10000))) }));
checkTrue("calendar ticks are years", longNoDob.chart.xTicks.map((t) => t.label).join(",") === "2024,2025,2026");

section("CPI without an official linking factor: two segments, marked, not joined");
// 2025-07 … 2026-10 straddles the January 2026 rebase.
const straddle = months("2025-07", Array.from({ length: 16 }, () => "1000000"));
const unlinked: CpiSeries = {
  linking: null,
  months: [...cpiRows("2025-07", ["200", "200", "200", "200", "200", "210"]), ...cpiRows("2026-01", ["100", "100", "100", "100", "100", "100", "100", "100", "105"])],
};
const split = ready(buildNetWorthAgeView({ ...base, history: straddle, cpi: unlinked, expenses: expenses("2025-11", 12, "10000") }));
check("basis real by default", split.basis, "real");
check("two line segments", split.chart.lines.length, 2);
check("break mark", split.chart.breakMark?.label, BREAK_NOT_JOINED);
checkTrue("segment labels name each base", split.chart.segmentLabels.map((s) => s.text).join("|") === SEGMENT_LABELS.join("|"));
checkTrue("summary: not joined", split.summary.includes("CPI rebased in Jan 2026 and is not joined."));
// Jul 2025 in Dec 2025 (2012-base) rupees: 10,00,000 × 210 / 200.
check("pre-break value in its own base's rupees", split.table[0]!.value, "₹10.50L");
check("nominal shown beside real", split.table[0]!.nominal, "₹10.00L");
// Sep 2026 is the latest 2024-base CPI month; Oct 2026 is carried at its prices.
check("post-break value in the latest CPI month's rupees", split.table[8]!.value, "₹10.50L");
check("month after the latest CPI is at its prices", split.table[15]!.value, "₹10.00L");
checkTrue("milestones refused across the unjoined break", split.milestoneNote !== null && split.milestoneNote.includes("straddle"));
checkTrue("focus stop shows nominal beside real", split.chart.points[0]!.label.includes("(nominal ₹10.00L)"));

section("CPI with an official linking factor: one spliced line");
const linked: CpiSeries = { ...unlinked, linking: { factor: "0.5000", source: "https://mospi.gov.in/example", recordedOn: "2026-10-01" } };
const spliced = ready(buildNetWorthAgeView({ ...base, history: straddle, cpi: linked }));
check("one line", spliced.chart.lines.length, 1);
checkTrue("break mark names the factor", spliced.chart.breakMark?.label === `${BREAK_SPLICED_PREFIX} 0.5000`);
check("no segment labels", spliced.chart.segmentLabels.length, 0);
checkTrue("source is shown", spliced.spliceSource !== null && spliced.spliceSource.includes("mospi.gov.in"));
// Jul 2025: 200 × 0.5 = 100 on the 2024 base; reference Sep 2026 = 105 → 10.5L.
check("pre-break value carried through the factor", spliced.table[0]!.value, "₹10.50L");
checkTrue("summary: spliced", spliced.summary.includes("spliced with MoSPI's linking factor"));

section("nominal mode still draws the break mark, and one continuous line");
const nominal = ready(buildNetWorthAgeView({ ...base, history: straddle, cpi: unlinked, requested: "nominal" }));
check("basis", nominal.basis, "nominal");
check("one line", nominal.chart.lines.length, 1);
check("break mark", nominal.chart.breakMark?.label, BREAK_NOT_JOINED);
check("real is available", nominal.realRefusal, null);
checkTrue("Real toggle is a link", renderPanel(nominal).includes('href="/dashboard?basis=real"'));

section("refused real: a needed CPI month is missing, or the series is too old");
const holed: CpiSeries = { linking: null, months: unlinked.months.filter((m) => m.month !== "2026-04") };
const missing = ready(buildNetWorthAgeView({ ...base, history: straddle, cpi: holed }));
check("falls back to nominal", missing.basis, "nominal");
checkTrue("names the missing month", missing.realRefusal !== null && missing.realRefusal.includes("Apr 2026"));
const old: CpiSeries = { linking: null, months: cpiRows("2026-01", ["100", "100", "100"]) };
const tooOld = ready(buildNetWorthAgeView({ ...base, cpi: old, expenses: expenses("2026-01", 10, "10000") }));
checkTrue("names the stale CPI", tooOld.realRefusal !== null && tooOld.realRefusal.includes("ends at Mar 2026"));
const badFactor = ready(buildNetWorthAgeView({ ...base, history: straddle, cpi: { ...unlinked, linking: { factor: "about one", source: "x", recordedOn: "2026-10-01" } } }));
checkTrue("an unreadable factor refuses real, never estimated", badFactor.realRefusal !== null && badFactor.basis === "nominal");

section("a missing month is a gap, never interpolated");
const gappy = ready(buildNetWorthAgeView({ ...base, history: months("2026-03", ["1000000", "1100000", null, "1300000", "1400000", "1500000", "1600000", "1700000"]) }));
check("two segments", gappy.chart.lines.length, 2);
check("gap focus stop", gappy.chart.points[2]!.label, "No snapshot for May 2026");
check("gap has no y", gappy.chart.points[2]!.y, null);
check("gap row is an em-dash", gappy.table[2]!.value, "—");
const lonely = ready(buildNetWorthAgeView({ ...base, history: months("2026-03", ["1000000", null, "1200000", null, "1300000", "1350000", "1400000", "1450000"]) }));
checkTrue("an isolated month gets its own dot", lonely.chart.points[2]!.isolated);

section("empty: under two months of history");
const empty = buildNetWorthAgeView({ ...base, history: months("2026-10", ["1000000"]) });
check("kind", empty.kind, "empty");
checkTrue("reason", empty.kind === "empty" && empty.reason === EMPTY_REASON);
const emptyHtml = renderPanel(empty);
checkTrue("empty state rendered with an action", emptyHtml.includes('data-state="empty"') && emptyHtml.includes('href="/imports"'));

section("unknown: the latest month's figure is missing, the line still runs to the last known month");
const unk = buildNetWorthAgeView({ ...base, history: months("2026-03", ["1000000", "1100000", "1200000", "1300000", "1400000", "1500000", "1600000", null]) });
check("kind", unk.kind, "unknown");
const unkReady = ready(unk);
check("headline unknown", unkReady.headline, null);
check("reason", unkReady.headlineReason, LATEST_UNKNOWN);
check("line still drawn", unkReady.chart.lines.length, 1);
const unkHtml = renderPanel(unk);
checkTrue("em-dash with its reason", unkHtml.includes("—") && strip(unkHtml).includes(LATEST_UNKNOWN.replace("'", "&#x27;")));

section("stale: the newest figure is over 45 days old");
const stale = ready(buildNetWorthAgeView({ ...base, history: months("2026-01", ["1000000", "1100000", "1200000", "1300000", "1400000", "1500000", "1600000", "1700000"]) }));
check("kind", stale.kind, "stale");
checkTrue("reason names the month", stale.staleReason !== null && stale.staleReason.includes("Aug 2026"));
checkTrue("stale state rendered with the chart", renderPanel(stale).includes('data-state="stale"') && renderPanel(stale).includes("<path"));
check("current month is not stale", noCpi.kind, "ready");

section("loading and error states");
checkTrue("loading", render(h(NetWorthAgeLoading)).includes('data-state="loading"'));
const errorHtml = render(h(NetWorthAgeError, { reason: "Net worth history could not be read just now." }));
checkTrue("error with retry", errorHtml.includes('data-state="error"') && errorHtml.includes('href="/dashboard"'));

section("milestones: expense multiples only — 33× cited, never 25×, never income");
// 12 months at ₹10,000 → ₹1.2L a year: 10× = 12L, 20× = 24L, 33× = 39.6L.
const ms = ready(buildNetWorthAgeView(base));
const labels = ms.chart.milestones.map((m) => m.label);
checkTrue("10× drawn", labels.some((l) => l.startsWith("10× expenses")));
checkTrue("20× and 33× are above the scale and listed", ms.milestoneNote !== null && ms.milestoneNote.includes("20× expenses") && ms.milestoneNote.includes("33× expenses"));
checkTrue("33× cited", ms.citation !== null && ms.citation.includes("Saraogi 2022") && ms.citation.includes("33×"));
checkTrue("crossing named in the summary", ms.summary.includes("crossed 10× expenses at 30"));
const richer = ready(buildNetWorthAgeView({ ...base, history: months("2026-03", ["3000000", "3200000", "3400000", "3600000", "3800000", "4000000", "4200000", "4400000"]) }));
checkTrue("33× rule drawn when on scale", richer.chart.milestones.some((m) => m.label.startsWith("33× expenses — independence marker") && m.emphasis === "primary"));
check("10× and 20× quieter", richer.chart.milestones.filter((m) => m.emphasis === "quiet").length, 2);
for (const view of [noCpi, noDob, split, spliced, nominal, missing, gappy, unkReady, stale, ms, richer]) {
  const copy = viewCopy(view).join(" ") + strip(renderPanel(view));
  checkTrue(`no 25× (${view.summary.slice(0, 32)}…)`, !/25\s*×/.test(copy));
  checkTrue(`no income multiple (${view.summary.slice(0, 32)}…)`, !/×\s*(annual\s*)?income/i.test(copy));
}
const short = ready(buildNetWorthAgeView({ ...base, expenses: [...expenses("2025-11", 4, "0"), ...expenses("2026-03", 8, "10000")] }));
check("under twelve months: no rules", short.chart.milestones.length, 0);
checkTrue("refused overlay names why", short.milestoneNote !== null && short.milestoneNote.includes("Needs twelve months of expenses; 8 recorded"));
check("chart itself still drawn", short.kind, "ready");

section("negative net worth draws zero as a rule");
const negative = ready(buildNetWorthAgeView({ ...base, history: months("2026-03", ["-200000", "-100000", "0", "100000", "200000", "300000", "400000", "500000"]) }));
checkTrue("zero rule present", negative.chart.zeroY !== null);
check("non-negative history has none", noCpi.chart.zeroY, null);
checkTrue("negative figures use U+2212", negative.table[0]!.value.startsWith("−"));

section("geometry stays inside the drawing");
for (const view of [noCpi, split, gappy, richer, negative]) {
  const { plot } = view.chart;
  checkTrue(`points within the plot (${view.summary.slice(0, 24)}…)`, view.chart.points.every((p) => p.x >= plot.left && p.x <= plot.right && (p.y === null || (p.y >= plot.top && p.y <= plot.bottom))));
}

done();
