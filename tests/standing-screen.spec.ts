import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { CalendarDate } from "@/core/time";
import { Count, Months, Ratio } from "@/core/units";
import type { Measurement } from "@/domain/scoring/composite";
import { scoreCard } from "@/domain/scoring/score-card";
import { buildStandingView, revealSentence, unwiredMeasurements, PILLAR_LABEL } from "../app/(root)/standing/standing-model";
import { StandingEmpty, StandingScreen } from "../app/(root)/standing/standing-view";
import { check, checkTrue, done, section } from "./harness";

// Made-up figures only.
const today = CalendarDate.parse("2026-10-30");
const strip = (html: string) => html.replace(/<[^>]*>/g, " ");
const CELEBRATORY = /congrat|great|well done|awesome|keep it up|nice|amazing|don.t worry|unfortunately|!|🎉/i;

const full = (): Map<string, Measurement> => new Map<string, Measurement>([
  ["runway-months", { state: "measured", value: Months(6) }],
  ["savings-rate", { state: "measured", value: Ratio(0.2) }],
  ["debt-service-ratio", { state: "measured", value: Ratio(0.1) }],
  ["foir-ceiling", { state: "measured", value: Ratio(0.3) }],
  ["income-stability", { state: "measured", value: Ratio(0.9) }],
  ["health-cover-present", { state: "measured", value: Count(1) }],
  ["term-cover-present", { state: "not-applicable", reason: "Nobody depends on this income." }],
  ["independence-multiple", { state: "measured", value: Count(5) }],
]);
const facts = { healthCover: "covered" as const, foir: null };

section("unwired: refusal names every unmeasured pillar");
{
  const m = unwiredMeasurements();
  const view = buildStandingView({ card: scoreCard(m, facts, null), measurements: m, previous: null, oldestInput: null, today });
  check("refused", view.composite.state, "refused");
  if (view.composite.state === "refused") {
    for (const label of Object.values(PILLAR_LABEL)) checkTrue(`names ${label}`, view.composite.missing.includes(label));
    checkTrue("reason names missing", view.composite.reason.includes("Missing"));
  }
  check("coverage always shown", view.coverage, "0%");
  checkTrue("range is an unknown with a reason", typeof view.range !== "string" && view.range.reason.length > 0);
  checkTrue("every indicator unknown, none zero", view.indicators.every((r) => r.state === "unknown" && typeof r.score !== "string"));
  const html = render(h(StandingScreen, { view }));
  checkTrue("em-dash is focusable", html.includes('tabindex="0"') && html.includes("—"));
  checkTrue("no points-to-next or tier guess rendered", !strip(html).includes("points to") && !strip(html).includes("which tier"));
  checkTrue("refusal text rendered", strip(html).includes("The composite is not computed"));
}

section("partial: one pillar unknown refuses and names only it");
{
  const m = full(); m.delete("independence-multiple");
  const view = buildStandingView({ card: scoreCard(m, facts, null), measurements: m, previous: null, oldestInput: null, today });
  check("refused", view.composite.state, "refused");
  if (view.composite.state === "refused") check("missing", view.composite.missing.join(","), "Retirement funding");
  checkTrue("coverage < 100", view.coverage !== "100%");
}

section("scored: guess first, coverage and range always shown");
{
  const m = full();
  const view = buildStandingView({ card: scoreCard(m, facts, null), measurements: m, previous: null, oldestInput: null, today });
  check("scored", view.composite.state, "scored");
  check("coverage", view.coverage, "100%");
  checkTrue("range is a figure", typeof view.range === "string" && view.range.includes("–"));
  check("guess options are placeholders", view.guessOptions.map((o) => o.label).join(","), "Tier 1,Tier 2,Tier 3");
  const html = strip(render(h(StandingScreen, { view })));
  checkTrue("guess prompt shown before score", html.includes("which tier do you think"));
  checkTrue("score hidden before guess", view.composite.state === "scored" && !html.includes(`Composite ${view.composite.hero}`));
  checkTrue("declared not-applicable row", view.indicators.some((r) => r.state === "not-applicable"));
}

section("demotion: plain sentence, never celebratory");
{
  const m = full(); m.set("runway-months", { state: "measured", value: Months(0.5) }); m.set("savings-rate", { state: "measured", value: Ratio(0.02) });
  const card = scoreCard(m, facts, "UPPER");
  const view = buildStandingView({ card, measurements: m, previous: "UPPER", oldestInput: null, today });
  checkTrue("change reported", view.change !== null && view.change.startsWith("Tier moved from Tier 3"));
  checkTrue("no celebratory wording on demotion", !CELEBRATORY.test(view.change ?? "") && view.composite.state === "scored" && !CELEBRATORY.test(view.composite.next));
  for (const [g, a] of [["UPPER", "LOWER"], ["LOWER", "LOWER"], ["LOWER", "UPPER"]] as const) checkTrue(`reveal ${g}/${a} neutral`, !CELEBRATORY.test(revealSentence(g, a)));
}

section("ceiling replaces points-to-next");
{
  const m = full(); m.set("foir-ceiling", { state: "measured", value: Ratio(0.6) });
  const view = buildStandingView({ card: scoreCard(m, { healthCover: "covered", foir: Ratio(0.6) }, null), measurements: m, previous: null, oldestInput: null, today });
  checkTrue("ceiling reason shown", view.composite.state === "scored" && view.composite.next.includes("Fixed obligations"));
}

section("QA repair 2026-11-03: guess first gates the tier; pending margin, thresholds, axis and limitations shown");
{
  const m = full();
  const view = buildStandingView({ card: scoreCard(m, facts, null), measurements: m, previous: null, oldestInput: null, today, limitations: ["Runway counts spendable cash in INR only. Cash held in another currency is left out, not converted."] });
  const html = strip(render(h(StandingScreen, { view })));
  checkTrue("before the guess: no points-to-next, no range, no tier rules", !html.includes("points to") && !html.includes("This is the top tier") && !html.includes("Tier rules"));
  checkTrue("before the guess: the tier's KPI detail is not rendered", view.composite.state === "scored" && !html.includes(`Composite ${view.composite.hero}`));
  checkTrue("no pending banner once the margin is confirmed", !html.includes("Pending owner decision, not confirmed"));
  check("no pending item", view.pending.length, 0);
  const margin = view.thresholds.find((row) => row.id === "demotion-margin");
  checkTrue("the margin row is labelled owner-confirmed", margin?.status === "owner-confirmed" && margin.source.startsWith("Owner decision, confirmed"));
  check("tier floors are cited", view.thresholds.filter((row) => row.status === "cited").length, 3);
  const axis = view.axes.find((a) => a.label.startsWith("10×"));
  checkTrue("10x-vs-15x is pending a decision, unscored", axis?.status === "pending-decision" && typeof axis.range !== "string" && axis.range.reason.includes("unscored"));
  checkTrue("the overall range says what it could not include", view.rangeDetail.includes("pending a decision, unscored") && view.rangeDetail.includes("10×"));

  const refusedView = buildStandingView({ card: scoreCard(unwiredMeasurements(), facts, null), measurements: unwiredMeasurements(), previous: null, oldestInput: null, today, limitations: view.limitations });
  const refused = strip(render(h(StandingScreen, { view: refusedView })));
  checkTrue("refused screen shows the tier rules with the confirmed margin", refused.includes("Tier rules") && refused.includes("Owner decision — confirmed"));
  checkTrue("refused screen states the foreign-cash limitation", refused.includes("another currency") && refused.includes("not converted"));
  checkTrue("refused screen shows 10x-vs-15x as pending, unscored", refused.includes("Pending owner decision — unscored"));
}

section("held by the margin");
{
  // Made-up: every pillar full except savings at 0.25, so the composite is 0.25^(1/6) ≈ 0.794, with UPPER held last time.
  const m = full();
  m.set("savings-rate", { state: "measured", value: Ratio(0.25) });
  m.set("income-stability", { state: "measured", value: Ratio(1) });
  m.set("independence-multiple", { state: "measured", value: Count(33) });
  const card = scoreCard(m, facts, "UPPER");
  const view = buildStandingView({ card, measurements: m, previous: "UPPER", oldestInput: null, today });
  const score = card.composite.state === "scored" ? card.composite.score : 0;
  checkTrue("fixture sits inside the margin below Tier 3", score < 0.8 && score >= 0.77);
  checkTrue("held sentence names the confirmed margin", view.composite.state === "scored" && view.composite.held !== null && view.composite.held.includes("owner-confirmed"));
  checkTrue("no celebratory wording", view.composite.state === "scored" && !CELEBRATORY.test(view.composite.held ?? ""));
  check("the tier shown is the held one", view.composite.state === "scored" ? view.composite.tier : null, "UPPER");
  const fresh = buildStandingView({ card: scoreCard(m, facts, null), measurements: m, previous: null, oldestInput: null, today });
  check("with no previous tier nothing is held", fresh.composite.state === "scored" ? fresh.composite.held : "refused", null);
}

section("stale and empty");
{
  const m = full();
  const card = scoreCard(m, facts, null);
  const stale = buildStandingView({ card, measurements: m, previous: null, oldestInput: { name: "Runway", on: CalendarDate.parse("2026-08-01") }, today });
  checkTrue("stale names the input", stale.stale !== null && stale.stale.startsWith("Runway"));
  const fresh = buildStandingView({ card, measurements: m, previous: null, oldestInput: { name: "Runway", on: CalendarDate.parse("2026-10-01") }, today });
  check("fresh not stale", fresh.stale, null);
  checkTrue("empty says how to start", strip(render(h(StandingEmpty))).includes("Add accounts and statements"));
}

done();
