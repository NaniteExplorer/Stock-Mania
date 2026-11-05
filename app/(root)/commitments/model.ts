import { Currency, type Money } from "@/core/money";
import { rupee, unknown, type Figure, type FigureValue } from "@/core/format";
import type { Cadence } from "@/core/recurrence";
import type { CalendarDate } from "@/core/time";
import { Count } from "@/core/units";
import { committedOutgo, upcomingCharges, type Commitment, type CommitmentKind } from "@/domain/commitments";

/**
 * The /commitments view model (DESIGN §9d part 2). Pure: every figure is a
 * `FigureValue`, so an unknown price can only reach the screen as an em-dash
 * with its reason, never as ₹0.
 */

export const KIND_LABELS: Readonly<Record<CommitmentKind, string>> = {
  STREAMING: "Streaming", MOBILE: "Mobile", BROADBAND: "Broadband", EDUCATION: "Education",
  MEMBERSHIP: "Membership", SOFTWARE: "Software", OTHER: "Other",
};
export const CADENCE_LABELS: Readonly<Record<Cadence, string>> = {
  MONTHLY: "Monthly", QUARTERLY: "Quarterly", HALF_YEARLY: "Half-yearly", ANNUAL: "Annual",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "3 Nov", with the year only when it is not the current one. */
export function shortDate(date: CalendarDate, today: CalendarDate): string {
  const base = `${date.day} ${MONTHS[date.month - 1]}`;
  return date.year === today.year ? base : `${base} ${date.year}`;
}

const priceNotEntered = (count: number) => `${count} price${count === 1 ? "" : "s"} not entered`;
const figure = (money: Money | null, reason: string): FigureValue => (money === null ? unknown(reason) : rupee(money));

export type CancelBy =
  | { readonly kind: "date"; readonly text: string }
  | { readonly kind: "unknown"; readonly reason: string }
  | { readonly kind: "passed"; readonly text: string };

export interface RenewalRow {
  readonly id: string;
  readonly name: string;
  readonly due: string;
  readonly amount: FigureValue;
  readonly priceChange: { readonly from: Figure; readonly to: Figure } | null;
  readonly cancelBy: CancelBy;
  readonly autoRenews: boolean;
}

export type CommitmentGroup = "active" | "ending" | "ended";

export interface CommitmentRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly cadence: string;
  readonly price: FigureValue;
  readonly perMonth: FigureValue;
  readonly nextCharge: string | null;
  readonly autoRenews: boolean;
  readonly ends: string | null;
  readonly group: CommitmentGroup;
}

export interface CommitmentsModel {
  readonly perMonth: FigureValue;
  readonly perYear: FigureValue;
  readonly autoRenewingPerMonth: FigureValue;
  readonly active: Count;
  readonly renewing: readonly RenewalRow[];
  readonly rows: Readonly<Record<CommitmentGroup, readonly CommitmentRow[]>>;
}

export function groupOf(commitment: Commitment, today: CalendarDate): CommitmentGroup {
  if (commitment.endsOn === null) return "active";
  return today.isAfter(commitment.endsOn) ? "ended" : "ending";
}

export function buildCommitmentsModel(commitments: readonly Commitment[], today: CalendarDate, currency: Currency = Currency.reporting): CommitmentsModel {
  const active = commitments.filter((c) => c.activeOn(today));
  const foreign = active.filter((c) => !c.currency.equals(currency));
  const local = commitments.filter((c) => c.currency.equals(currency));
  const outgo = committedOutgo(local, today, currency);
  const unknownAll = active.filter((c) => c.currency.equals(currency) && c.annualOn(today) === null).length;
  const unknownAuto = active.filter((c) => c.currency.equals(currency) && c.autoRenews && c.annualOn(today) === null).length;
  // A commitment in another currency is not converted here: summing it would be a guess.
  const foreignReason = foreign.length > 0 ? `${foreign.length} commitment${foreign.length === 1 ? "" : "s"} not in ${currency.code} — not converted` : null;
  const total = (money: Money | null, missing: number): FigureValue =>
    foreignReason ? unknown(foreignReason) : figure(money, priceNotEntered(Math.max(missing, 1)));

  const byId = new Map(commitments.map((c) => [c.id, c]));
  const renewing: RenewalRow[] = upcomingCharges(commitments, today, today.plusDays(30)).map((charge) => {
    const owner = byId.get(charge.commitmentId)!;
    const due = shortDate(charge.dueOn, today);
    const cancelBy: CancelBy = charge.cancelBy === null
      ? { kind: "unknown", reason: "Notice period not known" }
      : charge.cancelBy.isBefore(today)
        ? { kind: "passed", text: `Cancel-by passed — renews ${due}` }
        : { kind: "date", text: shortDate(charge.cancelBy, today) };
    return {
      id: owner.id, name: owner.name, due,
      amount: figure(charge.amount, "Price not entered"),
      priceChange: charge.priceChange ? { from: rupee(charge.priceChange.from), to: rupee(charge.priceChange.to) } : null,
      cancelBy, autoRenews: charge.autoRenews,
    };
  });

  const rows: Record<CommitmentGroup, CommitmentRow[]> = { active: [], ending: [], ended: [] };
  for (const c of commitments) {
    const group = groupOf(c, today);
    const priceOn = c.activeOn(today) ? today : c.endsOn !== null && today.isAfter(c.endsOn) ? c.endsOn : c.schedule.anchor;
    const price = c.price.on(priceOn);
    const annual = c.activeOn(today) ? c.annualOn(today) : null;
    const next = c.nextCharge(today);
    rows[group].push({
      id: c.id, name: c.name, kind: KIND_LABELS[c.kind], cadence: CADENCE_LABELS[c.schedule.cadence],
      price: figure(price, "Price not entered"),
      perMonth: !c.activeOn(today)
        ? unknown(group === "ended" ? "Ended — no longer counted" : "Not started yet")
        : figure(annual?.dividedBy(12, "HALF_EVEN") ?? null, "Price not entered"),
      nextCharge: next ? shortDate(next.dueOn, today) : null,
      autoRenews: c.autoRenews,
      ends: c.endsOn ? shortDate(c.endsOn, today) : null,
      group,
    });
  }

  return {
    perMonth: total(outgo.perMonth, unknownAll),
    perYear: total(outgo.perYear, unknownAll),
    autoRenewingPerMonth: total(outgo.autoRenewingPerMonth, unknownAuto),
    active: Count(active.length),
    renewing,
    rows,
  };
}
