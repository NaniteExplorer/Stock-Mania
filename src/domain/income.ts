/**
 * Income streams — what the owner expects to be paid, and what actually arrived.
 *
 * `PRODUCT-REQUIREMENT.md` §4.4: **a missed inflow reads as missing, not as zero
 * income.** Each expected occurrence is in exactly one of three states:
 *
 * - **received** — a posting has been linked to it by the owner;
 * - **missing**  — its due date plus the grace period has passed with no link;
 * - **pending**  — it is not yet late.
 *
 * Receipts are matched by an **explicit link** to a posting, never by guessing
 * from amount and date (agreed with Codex, 2026-10-28). A salary that arrives
 * ₹3 short is still that salary; a refund of the same size is not.
 */

import { Money, type Currency } from "@/core/money";
import type { UserId } from "@/core/kernel";
import type { PriceSteps, Recurrence } from "@/core/recurrence";
import type { CalendarDate, DateRange } from "@/core/time";
import { Count, Days } from "@/core/units";

export type IncomeKind = "SALARY" | "FREELANCE" | "BONUS" | "RENT" | "INTEREST" | "OTHER";

/** Owner-scoped reads; receipt amounts are hydrated from the linked live posting. */
export interface IncomeRepository {
  find(userId: UserId, id: string): Promise<IncomeStream | null>;
  list(userId: UserId): Promise<readonly IncomeStream[]>;
  receipts(userId: UserId, streamId: string): Promise<readonly IncomeReceipt[]>;
}

/** Creates the stream and its complete price history in one audited atomic operation. */
export interface IncomeWriter {
  create(userId: UserId, stream: IncomeStream): Promise<void>;
}

/** The owner's statement that a posting is a given occurrence of a stream. */
export interface IncomeReceipt {
  readonly streamId: string;
  /** The scheduled date this receipt settles — not the day it arrived. */
  readonly occurrence: CalendarDate;
  readonly postingId: string;
  readonly receivedOn: CalendarDate;
  readonly amount: Money;
}

export type OccurrenceState =
  | { readonly state: "received"; readonly dueOn: CalendarDate; readonly expected: Money | null; readonly receipt: IncomeReceipt }
  | { readonly state: "missing"; readonly dueOn: CalendarDate; readonly expected: Money | null; readonly lateBy: Days }
  | { readonly state: "pending"; readonly dueOn: CalendarDate; readonly expected: Money | null };

export interface IncomeStreamFields {
  readonly id: string;
  readonly name: string;
  readonly kind: IncomeKind;
  /** Employer, tenant or client, as the owner names them. */
  readonly payer: string | null;
  /** What it is paid in. Stated, because an unknown expected amount carries no currency. */
  readonly currency: Currency;
  readonly schedule: Recurrence;
  readonly expected: PriceSteps;
  /** Days after the due date before an absent payment counts as missing. */
  readonly grace: Days;
}

/** What a period's income looked like, without ever turning an absence into a zero. */
export interface IncomePeriod {
  readonly range: DateRange;
  readonly occurrences: readonly OccurrenceState[];
  /** What actually arrived: the sum of linked receipts. A real figure, even when small. */
  readonly received: Money;
  /** What was expected, or null when any occurrence's expected amount is unknown. */
  readonly expected: Money | null;
  readonly missing: Count;
  readonly pending: Count;
}

export class IncomeStream implements IncomeStreamFields {
  readonly id: string;
  readonly name: string;
  readonly kind: IncomeKind;
  readonly payer: string | null;
  readonly currency: Currency;
  readonly schedule: Recurrence;
  readonly expected: PriceSteps;
  readonly grace: Days;

  constructor(fields: IncomeStreamFields) {
    if (!fields.name.trim()) throw new RangeError("An income stream needs a name.");
    if (fields.expected.entries().some((step) => step.amount !== null && !step.amount.currency.equals(fields.currency))) {
      throw new RangeError(`${fields.name} is in ${fields.currency.code}; every expected amount must be in that currency too.`);
    }
    this.id = fields.id;
    this.name = fields.name;
    this.kind = fields.kind;
    this.payer = fields.payer;
    this.currency = fields.currency;
    this.schedule = fields.schedule;
    this.expected = fields.expected;
    this.grace = fields.grace;
  }

  /** The state of each occurrence due inside `range`, as seen on `asOf`. */
  occurrencesIn(range: DateRange, receipts: readonly IncomeReceipt[], asOf: CalendarDate): OccurrenceState[] {
    const settled = new Map<string, IncomeReceipt>();
    const postings = new Set<string>();
    for (const receipt of receipts) {
      if (receipt.streamId !== this.id) continue;
      // A receipt is money in: the linked posting is the inflow to the bank side, never the
      // income account's offsetting credit. A non-positive amount means the wrong leg was linked.
      if (!receipt.amount.isPositive) throw new RangeError(`Posting ${receipt.postingId} is not an inflow; link the bank-side posting.`);
      // One posting is one payment: it cannot settle two occurrences.
      if (postings.has(receipt.postingId)) throw new RangeError(`Posting ${receipt.postingId} already settles another ${this.name} occurrence.`);
      postings.add(receipt.postingId);
      // Seen from `asOf`, money that arrives later has not arrived yet.
      if (receipt.receivedOn.isAfter(asOf)) continue;
      const key = receipt.occurrence.toISO();
      if (settled.has(key)) throw new RangeError(`Two receipts settle ${this.name} due ${key}.`);
      if (this.schedule.nextOnOrAfter(receipt.occurrence)?.equals(receipt.occurrence) !== true) {
        throw new RangeError(`${this.name} is not due on ${key}, so nothing can settle it.`);
      }
      settled.set(key, receipt);
    }

    return this.schedule.occurrencesIn(range).map((dueOn) => this.stateOf(dueOn, settled.get(dueOn.toISO()), asOf));
  }

  /** One period's income: what arrived, what was expected, and how many are missing. */
  period(range: DateRange, receipts: readonly IncomeReceipt[], asOf: CalendarDate): IncomePeriod {
    const occurrences = this.occurrencesIn(range, receipts, asOf);
    const linked = occurrences.flatMap((o) => (o.state === "received" ? [o.receipt.amount] : []));
    const expectedAmounts = occurrences.map((o) => o.expected);

    return {
      range,
      occurrences,
      received: linked.reduce((sum, amount) => sum.plus(amount), Money.zero(this.currency)),
      // One unknown expectation makes the total unknown. Summing the known ones
      // would present a partial figure as the whole.
      expected: expectedAmounts.some((amount) => amount === null)
        ? null
        : (expectedAmounts as Money[]).reduce((sum, amount) => sum.plus(amount), Money.zero(this.currency)),
      missing: Count(occurrences.filter((o) => o.state === "missing").length),
      pending: Count(occurrences.filter((o) => o.state === "pending").length),
    };
  }

  private stateOf(dueOn: CalendarDate, receipt: IncomeReceipt | undefined, asOf: CalendarDate): OccurrenceState {
    const expected = this.expected.on(dueOn);
    if (receipt !== undefined) return { state: "received", dueOn, expected, receipt };
    const lateFrom = dueOn.plusDays(this.grace);
    if (asOf.isAfter(lateFrom)) return { state: "missing", dueOn, expected, lateBy: Days(lateFrom.daysUntil(asOf)) };
    return { state: "pending", dueOn, expected };
  }
}

