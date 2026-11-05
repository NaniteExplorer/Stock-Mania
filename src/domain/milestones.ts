/**
 * Milestones — net worth as a multiple of a year's **expenses**.
 *
 * `PRODUCT-REQUIREMENT.md` §6: **33× expenses is the independence marker**, the
 * reciprocal of the India-calibrated 3.0% safe withdrawal rate (Saraogi 2022,
 * SSRN 4216077; Raju & Saraogi 2024 find 3.0–3.5%). **Never 25×**, which is the
 * reciprocal of the US 4% rule, and **never a multiple of income**: income says
 * what you earn, expenses say what independence must pay for.
 *
 * The multiple is computed on trailing-twelve-month expenses. Under twelve
 * months of history it **refuses**, naming the cause, rather than annualise a
 * short window — two expensive months would otherwise set the target for life.
 */

import type { Money } from "@/core/money";
import { moneyRatio } from "@/core/ratio";
import { Count, type Ratio } from "@/core/units";
import type { Citation } from "@/domain/scoring/indicators";

/** The source behind 33×, in the same shape the scoring indicators carry (task 4.3). */
export const INDEPENDENCE_CITATION: Citation = Object.freeze({
  kind: "PRIMARY",
  title: "Saraogi (2022): ~3.0% safe withdrawal rate on Indian markets",
  url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4216077",
  published: "2022",
});

export interface Milestone {
  readonly multiple: Count;
  readonly label: string;
  /** The citation shown on screen. Only the independence marker carries one. */
  readonly basis: string | null;
  /** The structured citation; present exactly when `basis` is. */
  readonly citation: Citation | null;
}

/** The fixed set. Adding an income multiple or 25× here is the defect this file exists to prevent. */
export const MILESTONES: readonly Milestone[] = Object.freeze([
  Object.freeze({ multiple: Count(10), label: "10× expenses", basis: null, citation: null }),
  Object.freeze({ multiple: Count(20), label: "20× expenses", basis: null, citation: null }),
  Object.freeze({
    multiple: Count(33),
    label: "33× expenses — independence marker",
    basis: "The reciprocal of a 3.0% safe withdrawal rate calibrated on Indian markets (Saraogi 2022, SSRN 4216077).",
    citation: INDEPENDENCE_CITATION,
  }),
]);

export interface ExpenseHistory {
  /** Months of expense data available, ending at the month being measured. */
  readonly months: Count;
  /** Spending over the trailing twelve months, in the same terms (real or nominal) as net worth. */
  readonly trailingTwelveMonths: Money;
}

export type MilestoneStanding =
  | {
      readonly state: "measured";
      readonly annualExpenses: Money;
      /** Net worth ÷ annual expenses. */
      readonly multiple: Ratio;
      readonly reached: readonly Milestone[];
      readonly next: { readonly milestone: Milestone; readonly target: Money; readonly shortBy: Money } | null;
    }
  | { readonly state: "refused"; readonly reason: string };

/** Where net worth stands against the expense milestones. */
export function milestoneStanding(netWorth: Money, expenses: ExpenseHistory): MilestoneStanding {
  if (expenses.months < 12) {
    return { state: "refused", reason: `Needs twelve months of expenses; ${expenses.months} recorded so far.` };
  }
  const annual = expenses.trailingTwelveMonths;
  if (!annual.isPositive) {
    return { state: "refused", reason: "Twelve months of expenses total zero, so no multiple of them means anything." };
  }

  // Reached is decided in exact money — "exactly 33×" must count. The multiple
  // is a statistic: divided in BigInt and rounded once (`moneyRatio`), so a large
  // valid net worth never passes through a float or a safe-integer limit.
  const crosses = (milestone: Milestone) => netWorth.compareTo(annual.times(milestone.multiple)) >= 0;
  const multiple = moneyRatio(netWorth, annual);
  const reached = MILESTONES.filter(crosses);
  const upcoming = MILESTONES.find((milestone) => !crosses(milestone)) ?? null;
  const next =
    upcoming === null
      ? null
      : { milestone: upcoming, target: annual.times(upcoming.multiple), shortBy: annual.times(upcoming.multiple).minus(netWorth) };

  return Object.freeze({ state: "measured" as const, annualExpenses: annual, multiple, reached: Object.freeze(reached), next: next && Object.freeze(next) });
}
