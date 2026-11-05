import type { Money } from "@/core/money";
import type { CalendarDate } from "@/core/time";
import type { CoverageGap } from "@/domain/banking";
import { formatMoney } from "@/ui/format";

/**
 * The words and arithmetic of the coverage gap notice (DESIGN.md §9a, task 0.4.s).
 *
 * Pure so the wording is tested without a database or a renderer. The page
 * supplies a `CoverageGap` from `coverageGap()`; nothing here computes a balance,
 * and nothing here posts one.
 */
export type GapNotice =
  | {
      readonly kind: "gap";
      readonly title: string;
      readonly rows: readonly { readonly label: string; readonly value: string; readonly total?: true }[];
      readonly meaning: string;
      readonly direction: "understated" | "overstated";
      readonly action: string;
    }
  | { readonly kind: "new-account"; readonly title: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2 Nov 2023` — the spec's own date form. */
export function noticeDate(date: CalendarDate): string {
  return `${date.day} ${MONTHS[date.month - 1]} ${date.year}`;
}

/** Full precision, Indian grouping, and a real minus sign (U+2212, DESIGN.md §4). */
export function signedRupees(value: Money): string {
  return formatMoney(value).replace(/^-/, "−");
}

/**
 * `null` gap renders nothing: a notice on a healthy account is one nobody reads.
 *
 * A gap whose `coveredTo` is null is an account with no earlier postings whose
 * opening was not booked (the overdrawn-first-statement hole); its balance is
 * wrong, so it still gets the full notice and the difference — only the named
 * period changes, because there is no earlier coverage to name.
 */
export function gapNotice(gap: CoverageGap | null): GapNotice | null {
  if (!gap) return null;
  const resumes = noticeDate(gap.resumesOn);
  const title = gap.coveredTo
    ? `No statements between ${noticeDate(gap.coveredTo)} and ${resumes}.`
    : `Nothing before ${resumes} is recorded, and this statement did not start from zero.`;
  // Never `abs`: the sign is the information. Positive = ledger short.
  const understated = gap.difference.isPositive;
  return {
    kind: "gap",
    title,
    rows: [
      { label: "Statement opened at", value: signedRupees(gap.impliedOpening) },
      { label: "Ledger held", value: signedRupees(gap.ledgerBalance) },
      { label: "Difference", value: signedRupees(gap.difference), total: true },
    ],
    meaning: understated
      ? `The balance shown is understated by ${signedRupees(gap.difference)} until the missing statements are imported.`
      : `The balance shown is overstated by ${signedRupees(gap.difference.negated())} until the missing statements are imported — the missing period was net spending.`,
    direction: understated ? "understated" : "overstated",
    action: "Import the missing period",
  };
}

/** The quiet line for a genuinely new account: where history starts, no difference row. */
export function newAccountNotice(firstStatementOn: CalendarDate): GapNotice {
  return {
    kind: "new-account",
    title: `This is the first statement for this account. Nothing before ${noticeDate(firstStatementOn)} is recorded.`,
  };
}
