/**
 * The projection's refusal gate (task 5.5).
 *
 * `PRODUCT-REQUIREMENT.md` §6: under twelve months of history, thin categorisation
 * coverage, an unresolved asset mix, or an unverified required assumption
 * produces **a refusal naming the cause — never a quietly smaller number**. Every
 * cause is listed at once, so the owner fixes them in one pass instead of
 * meeting them one by one.
 *
 * The coverage threshold is the caller's: the product names none, and inventing
 * one here would be a default nobody chose.
 */

import { Count, type Ratio } from "@/core/units";
import type { AssumptionSet } from "./assumptions";

export const MINIMUM_HISTORY_MONTHS: Count = Count(12);

export interface GateInputs {
  /** Whole months of recorded expenses. */
  readonly historyMonths: Count;
  /** Share of spending that carries a category, or null when it cannot be measured. */
  readonly categorisedShare: Ratio | null;
  readonly minimumCoverage: Ratio;
  /** Holdings whose asset class (equity / debt / other) is not yet known, by name. */
  readonly unresolvedHoldings: readonly string[];
  readonly holdsNps: boolean;
}

export type GateResult =
  | { readonly state: "ready" }
  | { readonly state: "refused"; readonly reasons: readonly string[] };

export function projectionGate(inputs: GateInputs, assumptions: AssumptionSet): GateResult {
  const reasons: string[] = [];
  if (inputs.historyMonths < MINIMUM_HISTORY_MONTHS) {
    reasons.push(`Needs ${MINIMUM_HISTORY_MONTHS} months of history; ${inputs.historyMonths} recorded so far.`);
  }
  if (inputs.categorisedShare === null) {
    reasons.push("Categorisation coverage cannot be measured yet.");
  } else if (inputs.categorisedShare < inputs.minimumCoverage) {
    reasons.push(
      `Only ${Math.floor(inputs.categorisedShare * 100)}% of spending is categorised; ` +
        `the projection needs at least ${Math.ceil(inputs.minimumCoverage * 100)}%.`,
    );
  }
  for (const holding of inputs.unresolvedHoldings) reasons.push(`${holding} has no asset class yet.`);
  reasons.push(...assumptions.blockers({ holdsNps: inputs.holdsNps }));

  return reasons.length === 0
    ? Object.freeze({ state: "ready" })
    : Object.freeze({ state: "refused", reasons: Object.freeze(reasons) });
}
