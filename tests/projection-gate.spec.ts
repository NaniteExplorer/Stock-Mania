/** Task 5.5 acceptance: refuses, naming the cause; never silently substitutes a default. */
import { Money } from "@/core/money";
import { Count, Ratio, Years } from "@/core/units";
import { AssumptionSet } from "@/domain/projection/assumptions";
import { projectionGate, type GateInputs } from "@/domain/projection/gate";
import { check, checkDeep, done, section } from "./harness";

const complete = AssumptionSet.initial()
  .with("currentAge", Years(35))
  .with("retirementAge", Years(55))
  .with("horizonAge", Years(90))
  .with("inflation", Ratio(0.06))
  .with("monthlyContribution", Money.fromRupees("50000"))
  .with("equityShare", Ratio(0.7));
const good: GateInputs = { historyMonths: Count(24), categorisedShare: Ratio(0.95), minimumCoverage: Ratio(0.9), unresolvedHoldings: [], holdsNps: false };
const reasons = (inputs: GateInputs, set = complete) => {
  const r = projectionGate(inputs, set);
  return r.state === "refused" ? r.reasons : [];
};

section("ready only when everything is known");
check("complete inputs pass", projectionGate(good, complete).state, "ready");

section("each cause is named");
checkDeep("eleven months", reasons({ ...good, historyMonths: Count(11) }), ["Needs 12 months of history; 11 recorded so far."]);
checkDeep("thin coverage", reasons({ ...good, categorisedShare: Ratio(0.8) }), ["Only 80% of spending is categorised; the projection needs at least 90%."]);
checkDeep("unknown coverage is a refusal, not a pass", reasons({ ...good, categorisedShare: null }), ["Categorisation coverage cannot be measured yet."]);
checkDeep("each unresolved holding by name", reasons({ ...good, unresolvedHoldings: ["Unlisted startup shares", "Family gold"] }), ["Unlisted startup shares has no asset class yet.", "Family gold has no asset class yet."]);
check("assumption blockers are passed through", reasons(good, complete.with("inflation", null)).includes("Inflation is not set."), true);
check("NPS holders are refused until the shares are verified", reasons({ ...good, holdsNps: true }).filter((r) => r.includes("not been verified")).length, 2);

section("all causes at once, never a smaller number");
const many = reasons({ ...good, historyMonths: Count(3), categorisedShare: null, unresolvedHoldings: ["X"] }, AssumptionSet.initial());
check("history, coverage, holding and six assumptions together", many.length, 9);
const refused = projectionGate({ ...good, historyMonths: Count(3) }, complete);
checkDeep("a refusal carries reasons and no figure", Object.keys(refused).sort(), ["reasons", "state"]);
check("frozen", Object.isFrozen(refused) && (refused.state !== "refused" || Object.isFrozen(refused.reasons)), true);

done();
