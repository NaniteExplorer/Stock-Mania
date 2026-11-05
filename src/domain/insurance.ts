/**
 * Insurance — presence, premium outgo and renewal dates. Not adequacy.
 *
 * `PRODUCT-REQUIREMENT.md` §4.1: **no authoritative Indian sum-insured threshold
 * exists**, so this module scores nothing against one. A policy's sum insured is
 * recorded and shown; it never decides whether the owner "has cover". There is
 * deliberately no rupee constant anywhere in this file.
 *
 * Presence is one of three states (§5): **covered**, **declared absent** (the
 * owner has stated they hold no such policy) or **unknown**. An empty list is
 * unknown — it cannot tell an uninsured owner from one who has not typed it in,
 * and treating it as absence would accuse one of being the other.
 */

import { Money, type Currency } from "@/core/money";
import type { UserId } from "@/core/kernel";
import type { PriceSteps, Recurrence } from "@/core/recurrence";
import type { CalendarDate } from "@/core/time";
import type { Ratio, Years } from "@/core/units";

export type CoverKind = "HEALTH" | "TERM_LIFE" | "PERSONAL_ACCIDENT" | "MOTOR" | "HOME" | "OTHER";

/** Reads retain dated declarations and never infer absence from an empty list. */
export interface InsuranceRepository {
  find(userId: UserId, id: string): Promise<InsurancePolicy | null>;
  list(userId: UserId): Promise<readonly InsurancePolicy[]>;
  declarations(userId: UserId): Promise<readonly AbsenceDeclaration[]>;
}

/** Creates the policy and its complete premium history in one audited atomic operation. */
export interface InsuranceWriter {
  create(userId: UserId, policy: InsurancePolicy): Promise<void>;
}

export interface InsurancePolicyFields {
  readonly id: string;
  readonly kind: CoverKind;
  readonly insurer: string;
  /** Whom it covers, as the owner names them: "Self", "Self + spouse". */
  readonly insured: string;
  /** Recorded and shown. Never compared with a threshold. Null when not entered. */
  readonly sumInsured: Money | null;
  readonly currency: Currency;
  /** When premiums fall due. Its anchor is the policy's start. */
  readonly premiumSchedule: Recurrence;
  readonly premium: PriceSteps;
  /** The day cover stops, or null while it renews. */
  readonly endsOn: CalendarDate | null;
}

export class InsurancePolicy implements InsurancePolicyFields {
  readonly id: string;
  readonly kind: CoverKind;
  readonly insurer: string;
  readonly insured: string;
  readonly sumInsured: Money | null;
  readonly currency: Currency;
  readonly premiumSchedule: Recurrence;
  readonly premium: PriceSteps;
  readonly endsOn: CalendarDate | null;

  constructor(fields: InsurancePolicyFields) {
    if (!fields.insurer.trim()) throw new RangeError("A policy needs an insurer.");
    if (fields.sumInsured !== null && !fields.sumInsured.isPositive) {
      throw new RangeError("A sum insured, when entered, must be more than zero.");
    }
    if (fields.endsOn !== null && fields.endsOn.isBefore(fields.premiumSchedule.anchor)) {
      throw new RangeError("A policy cannot end before it starts.");
    }
    if (fields.premium.entries().some((step) => step.amount !== null && !step.amount.currency.equals(fields.currency))) {
      throw new RangeError(`The policy is in ${fields.currency.code}; every premium must be in that currency too.`);
    }
    if (fields.sumInsured !== null && !fields.sumInsured.currency.equals(fields.currency)) {
      throw new RangeError(`The policy is in ${fields.currency.code}; its sum insured must be in that currency too.`);
    }
    this.id = fields.id;
    this.kind = fields.kind;
    this.insurer = fields.insurer;
    this.insured = fields.insured;
    this.sumInsured = fields.sumInsured;
    this.currency = fields.currency;
    this.premiumSchedule = fields.premiumSchedule;
    this.premium = fields.premium;
    this.endsOn = fields.endsOn;
  }

  get startsOn(): CalendarDate {
    return this.premiumSchedule.anchor;
  }

  /** In force on `date`: started, and not yet ended. */
  inForceOn(date: CalendarDate): boolean {
    return date.isOnOrAfter(this.startsOn) && (this.endsOn === null || date.isOnOrBefore(this.endsOn));
  }

  /** The next premium due on or after `date`, with what it will cost and the last day to cancel. */
  nextRenewal(date: CalendarDate): Renewal | null {
    const dueOn = this.premiumSchedule.nextOnOrAfter(date);
    if (dueOn === null || (this.endsOn !== null && dueOn.isAfter(this.endsOn))) return null;
    return { policyId: this.id, dueOn, premium: this.premium.on(dueOn), cancelBy: this.premiumSchedule.cancelBy(dueOn) };
  }

  /**
   * Premium paid over a year at the price in force on `date`: premium × times
   * per year. Null when the premium is unknown — never counted as nothing.
   */
  annualPremium(date: CalendarDate): Money | null {
    const each = this.premium.on(date);
    return each === null ? null : each.times(this.premiumSchedule.perYear);
  }
}

export interface Renewal {
  readonly policyId: string;
  readonly dueOn: CalendarDate;
  readonly premium: Money | null;
  readonly cancelBy: CalendarDate | null;
}

/** The owner's statement that they hold no policy of a kind. A fact, dated. */
export interface AbsenceDeclaration {
  readonly kind: CoverKind;
  readonly declaredOn: CalendarDate;
}

export type Presence =
  | { readonly state: "covered"; readonly policies: readonly InsurancePolicy[] }
  | { readonly state: "declared-absent"; readonly declaredOn: CalendarDate }
  | { readonly state: "unknown" };

/**
 * Whether the owner holds cover of `kind` on `asOf`.
 *
 * A policy in force wins over a declaration — the owner bought one since. A
 * declaration made after a policy lapsed records the absence; one made while a
 * policy is in force is overruled by the policy. With neither, **unknown**.
 */
export function presenceOf(
  kind: CoverKind,
  policies: readonly InsurancePolicy[],
  declarations: readonly AbsenceDeclaration[],
  asOf: CalendarDate,
): Presence {
  const inForce = policies.filter((policy) => policy.kind === kind && policy.inForceOn(asOf));
  if (inForce.length > 0) return { state: "covered", policies: inForce };

  const latest = declarations
    .filter((declaration) => declaration.kind === kind && declaration.declaredOn.isOnOrBefore(asOf))
    .reduce<AbsenceDeclaration | null>((best, d) => (best === null || d.declaredOn.isAfter(best.declaredOn) ? d : best), null);
  return latest === null ? { state: "unknown" } : { state: "declared-absent", declaredOn: latest.declaredOn };
}

/**
 * Total premium outgo a year across policies in force on `asOf`. Null if any
 * in-force policy's premium is unknown: a partial total would understate it.
 */
export function annualPremiumOutgo(policies: readonly InsurancePolicy[], asOf: CalendarDate, currency: Currency): Money | null {
  let total = Money.zero(currency);
  for (const policy of policies) {
    if (!policy.inForceOn(asOf)) continue;
    const annual = policy.annualPremium(asOf);
    if (annual === null) return null;
    total = total.plus(annual);
  }
  return total;
}

/** Renewals due within `[from, until]`, soonest first. */
export function renewalsBetween(policies: readonly InsurancePolicy[], from: CalendarDate, until: CalendarDate): Renewal[] {
  return policies
    .map((policy) => policy.nextRenewal(from))
    .filter((renewal): renewal is Renewal => renewal !== null && renewal.dueOn.isOnOrBefore(until))
    .sort((a, b) => a.dueOn.compareTo(b.dueOn));
}

/**
 * What a sum insured buys after `years` of medical inflation — **information,
 * not a verdict**. The rate and its source are the caller's, and both are
 * required: §4.1 says erosion is cited as a consultancy survey, never as an
 * official statistic, so this module holds no rate of its own.
 */
export interface CoverErosion {
  readonly sumInsured: Money;
  readonly years: Years;
  /** Annual medical inflation as a fraction: 0.12 is 12%. */
  readonly rate: Ratio;
  /** Who published the rate, e.g. a named consultancy's annual survey, and when. */
  readonly source: string;
  /** Today's-money equivalent of the sum insured after `years`. */
  readonly realValue: Money;
}

const EROSION_SCALE = 1_000_000_000;

export function coverErosion(sumInsured: Money, years: Years, rate: Ratio, source: string): CoverErosion {
  if (!source.trim()) throw new RangeError("An erosion figure must cite its source.");
  if (rate <= -1) throw new RangeError("Inflation of -100% or lower is not a rate.");
  // The compounding is floating point — this is an illustration, never posted —
  // so it is fixed to nine places before it touches Money, whose rounding is exact.
  const factor = BigInt(Math.round((1 + rate) ** years * EROSION_SCALE));
  return { sumInsured, years, rate, source, realValue: sumInsured.timesRatio(BigInt(EROSION_SCALE), factor, "HALF_EVEN") };
}
