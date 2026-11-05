/**
 * DESIGN.md §9c: the Debt nav group header's three figures.
 *
 * Pure so it can be tested without a database. The layout gathers the balances from
 * the existing card and loan usecases and passes them in; either side being
 * unavailable (`null`) means the figures are unknown, and an unknown figure is not
 * shown at all rather than drawn as `₹0` (§3). With no cards and no loans there is
 * nothing to owe and nothing to show.
 *
 * - **Total outstanding**: cards owed + loans booked outstanding, exact paise.
 * - **Blended rate**: loans only (§9c: cards are never averaged in), weighted by booked
 *   outstanding, from each loan's stored nominal annual rate. Computed in BigInt on
 *   minor units × scaled rate and rounded once (HALF_UP) to `Percentage`'s six places.
 *   Every loan stores a rate (the domain requires one), so coverage is always complete
 *   for loans. Hidden when no loan carries a positive balance.
 * - **Monthly outgo**: loan instalments (stored terms). Card minimums are not stored —
 *   the card list substitutes default terms when none were recorded, so a minimum
 *   cannot be told apart from an invented one here. When any card carries a balance
 *   the figure is labelled "loans only" rather than claiming to be the whole outgo.
 */

import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { formatMoney, formatPercent } from "@/ui/format";

/** One loan as the header needs it. `annualRate` is the stored nominal rate. */
export interface DebtHeaderLoan {
  readonly outstanding: Money;
  readonly annualRate: Percentage;
  readonly instalment: Money;
}

export interface DebtHeaderFigures {
  totalOutstanding: string;
  /** Loans only, balance-weighted; `null` when unknown (no loan with a balance). */
  blendedRate: string | null;
  /** Loan instalments; `null` when there are no loans with a balance. */
  monthlyOutgo: string | null;
  /** True when a card carries a balance, so the outgo leaves card minimums out. */
  outgoLoansOnly: boolean;
}

/** Σ(outstanding × rate) ÷ Σ outstanding over loans with a positive balance; exact, rounded once. */
export function blendedLoanRate(loans: readonly DebtHeaderLoan[]): Percentage | null {
  const weighted = loans.filter((loan) => loan.outstanding.isPositive);
  if (weighted.length === 0) return null;
  const currency = weighted[0].outstanding.currency.code;
  if (weighted.some((loan) => loan.outstanding.currency.code !== currency)) return null;
  let numerator = 0n;
  let denominator = 0n;
  for (const loan of weighted) {
    numerator += loan.outstanding.minor * loan.annualRate.scaled;
    denominator += loan.outstanding.minor;
  }
  // HALF_UP once; both operands are non-negative.
  return Percentage.fromScaled((numerator * 2n + denominator) / (denominator * 2n));
}

export function debtHeaderFigures(
  cardOwed: readonly Money[] | null,
  loanOutstanding: readonly Money[] | null,
  loans: readonly DebtHeaderLoan[] | null = null,
): DebtHeaderFigures | null {
  if (cardOwed === null || loanOutstanding === null) return null;
  const all = [...cardOwed, ...loanOutstanding];
  if (all.length === 0) return null;
  let totalOutstanding: string;
  try {
    totalOutstanding = formatMoney(Money.total(all, all[0].currency));
  } catch {
    // Mixed currencies cannot be summed exactly; an unknown figure is hidden.
    return null;
  }

  const rate = loans === null ? null : blendedLoanRate(loans);
  let monthlyOutgo: string | null = null;
  const active = loans?.filter((loan) => loan.outstanding.isPositive) ?? [];
  if (active.length > 0) {
    try {
      monthlyOutgo = formatMoney(Money.total(active.map((loan) => loan.instalment), active[0].instalment.currency));
    } catch {
      monthlyOutgo = null;
    }
  }

  return {
    totalOutstanding,
    blendedRate: rate === null ? null : formatPercent(rate),
    monthlyOutgo,
    outgoLoansOnly: cardOwed.some((owed) => owed.isPositive),
  };
}
