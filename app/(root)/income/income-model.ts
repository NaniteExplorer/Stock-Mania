/**
 * The /income view model: pure, no I/O, no clock. Every figure is a FigureValue,
 * so an absence reaches the screen as an em-dash with its reason, never a zero.
 */
import { Money } from "@/core/money";
import { rupee, signed, unknown, type Figure, type FigureValue } from "@/core/format";
import { CalendarDate, DateRange, FinancialYear } from "@/core/time";
import { Count, type Days } from "@/core/units";
import type { IncomeKind, IncomePeriod, IncomeReceipt, IncomeStream, OccurrenceState } from "@/domain/income";

/** format.ts has no count formatter yet (follow-up); a whole-number string is its own display form. */
export function countFigure(value: Count): Figure {
  return String(Count(value)) as Figure;
}

const DAY_MONTH = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
const DAY_MONTH_YEAR = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const dayMonth = (date: CalendarDate): string => DAY_MONTH.format(date.toUtcInstant());
export const dayMonthYear = (date: CalendarDate): string => DAY_MONTH_YEAR.format(date.toUtcInstant());

export const KIND_LABELS: Record<IncomeKind, string> = {
  SALARY: "Salary", FREELANCE: "Freelance", BONUS: "Bonus", RENT: "Rent", INTEREST: "Interest", OTHER: "Other",
};
const CADENCE_LABELS = { MONTHLY: "Monthly", QUARTERLY: "Quarterly", HALF_YEARLY: "Half-yearly", ANNUAL: "Annual" } as const;

export type CellView =
  | { readonly state: "received"; readonly key: string; readonly due: string; readonly receivedOn: string; readonly amount: Figure; readonly difference: FigureValue | null; readonly text: string }
  | { readonly state: "missing"; readonly key: string; readonly due: string; readonly expected: FigureValue; readonly lateBy: Days; readonly text: string }
  | { readonly state: "pending"; readonly key: string; readonly due: string; readonly expected: FigureValue; readonly text: string };

export interface StreamView {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly cells: readonly CellView[];
}

export interface IncomeSummary {
  readonly receivedThisMonth: FigureValue;
  readonly expectedThisMonth: FigureValue;
  readonly missingThisMonth: Count;
  readonly receivedFy: FigureValue;
  readonly expectedFy: FigureValue;
  readonly missingFy: Count;
  readonly pendingFy: Count;
  readonly fyLabel: string;
}

export interface IncomeView {
  readonly summary: IncomeSummary;
  readonly streams: readonly StreamView[];
}

export interface StreamInput {
  readonly stream: IncomeStream;
  readonly receipts: readonly IncomeReceipt[];
}

const NOT_ENTERED = "Expected amount not entered";
const expectedFigure = (amount: Money | null): FigureValue => (amount === null ? unknown(NOT_ENTERED) : rupee(amount, 0));
const late = (days: Days) => `${days} day${days === 1 ? "" : "s"} late`;

export function cellOf(occurrence: OccurrenceState): CellView {
  const key = occurrence.dueOn.toISO();
  const due = dayMonth(occurrence.dueOn);
  const expectedText = occurrence.expected === null ? "expected amount not entered" : `expected ${rupee(occurrence.expected, 0)}`;
  switch (occurrence.state) {
    case "received": {
      const amount = occurrence.receipt.amount;
      const difference = occurrence.expected === null ? unknown("No expected amount to compare with") : amount.minus(occurrence.expected).isZero ? null : signed(amount.minus(occurrence.expected), { fractionDigits: 0 });
      const receivedOn = dayMonth(occurrence.receipt.receivedOn);
      return { state: "received", key, due, receivedOn, amount: rupee(amount, 0), difference, text: `Received ${rupee(amount, 0)} on ${receivedOn}` };
    }
    case "missing":
      return { state: "missing", key, due, expected: expectedFigure(occurrence.expected), lateBy: occurrence.lateBy, text: `Missing — ${expectedText}, ${late(occurrence.lateBy)}` };
    case "pending":
      return { state: "pending", key, due, expected: expectedFigure(occurrence.expected), text: `Due ${due}, ${expectedText}` };
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Sum periods across streams without ever turning a gap into a zero. */
function totals(periods: readonly IncomePeriod[], streams: readonly IncomeStream[]) {
  const currencies = new Set(streams.map((s) => s.currency.code));
  if (currencies.size > 1) {
    const mixed = unknown("Streams are paid in more than one currency; no single total is shown");
    return { received: mixed as FigureValue, expected: mixed as FigureValue };
  }
  const currency = streams[0]!.currency;
  const received = periods.reduce((sum, p) => sum.plus(p.received), Money.zero(currency));
  const unknownAmounts = periods.reduce((n, p) => n + p.occurrences.filter((o) => o.expected === null).length, 0);
  const expected: FigureValue = unknownAmounts > 0
    ? unknown(`${plural(unknownAmounts, "expected amount")} not entered`)
    : rupee(periods.reduce((sum, p) => sum.plus(p.expected!), Money.zero(currency)), 0);
  return { received: rupee(received, 0) as FigureValue, expected };
}

export function buildIncomeView(inputs: readonly StreamInput[], today: CalendarDate): IncomeView {
  if (inputs.length === 0) throw new RangeError("An income view needs at least one stream; render the empty state instead.");
  const month = DateRange.monthOf(today);
  const fy = FinancialYear.containing(today);
  const fyToDate = DateRange.of(fy.start, today);
  const trailing = DateRange.of(today.plusMonths(-11).startOfMonth(), today.endOfMonth());
  const streams = inputs.map((i) => i.stream);
  const monthPeriods = inputs.map(({ stream, receipts }) => stream.period(month, receipts, today));
  const fyPeriods = inputs.map(({ stream, receipts }) => stream.period(fyToDate, receipts, today));
  const thisMonth = totals(monthPeriods, streams);
  const fyTotals = totals(fyPeriods, streams);
  const count = (periods: readonly IncomePeriod[], key: "missing" | "pending") => Count(periods.reduce((n, p) => n + p[key], 0));

  return {
    summary: {
      receivedThisMonth: thisMonth.received,
      expectedThisMonth: thisMonth.expected,
      missingThisMonth: count(monthPeriods, "missing"),
      receivedFy: fyTotals.received,
      expectedFy: fyTotals.expected,
      missingFy: count(fyPeriods, "missing"),
      pendingFy: count(fyPeriods, "pending"),
      fyLabel: `FY ${fy.label}`,
    },
    streams: inputs.map(({ stream, receipts }) => ({
      id: stream.id,
      name: stream.name,
      description: [KIND_LABELS[stream.kind], stream.payer, CADENCE_LABELS[stream.schedule.cadence], `${stream.grace} days' grace`].filter(Boolean).join(" · "),
      cells: stream.occurrencesIn(trailing, receipts, today).map(cellOf),
    })),
  };
}
