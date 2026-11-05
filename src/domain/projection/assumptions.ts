/**
 * The projection's assumption set (task 5.0) — every input named, sourced and editable.
 *
 * `PRODUCT-REQUIREMENT.md` §6: the projection **refuses rather than guesses**. So
 * this file holds no invented empirical default. Inflation, ages, contribution and
 * the equity share start **null** — unknown — and stay null until the owner states
 * them or the ledger derives them. Only two values ship filled, each with its
 * citation: the India-calibrated 3.0% withdrawal rate, and the 3–5 year block
 * length of the bootstrap.
 *
 * Regulatory inputs (the NPS annuity shares) ship **unverified**. Rules change; a
 * share copied into code is a claim about today that nobody re-checks. Until a
 * verification date is recorded against the current PFRDA source, `blockers()`
 * names them and the refusal gate (5.5) refuses.
 *
 * Vendor-sourced values are allowed but flagged, so a screen can say whose number
 * it is showing.
 */

import type { Money } from "@/core/money";
import type { CalendarDate } from "@/core/time";
import { Count, Ratio, type Years } from "@/core/units";
import type { Citation } from "@/domain/scoring/indicators";

export type AssumptionSource =
  /** The owner typed it. */
  | { readonly kind: "OWNER" }
  | { readonly kind: "CITED"; readonly citation: Citation }
  /** A named vendor's figure, flagged wherever it is shown. */
  | { readonly kind: "VENDOR"; readonly vendor: string; readonly asOf: CalendarDate }
  /** Derived from the owner's own ledger, by a stated method. */
  | { readonly kind: "OWN_HISTORY"; readonly method: string };

export interface AssumptionValues {
  readonly currentAge: Years;
  readonly retirementAge: Years;
  /** The age the plan must last to. */
  readonly horizonAge: Years;
  /** Annual consumer inflation, as a fraction. */
  readonly inflation: Ratio;
  readonly withdrawalRate: Ratio;
  readonly monthlyContribution: Money;
  readonly equityShare: Ratio;
  /** Bootstrap block length. */
  readonly blockYears: Count;
  readonly npsAnnuityShareNonGovt: Ratio;
  readonly npsAnnuityShareGovt: Ratio;
}

export type AssumptionKey = keyof AssumptionValues;

export interface Assumption<K extends AssumptionKey = AssumptionKey> {
  readonly key: K;
  readonly label: string;
  /** Null is unknown. It is never read as zero, and never filled with a default. */
  readonly value: AssumptionValues[K] | null;
  readonly source: AssumptionSource | null;
  /** A rule that changes: needs a recorded verification before it may be used. */
  readonly regulatory: boolean;
  readonly verifiedOn: CalendarDate | null;
}

type Entries = { readonly [K in AssumptionKey]: Assumption<K> };

const SARAOGI: Citation = Object.freeze({
  kind: "PRIMARY",
  title: "Saraogi (2022), safe withdrawal rates calibrated on Indian markets, SSRN 4216077",
  url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4216077",
  published: "2022",
});
const BLOCK_CONVENTION: Citation = Object.freeze({
  kind: "CONVENTION",
  title: "Stationary block bootstrap with multi-year blocks, preserving serial dependence in annual returns",
  usedBy: "Politis & Romano (1994); retirement-sufficiency studies resampling annual returns",
});
const NPS_TASK: Citation = Object.freeze({
  kind: "CONVENTION",
  title: "NPS exit: minimum annuity share 20% (non-government) / 40% (government), as stated in TASKS 5.6",
  usedBy: "PFRDA exit and withdrawal regulations; must be verified against the current text",
});

const cited = (citation: Citation): AssumptionSource => Object.freeze({ kind: "CITED", citation });

function entry<K extends AssumptionKey>(
  key: K,
  label: string,
  value: AssumptionValues[K] | null,
  source: AssumptionSource | null,
  regulatory = false,
  verifiedOn: CalendarDate | null = null,
): Assumption<K> {
  return Object.freeze({ key, label, value, source, regulatory, verifiedOn });
}

/** Range checks per key; each throws with the label's own words. */
const VALIDATE: { readonly [K in AssumptionKey]: (value: AssumptionValues[K]) => void } = Object.freeze({
  currentAge: (v: Years) => between(v, 0, 120, "Current age"),
  retirementAge: (v: Years) => between(v, 0, 120, "Retirement age"),
  horizonAge: (v: Years) => between(v, 0, 120, "Plan-to age"),
  inflation: (v: Ratio) => between(v, -0.5, 1, "Inflation"),
  withdrawalRate: (v: Ratio) => {
    if (!(v > 0 && v <= 1)) throw new RangeError(`Withdrawal rate must be above 0 and at most 100%, got ${v}.`);
  },
  monthlyContribution: (v: Money) => {
    if (v.isNegative) throw new RangeError("A monthly contribution cannot be negative; a withdrawal is not a contribution.");
  },
  equityShare: (v: Ratio) => between(v, 0, 1, "Equity share"),
  blockYears: (v: Count) => between(v, 3, 5, "Block length"),
  npsAnnuityShareNonGovt: (v: Ratio) => between(v, 0, 1, "NPS annuity share (non-government)"),
  npsAnnuityShareGovt: (v: Ratio) => between(v, 0, 1, "NPS annuity share (government)"),
});

function between(value: number, low: number, high: number, label: string): void {
  if (!(value >= low && value <= high)) throw new RangeError(`${label} must be between ${low} and ${high}, got ${value}.`);
}

export class AssumptionSet {
  private constructor(private readonly entries: Entries) {
    Object.freeze(this);
  }

  /**
   * The starting set. Only cited values are filled; every empirical input is
   * unknown until stated. Regulatory values are present but unverified.
   */
  static initial(): AssumptionSet {
    return new AssumptionSet(
      Object.freeze({
        currentAge: entry("currentAge", "Current age", null, null),
        retirementAge: entry("retirementAge", "Retirement age", null, null),
        horizonAge: entry("horizonAge", "Plan to age", null, null),
        inflation: entry("inflation", "Inflation", null, null),
        withdrawalRate: entry("withdrawalRate", "Withdrawal rate", Ratio(0.03), cited(SARAOGI)),
        monthlyContribution: entry("monthlyContribution", "Monthly contribution", null, null),
        equityShare: entry("equityShare", "Equity share", null, null),
        blockYears: entry("blockYears", "Bootstrap block length", Count(4), cited(BLOCK_CONVENTION)),
        npsAnnuityShareNonGovt: entry("npsAnnuityShareNonGovt", "NPS annuity share (non-government)", Ratio(0.2), cited(NPS_TASK), true),
        npsAnnuityShareGovt: entry("npsAnnuityShareGovt", "NPS annuity share (government)", Ratio(0.4), cited(NPS_TASK), true),
      }),
    );
  }

  get<K extends AssumptionKey>(key: K): Assumption<K> {
    return this.entries[key] as Assumption<K>;
  }

  all(): readonly Assumption[] {
    return Object.freeze(Object.values(this.entries) as Assumption[]);
  }

  /**
   * A new set with one assumption changed. The value is range-checked, ages must
   * stay ordered, and a regulatory value keeps its verification only when the
   * caller passes one: an edit is not a verification.
   */
  with<K extends AssumptionKey>(
    key: K,
    value: AssumptionValues[K] | null,
    source: AssumptionSource = { kind: "OWNER" },
    verifiedOn: CalendarDate | null = null,
  ): AssumptionSet {
    if (value !== null) VALIDATE[key](value);
    if (source.kind === "VENDOR" && !source.vendor.trim()) throw new RangeError("A vendor-sourced value must name the vendor.");
    const current = this.entries[key];
    const next = new AssumptionSet(
      Object.freeze({
        ...this.entries,
        [key]: entry(key, current.label, value, value === null ? null : Object.freeze({ ...source }), current.regulatory, verifiedOn),
      }) as Entries,
    );
    next.checkAgesOrdered();
    return next;
  }

  /** Every required input that is unknown or unverified, by label: what the refusal gate names. */
  blockers(options: { readonly holdsNps: boolean }): readonly string[] {
    const reasons = this.all()
      .filter((a) => options.holdsNps || !a.key.startsWith("nps"))
      .flatMap((a) => {
        if (a.value === null) return [`${a.label} is not set.`];
        if (a.regulatory && a.verifiedOn === null) return [`${a.label} has not been verified against its current source.`];
        return [];
      });
    return Object.freeze(reasons);
  }

  /** Keys whose value came from a vendor: shown with the vendor's name, never unmarked. */
  vendorFlagged(): readonly AssumptionKey[] {
    return Object.freeze(this.all().filter((a) => a.source?.kind === "VENDOR").map((a) => a.key));
  }

  private checkAgesOrdered(): void {
    const now = this.entries.currentAge.value;
    const retire = this.entries.retirementAge.value;
    const horizon = this.entries.horizonAge.value;
    if (now !== null && retire !== null && retire < now) throw new RangeError("Retirement age cannot be below the current age.");
    if (retire !== null && horizon !== null && horizon <= retire) throw new RangeError("The plan must run past the retirement age.");
    if (now !== null && horizon !== null && horizon <= now) throw new RangeError("The plan must run past the current age.");
  }
}
