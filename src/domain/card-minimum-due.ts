/**
 * The minimum due on a closed card statement (card-minimum-due.md).
 *
 * Two sources, in order: the amount the owner typed from the issuer's statement, or
 * — when none is typed — the card's own rule (a user-entered percentage of the
 * statement balance with a user-entered floor; `CreditCard.minimumDueOn`). Only the
 * typed figure is ever stored. The statement is rebuilt with the typed amount so
 * `CardStatement`'s own invariant (never above the closing balance) still guards it.
 */
import type { Money } from "@/core/money";
import type { CalendarDate } from "@/core/time";
import { CardStatement } from "./assets";

export interface EnteredMinimumDue {
  readonly accountId: string;
  /** The last day of the statement cycle the amount was printed on. */
  readonly statementThrough: CalendarDate;
  readonly amount: Money;
}

export interface ResolvedMinimumDue {
  readonly statement: CardStatement;
  /** True when the minimum is the owner's typed figure; false when it is the card's rule. */
  readonly entered: boolean;
}

/** Refuses a typed minimum that cannot belong to this statement. */
export function validateEnteredMinimumDue(statement: CardStatement, amount: Money): Money {
  if (!amount.currency.equals(statement.closing.currency)) {
    throw new RangeError(`The minimum due must be in ${statement.closing.currency.code}, the card's currency.`);
  }
  if (amount.isNegative) throw new RangeError("A minimum due cannot be negative.");
  if (amount.isGreaterThan(statement.totalDue)) {
    throw new RangeError(
      `The minimum due (${amount.toString()}) cannot exceed the statement's total due (${statement.totalDue.toString()}).`,
    );
  }
  return amount;
}

/** The statement with the owner's typed minimum applied, or unchanged when none is typed. */
export function withEnteredMinimumDue(statement: CardStatement, entered: Money | null): ResolvedMinimumDue {
  if (entered === null) return Object.freeze({ statement, entered: false });
  const amount = validateEnteredMinimumDue(statement, entered);
  return Object.freeze({
    statement: new CardStatement(statement.cycle, statement.opening, statement.movements, amount),
    entered: true,
  });
}

export interface CardMinimumDueReader {
  /** Live typed minimums for these cards, any statement. */
  forCards(userId: { readonly value: string }, accountIds: readonly string[]): Promise<readonly EnteredMinimumDue[]>;
}

export interface CardMinimumDueWriter {
  /** Records or corrects the typed minimum for one statement. */
  record(userId: { readonly value: string }, entry: EnteredMinimumDue): Promise<void>;
  /** Tombstones it; the card's rule applies again. */
  remove(userId: { readonly value: string }, accountId: string, statementThrough: CalendarDate): Promise<void>;
}
