/**
 * What a statement says about itself, outside its table.
 *
 * Every bank prints the same four facts somewhere on the page — whose account
 * this is, which period it covers, what the balance ended at, and what the
 * movements totalled — and until now the importer read none of them. It read the
 * rows, checked that each printed balance followed from the last, and called
 * that proof.
 *
 * It is not quite proof. Row-wise continuity tests the *links* in the chain and
 * cannot tell that the chain ended early: a reader that stops one row short of
 * the statement produces rows that reconcile perfectly with each other and a
 * ledger short one payment. What catches that is the bank's own control totals. `CLOSING BALANCE` and `TRANSACTION TOTAL` are the numbers
 * the bank is prepared to be held to, and comparing them against what was read is
 * strictly stronger than continuity — it is the difference between "these rows
 * are consistent with each other" and "these are all the rows".
 *
 * Everything here is nullable and everything here is optional. A statement that
 * prints none of it is still importable; it is simply one with less evidence
 * behind it, and the verdict says so rather than the import failing.
 */
import { CalendarDate } from "@/core/time";
import { Currency, Money } from "@/core/money";
import { readAmount, readDate, type DateOrder } from "./statements";

export interface StatementHeader {
  /**
   * The last four digits of the account number, and nothing else.
   *
   * Deliberately lossy. The full number is enough to identify the person to
   * anyone who reads the database, it is never needed to answer the only
   * question asked of it — "is this the account you selected?" — and a diagnostic
   * blob is the last place it should be preserved forever.
   */
  readonly accountSuffix: string | null;
  readonly period: { readonly from: CalendarDate; readonly to: CalendarDate } | null;
  readonly printedClosing: Money | null;
  readonly printedTotals: { readonly debit: Money; readonly credit: Money } | null;
}

export const EMPTY_HEADER: StatementHeader = {
  accountSuffix: null,
  period: null,
  printedClosing: null,
  printedTotals: null,
};

/**
 * A labelled account number.
 *
 * Kept generic on purpose: the label is any of the words banks use, the
 * punctuation between label and value is anything at all, and the number may be
 * masked with `X` or `*`, which most banks do. What it will not match is a
 * bare run of digits — a reference number, a phone number and an IFSC-adjacent
 * code all look like one, and guessing wrong here means warning the user that
 * they picked the wrong account when they did not.
 */
const ACCOUNT = /\b(?:a\/c|acct|account)\s*(?:number|no|num|#)?\s*[:\-]?\s*([0-9Xx*]{6,})/i;

/** `From : 01-05-2025 To : 31-12-2025`, in any of the spellings banks use. */
const PERIOD =
  /\bfrom\s*[:\-]?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}-\d{2}-\d{2})\s*(?:to|-|–|until)\s*[:\-]?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}-\d{2}-\d{2})/i;

/** A money figure as a statement prints one: grouped, two decimals, maybe signed. */
const FIGURE = /-?(?:\d{1,3}(?:,\d{2,3})*|\d+)?\.\d{2}/g;

/** The label a bank puts against the balance it ends on. */
const CLOSING = /\bclosing\s+balance\b|\bbalance\s+as\s+on\b|\bend(?:ing)?\s+balance\b/i;

/** The label above the debit/credit control totals. */
const TOTALS = /\btransaction\s+total\b|\btotal\s+(?:debit|withdrawal)/i;

/** Every money figure on a line, largest-to-smallest untouched — page order. */
function figures(line: string, currency: Currency): Money[] {
  const found: Money[] = [];
  for (const match of line.matchAll(FIGURE)) {
    const { amount } = readAmount(match[0], currency);
    if (amount) found.push(amount);
  }
  return found;
}

/**
 * Read the four facts from a statement's text.
 *
 * Only the first and last few lines are searched, and that is a correctness
 * measure rather than a speed one: `CLOSING BALANCE` appears in the *narration*
 * of a real transaction often enough, and scanning the whole file would let a
 * row's description supply the control total it is meant to be checked against.
 */
export function readStatementHeader(
  lines: readonly string[],
  currency: Currency = Currency.reporting,
  dateOrder: DateOrder = "DMY",
): StatementHeader {
  const head = lines.slice(0, HEAD_LINES);
  const tail = lines.slice(-TAIL_LINES);

  let accountSuffix: string | null = null;
  let period: StatementHeader["period"] = null;
  for (const line of head) {
    if (accountSuffix === null) {
      const digits = ACCOUNT.exec(line)?.[1]?.replace(/[^0-9]/g, "");
      if (digits && digits.length >= 4) accountSuffix = digits.slice(-4);
    }
    if (period === null) {
      const match = PERIOD.exec(line);
      const from = match ? readDate(match[1]!, dateOrder) : null;
      const to = match ? readDate(match[2]!, dateOrder) : null;
      // A period running backwards is a misread, not a period.
      if (from && to && from.toISO() <= to.toISO()) period = { from, to };
    }
  }

  /*
   * The *last* match wins, not the first. A bank's trailer is long - Axis prints
   * seventeen lines of legend and a disclaimer that itself says "the closing
   * balance as shown" - so the window has to be generous, and a generous window
   * on a short statement reaches back into the transactions. Reading from the
   * end means a narration that happens to contain the words loses to the summary
   * line that actually carries the figures.
   */
  let printedClosing: Money | null = null;
  let printedTotals: StatementHeader["printedTotals"] = null;
  for (const line of tail) {
    if (CLOSING.test(line)) {
      // The label's own line may carry a date and a balance; the balance is the
      // last figure on it, because the label precedes the number it names.
      const found = figures(line, currency).at(-1);
      if (found) printedClosing = found;
    }
    if (TOTALS.test(line)) {
      const found = figures(line, currency);
      // Debit then credit, in the order the columns are printed.
      if (found.length >= 2) printedTotals = { debit: found[0]!, credit: found[1]! };
    }
  }

  return { accountSuffix, period, printedClosing, printedTotals };
}

/** How much of the top of the file can hold the account number and period. */
const HEAD_LINES = 40;

/**
 * How much of the bottom can hold the control totals.
 *
 * Wide because the figures are not at the bottom: on a real Axis statement the
 * transaction totals sit 42 lines from the end, behind a legend of seventeen
 * abbreviations, a branch address and a disclaimer. Forty lines missed them by
 * two, and the check silently reported ABSENT on the one file it was built for.
 */
const TAIL_LINES = 150;

/** Does the statement's own account number match the one being imported into? */
export function accountMatches(header: StatementHeader, suffix: string | null): boolean | null {
  if (!header.accountSuffix || !suffix) return null;
  return header.accountSuffix === suffix.replace(/[^0-9]/g, "").slice(-4);
}

/** Do two statement periods overlap, and by how much? */
export function periodsOverlap(
  a: NonNullable<StatementHeader["period"]>,
  b: NonNullable<StatementHeader["period"]>,
): boolean {
  return a.from.toISO() <= b.to.toISO() && b.from.toISO() <= a.to.toISO();
}

/**
 * The gap between a period and the one that should follow it, in days.
 *
 * Zero or one day is contiguous — statements normally abut, and a bank that ends
 * on the 31st and starts the next on the 1st has left no gap. Anything larger is
 * a stretch of time with no transactions on record, which is invisible in every
 * report and silently wrong in all of them.
 */
export function gapInDays(
  earlier: NonNullable<StatementHeader["period"]>,
  later: NonNullable<StatementHeader["period"]>,
): number {
  const from = Date.parse(`${later.from.toISO()}T00:00:00Z`);
  const to = Date.parse(`${earlier.to.toISO()}T00:00:00Z`);
  return Math.round((from - to) / 86_400_000) - 1;
}

/** Internals, exposed for the spec — not part of the module's contract. */
export const __test__ = { figures, ACCOUNT, PERIOD };

/** Re-exported so callers need not reach for `@/core/time` to read a period. */
export type { CalendarDate };
