import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server.browser";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Count, Ratio, Years } from "@/core/units";
import { AssumptionSet } from "@/domain/projection/assumptions";
import type { AnnualReturns } from "@/domain/projection/bootstrap";
import {
  buildProjectionView, CORPUS_UNKNOWN, NO_RETURNS, NO_SAVED_ASSUMPTIONS, NO_TARGET, NOT_MEASURED, PATH_COUNT,
  SCENARIO_CAVEAT, viewCopy, type ProjectionInputs, type ProjectionView,
} from "../app/(root)/projection/projection-model";
import { ProjectionScreen } from "../app/(root)/projection/projection-view";
import { check, checkTrue, done, section } from "./harness";

// Made-up figures only.
const inr = (v: string) => Money.fromRupees(v);
const strip = (html: string) => html.replace(/<[^>]*>/g, " ");
const FORBIDDEN = /(\d\s*%\s*(likely|likelihood|probab|chance))|((likely|likelihood|probab|chance)\w*\s*(of\s*)?\d+\s*%)|probability|likelihood|\bchance\b/i;
const checkCopy = (label: string, view: ProjectionView) => {
  const html = strip(render(h(ProjectionScreen, { view })));
  checkTrue(`${label}: no probability wording in rendered page`, !FORBIDDEN.test(html));
  checkTrue(`${label}: no probability wording in model copy`, viewCopy(view).every((s) => !FORBIDDEN.test(s)));
  return html;
};

const series: AnnualReturns[] = Array.from({ length: 20 }, (_, i) => ({
  year: Count(2000 + i), equity: Ratio([0.3, -0.2, 0.15, 0.05, 0.4][i % 5]!), debt: Ratio(0.07), inflation: Ratio(0.05),
}));
const day = CalendarDate.parse("2026-10-01");
const filled = AssumptionSet.initial()
  .with("currentAge", Years(30)).with("retirementAge", Years(60)).with("horizonAge", Years(90))
  .with("inflation", Ratio(0.06)).with("monthlyContribution", inr("20000")).with("equityShare", Ratio(0.6))
  .with("npsAnnuityShareNonGovt", Ratio(0.2), undefined, day).with("npsAnnuityShareGovt", Ratio(0.4), undefined, day);
const ready: ProjectionInputs = {
  assumptions: filled, assumptionsSaved: true,
  gate: { historyMonths: Count(24), categorisedShare: Ratio(0.95), minimumCoverage: Ratio(0.8), unresolvedHoldings: [], holdsNps: false },
  hasInvestments: true, startWealth: inr("1000000"), returns: series,
  target: { amount: inr("20000000"), age: Years(60), basis: "33× expenses at 60" }, assumptionsChanged: false,
};

section("refused: the page's own inputs name every blocker");
const pageView = buildProjectionView({ ...ready, assumptions: AssumptionSet.initial(), assumptionsSaved: false, gate: null, startWealth: null, returns: [], target: null });
check("kind", pageView.kind, "refused");
if (pageView.kind === "refused") {
  for (const reason of [NO_SAVED_ASSUMPTIONS, NOT_MEASURED, CORPUS_UNKNOWN, NO_RETURNS, NO_TARGET, "Current age is not set.", "Inflation is not set."]) {
    checkTrue(`names: ${reason}`, pageView.reasons.includes(reason));
  }
}
checkCopy("refused", pageView);
checkTrue("refused draws no fan", !render(h(ProjectionScreen, { view: pageView })).includes("projection-outer-fade"));

section("refused: gate reasons pass through by name");
const thin = buildProjectionView({ ...ready, gate: { ...ready.gate!, historyMonths: Count(6), unresolvedHoldings: ["Example Fund"] } });
check("kind", thin.kind, "refused");
checkTrue("history named", thin.kind === "refused" && thin.reasons.some((r) => r.includes("12 months")));
checkTrue("holding named", thin.kind === "refused" && thin.reasons.includes("Example Fund has no asset class yet."));
checkCopy("gate refusal", thin);

section("empty");
const empty = buildProjectionView({ ...ready, hasInvestments: false });
check("kind", empty.kind, "empty");
checkCopy("empty", empty);

section("ready: fan, headline, caveat");
const view = buildProjectionView(ready);
check("kind", view.kind, "ready");
if (view.kind === "ready") {
  checkTrue("headline is a count with the real denominator", view.headline.includes(`of ${PATH_COUNT} scenarios replayed`));
  check("caveat", view.caveat, SCENARIO_CAVEAT);
  checkTrue("summary names the middle half", view.summary.startsWith("Real corpus at 60: middle half of scenarios between"));
  const markup = render(h(ProjectionScreen, { view }));
  checkTrue("svg drawn", markup.includes("<svg"));
  checkTrue("outer band filled by fading gradient", markup.includes('fill="url(#projection-outer-fade)"'));
  checkTrue("gradient fades to transparent at the edge", markup.includes('offset="0" stop-color="var(--c1)" stop-opacity="0"') || markup.includes('stop-opacity="0"'));
  checkTrue("headline rendered", strip(markup).includes(view.headline));
  checkTrue("caveat rendered", strip(markup).includes(SCENARIO_CAVEAT));
  checkTrue("band labels", ["half of scenarios", "8 in 10", "9 in 10 — and beyond"].every((t) => markup.includes(t)));
  checkTrue("no % anywhere in ready copy", !strip(markup).includes("%"));
  checkCopy("ready", view);
  check("deterministic: same seed, same headline", (buildProjectionView(ready) as typeof view).headline, view.headline);
}

section("stale");
const stale = buildProjectionView({ ...ready, assumptionsChanged: true });
check("kind", stale.kind, "stale");
checkTrue("stale still draws, with Re-run reason", stale.kind === "stale" && stale.staleReason!.includes("Re-run") && render(h(ProjectionScreen, { view: stale })).includes("<svg"));
checkCopy("stale", stale);

section("the forbidden-wording detector itself");
checkTrue("catches '63% likely'", FORBIDDEN.test("63% likely"));
checkTrue("catches 'chance of 40%'", FORBIDDEN.test("a chance of 40%"));
checkTrue("allows a count", !FORBIDDEN.test("In 63 of 100 scenarios"));

done();
