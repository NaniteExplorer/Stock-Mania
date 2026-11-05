import { Currency } from "@/core/money";
import { rupee, unknown, type FigureValue } from "@/core/format";
import type { Cadence } from "@/core/recurrence";
import type { CalendarDate } from "@/core/time";
import {
  annualPremiumOutgo, presenceOf, renewalsBetween,
  type AbsenceDeclaration, type CoverKind, type InsurancePolicy,
} from "@/domain/insurance";

/**
 * Everything `/insurance` shows, derived from the domain and nothing else.
 *
 * Presence only (PRODUCT §4.1): no sum insured is compared with anything, and an
 * empty list is **unknown**, never "not covered". Every figure that cannot be
 * computed is `unknown(reason)`, never zero.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "12 Jun 2026", from the ISO form, without a JavaScript Date. */
export function displayDate(date: CalendarDate): string {
  const [year, month, day] = date.toISO().split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

export const KIND_LABELS: Readonly<Record<CoverKind, string>> = {
  HEALTH: "Health", TERM_LIFE: "Term life", PERSONAL_ACCIDENT: "Personal accident",
  MOTOR: "Motor", HOME: "Home", OTHER: "Other",
};
export const CADENCE_LABELS: Readonly<Record<Cadence, string>> = {
  MONTHLY: "a month", QUARTERLY: "a quarter", HALF_YEARLY: "every six months", ANNUAL: "a year",
};
/** The kinds whose presence matters first (DESIGN §9d), in strip order. */
export const STRIP_KINDS: readonly CoverKind[] = ["HEALTH", "TERM_LIFE", "PERSONAL_ACCIDENT"];
export const RENEWAL_WINDOW_DAYS = 60;

export type PresenceCell =
  | { readonly kind: CoverKind; readonly label: string; readonly state: "covered"; readonly detail: string }
  | { readonly kind: CoverKind; readonly label: string; readonly state: "declared-absent"; readonly detail: string }
  | { readonly kind: CoverKind; readonly label: string; readonly state: "unknown"; readonly value: FigureValue; readonly detail: string };

export interface PolicyRow {
  readonly id: string;
  readonly kind: string;
  readonly insurer: string;
  readonly insured: string;
  readonly sumInsured: FigureValue;
  readonly premium: FigureValue;
  readonly cadence: string;
  /** Either a date, an "Ended …" line, or a reason no premium is due. */
  readonly nextDue: string;
  readonly cancelBy: FigureValue | string;
  readonly ended: boolean;
}

export interface RenewalRow {
  readonly policyId: string;
  readonly label: string;
  readonly dueOn: string;
  readonly premium: FigureValue;
  /** The price before this renewal, only when it differs: a fact, shown neutrally. */
  readonly previous: FigureValue | null;
  readonly cancelBy: FigureValue | string;
}

export interface InsuranceView {
  readonly isEmpty: boolean;
  readonly outgo: FigureValue;
  readonly nextRenewal: { readonly label: string; readonly value: FigureValue };
  readonly inForceCount: number;
  readonly presence: readonly PresenceCell[];
  readonly policies: readonly PolicyRow[];
  readonly renewals: readonly RenewalRow[];
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const premiumFigure = (policy: InsurancePolicy, on: CalendarDate): FigureValue => {
  const amount = policy.premium.on(on);
  return amount === null ? unknown("Premium not entered") : rupee(amount);
};
const cancelByCell = (date: CalendarDate | null): FigureValue | string =>
  // Unknown notice is not zero notice: never fall back to the due date.
  date === null ? unknown("Notice period not known") : displayDate(date);

export function buildInsuranceView(
  policies: readonly InsurancePolicy[],
  declarations: readonly AbsenceDeclaration[],
  today: CalendarDate,
): InsuranceView {
  const inForce = policies.filter((policy) => policy.inForceOn(today));
  const reporting = Currency.reporting;
  const foreign = inForce.filter((policy) => !policy.currency.equals(reporting));

  let outgo: FigureValue;
  if (inForce.length === 0) outgo = unknown("No policy in force has been entered");
  else if (foreign.length > 0) outgo = unknown(`${plural(foreign.length, "policy is", "policies are")} not in ${reporting.code}; premiums are not converted`);
  else {
    const total = annualPremiumOutgo(inForce, today, reporting);
    const missing = inForce.filter((policy) => policy.annualPremium(today) === null).length;
    outgo = total === null ? unknown(`${plural(missing, "premium", "premiums")} not entered`) : rupee(total);
  }

  const upcoming = renewalsBetween(inForce, today, today.plusYears(1));
  const first = upcoming[0];
  const nextRenewal = first === undefined
    ? { label: "Next renewal", value: unknown("No renewal is scheduled for a policy in force") }
    : {
        label: `Next renewal · ${displayDate(first.dueOn)}`,
        value: first.premium === null ? unknown("Premium not entered") : rupee(first.premium),
      };

  const presence: PresenceCell[] = STRIP_KINDS.map((kind) => {
    const label = KIND_LABELS[kind];
    const found = presenceOf(kind, policies, declarations, today);
    if (found.state === "covered") {
      const [only] = found.policies;
      const detail = found.policies.length > 1 || only === undefined
        ? plural(found.policies.length, "policy", "policies")
        : `${only.insurer} · ${only.insured}`;
      return { kind, label, state: "covered", detail };
    }
    if (found.state === "declared-absent") {
      return { kind, label, state: "declared-absent", detail: `You said so on ${displayDate(found.declaredOn)}` };
    }
    return { kind, label, state: "unknown", value: unknown(`${label} cover not entered`), detail: "Not entered — add a policy or say you have none" };
  });

  const ordered = [...policies].sort((a, b) => Number(b.inForceOn(today)) - Number(a.inForceOn(today)) || a.startsOn.compareTo(b.startsOn));
  const rows: PolicyRow[] = ordered.map((policy) => {
    const ended = policy.endsOn !== null && policy.endsOn.isBefore(today);
    const renewal = ended ? null : policy.nextRenewal(today);
    const nextDue = ended && policy.endsOn !== null ? `Ended ${displayDate(policy.endsOn)}`
      : renewal !== null ? displayDate(renewal.dueOn) : "No further premium due";
    return {
      id: policy.id,
      kind: KIND_LABELS[policy.kind],
      insurer: policy.insurer,
      insured: policy.insured,
      sumInsured: policy.sumInsured === null ? unknown("Not entered") : rupee(policy.sumInsured),
      premium: premiumFigure(policy, renewal?.dueOn ?? today),
      cadence: CADENCE_LABELS[policy.premiumSchedule.cadence],
      nextDue,
      cancelBy: renewal === null ? unknown("No renewal to cancel") : cancelByCell(renewal.cancelBy),
      ended,
    };
  });

  const byId = new Map(policies.map((policy) => [policy.id, policy]));
  const renewals: RenewalRow[] = renewalsBetween(inForce, today, today.plusDays(RENEWAL_WINDOW_DAYS)).map((renewal) => {
    const policy = byId.get(renewal.policyId);
    const before = policy?.premium.on(renewal.dueOn.plusDays(-1)) ?? null;
    const changed = before !== null && renewal.premium !== null && !before.equals(renewal.premium);
    return {
      policyId: renewal.policyId,
      label: policy ? `${KIND_LABELS[policy.kind]} · ${policy.insurer}` : "Policy",
      dueOn: displayDate(renewal.dueOn),
      premium: renewal.premium === null ? unknown("Premium not entered") : rupee(renewal.premium),
      previous: changed && before !== null ? rupee(before) : null,
      cancelBy: cancelByCell(renewal.cancelBy),
    };
  });

  return { isEmpty: policies.length === 0, outgo, nextRenewal, inForceCount: inForce.length, presence, policies: rows, renewals };
}
