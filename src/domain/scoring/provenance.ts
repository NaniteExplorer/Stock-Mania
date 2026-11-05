/**
 * Where a scoring threshold comes from (tasks 3.3–3.5, 3.10).
 *
 * Product §5: no invented empirical defaults. Every number the scoring code
 * compares against is a `Threshold`: the value, and either a `Citation` from the
 * indicator registry or an explicit **owner-set** decision. An owner-set value
 * that the owner has not yet confirmed says so (`confirmed: false`), so the UI and
 * the plan can list it as an open owner item instead of presenting it as settled.
 */

import type { Citation } from "./indicators";

export type Provenance =
  | { readonly kind: "CITED"; readonly citation: Citation }
  | { readonly kind: "OWNER_SET"; readonly decision: string; readonly confirmed: boolean };

export interface Threshold<Value> {
  readonly value: Value;
  readonly provenance: Provenance;
}

export function threshold<Value>(value: Value, provenance: Provenance): Threshold<Value> {
  const texts = Object.values(provenance).filter((field): field is string => typeof field === "string");
  if (texts.some((text) => !text.trim())) throw new RangeError("A threshold's provenance must have every text field filled.");
  return Object.freeze({ value, provenance: Object.freeze({ ...provenance }) });
}

/** Owner-set values still awaiting the owner's confirmation; the plan lists these as owner items. */
export function pendingOwnerDecisions(thresholds: readonly Threshold<unknown>[]): readonly string[] {
  return thresholds.flatMap((item) =>
    "confirmed" in item.provenance && !item.provenance.confirmed ? [item.provenance.decision] : [],
  );
}
