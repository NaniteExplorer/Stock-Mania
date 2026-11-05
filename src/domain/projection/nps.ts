/**
 * NPS at exit (task 5.6): **a full NPS corpus is never treated as spendable.**
 *
 * At exit a minimum share must buy an annuity — 20% for non-government and 40% for
 * government subscribers, per TASKS 5.6. The shares come from the 5.0 assumption
 * set and must be verified there: a statutory share copied into code is a claim
 * nobody re-checks, so an unverified one refuses.
 *
 * Rounding favours the owner's caution: the annuitised part is rounded **up**, so
 * the spendable part is never overstated by a paisa, and the two always sum to
 * the corpus exactly.
 */

import type { Money } from "@/core/money";
import type { Ratio } from "@/core/units";
import type { AssumptionSet } from "./assumptions";

export type NpsSector = "GOVERNMENT" | "NON_GOVERNMENT";

export interface NpsExit {
  readonly corpus: Money;
  readonly share: Ratio;
  /** Must buy an annuity: income later, never a lump sum. */
  readonly annuitised: Money;
  /** What may be withdrawn and counted towards spendable wealth. */
  readonly spendable: Money;
}

/**
 * The share exactly as stated: the shortest decimal that names the number
 * (`String(0.2000004)` is "0.2000004"), as an exact numerator over a power of ten.
 * No fixed-decimal quantisation, so a stated share is honoured to its last digit.
 */
export function statedShare(share: Ratio): { readonly numerator: bigint; readonly denominator: bigint } {
  if (!(share >= 0 && share <= 1)) throw new RangeError(`An annuity share of ${share} is outside 0 to 1.`);
  const [mantissa, exponentText] = String(share).toLowerCase().split("e");
  const [whole, fraction = ""] = mantissa!.split(".");
  let scale = fraction.length - Number(exponentText ?? "0");
  let numerator = BigInt(whole! + fraction);
  if (scale < 0) {
    numerator *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return Object.freeze({ numerator, denominator: 10n ** BigInt(scale) });
}

export function npsAtExit(corpus: Money, sector: NpsSector, assumptions: AssumptionSet): NpsExit {
  const key = sector === "GOVERNMENT" ? "npsAnnuityShareGovt" : "npsAnnuityShareNonGovt";
  const assumption = assumptions.get(key);
  if (assumption.value === null) throw new RangeError(`${assumption.label} is not set.`);
  if (assumption.verifiedOn === null) {
    throw new RangeError(`${assumption.label} has not been verified against its current source.`);
  }
  if (corpus.isNegative) throw new RangeError("An NPS corpus cannot be negative.");
  const share = assumption.value;
  const exact = statedShare(share);
  // Rounded UP once, on the final money division: spendable is never overstated.
  const annuitised = corpus.timesRatio(exact.numerator, exact.denominator, "UP");
  return Object.freeze({ corpus, share, annuitised, spendable: corpus.minus(annuitised) });
}
