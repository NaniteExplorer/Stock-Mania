/**
 * The three financial statements, and the personal-finance metrics that sit on
 * top of them.
 *
 * Everything here is a **fold over balances that already exist**. There is no
 * report table, no stored total and no nightly rollup: a balance sheet is the
 * account balances grouped by type, an income statement is the same balances over
 * a period, and net worth is one subtraction. That is why B02 can be asserted at
 * *every* date rather than at month ends — there is nothing to fall out of step.
 *
 * B02 is the identity that makes the three statements one system:
 *
 *     assets − liabilities = equity + (income − expenses)
 *
 * It holds because every transaction balances, and it is checked rather than
 * assumed — a violation means the ledger is corrupt, not that the report is wrong.
 */

import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { AccountType, AccountTypeName } from "@/domain/accounts";

/* ═══ Inputs ══════════════════════════════════════════════════════════ */

/**
 * One account's balance, as the read side already produces it.
 *
 * Deliberately the shape of `AccountBalance` rather than a new one: reports
 * consume what `BalanceQuery` returns, so there is no mapping layer to disagree
 * with either side.
 */
export interface ReportedBalance {
  readonly accountId: string;
  readonly code: string;
  readonly name: string;
  readonly type: AccountTypeName;
  readonly subtype: string | null;
  readonly balance: Money;
}

export interface StatementSection {
  readonly label: string;
  readonly rows: readonly ReportedBalance[];
  readonly total: Money;
}

/* ═══ Balance sheet ═══════════════════════════════════════════════════ */

export interface BalanceSheet {
  readonly asOf: CalendarDate;
  readonly assets: StatementSection;
  readonly liabilities: StatementSection;
  readonly equity: StatementSection;
  readonly netWorth: Money;
  /**
   * `assets − liabilities − equity`. Zero when the books balance *and* every
   * income and expense has been closed into equity; non-zero in a live ledger,
   * where it equals retained earnings for the period — which is exactly what
   * {@link checkAccountingIdentity} tests.
   */
  readonly unclosedEarnings: Money;
}

export function balanceSheet(balances: readonly ReportedBalance[], asOf: CalendarDate): BalanceSheet {
  const assets = section("Assets", balances.filter((row) => row.type === "ASSET"));
  const liabilities = section("Liabilities", balances.filter((row) => row.type === "LIABILITY"));
  const equity = section("Equity", balances.filter((row) => row.type === "EQUITY"));

  return {
    asOf,
    assets,
    liabilities,
    equity,
    netWorth: assets.total.minus(liabilities.total),
    unclosedEarnings: assets.total.minus(liabilities.total).minus(equity.total),
  };
}

/* ═══ Income statement ════════════════════════════════════════════════ */

export interface IncomeStatement {
  readonly period: DateRange;
  readonly income: StatementSection;
  readonly expenses: StatementSection;
  /** `income − expenses`. Positive is a surplus. */
  readonly net: Money;
  /** `net / income`, the savings rate. `null` when nothing came in. */
  readonly savingsRate: Percentage | null;
}

export function incomeStatement(
  flows: readonly ReportedBalance[],
  period: DateRange,
): IncomeStatement {
  const income = section("Income", flows.filter((row) => row.type === "INCOME"));
  const expenses = section("Expenses", flows.filter((row) => row.type === "EXPENSE"));
  const net = income.total.minus(expenses.total);

  return {
    period,
    income,
    expenses,
    net,
    savingsRate: income.total.isZero ? null : Percentage.ratio(net, income.total),
  };
}

/* ═══ Cash flow ═══════════════════════════════════════════════════════ */

export type CashflowCategory = "OPERATING" | "INVESTING" | "FINANCING";

export interface CashflowLine {
  readonly category: CashflowCategory;
  readonly label: string;
  readonly amount: Money;
}

export interface CashflowStatement {
  readonly period: DateRange;
  readonly lines: readonly CashflowLine[];
  readonly operating: Money;
  readonly investing: Money;
  readonly financing: Money;
  readonly netChange: Money;
  readonly openingCash: Money;
  readonly closingCash: Money;
  /** Whether the statement reconciles: opening + net change = closing. */
  readonly reconciles: boolean;
}

/**
 * A cash-flow statement, in the three sections a personal balance sheet has.
 *
 * The categorisation is by *account subtype*, not by transaction kind, and that is
 * the decision worth stating: salary into a bank account and a grocery payment are
 * both operating; money into a deposit or a holding is investing; a loan drawdown
 * or an EMI's principal is financing. Reading it off the account means a new
 * transaction type lands in the right section without this file being told.
 *
 * The reconciliation is returned rather than asserted, because a mismatch is a
 * fact about the data — usually a cash account whose subtype nobody set — and a
 * report that threw would hide the rest of the numbers over it.
 */
export function cashflowStatement(input: {
  period: DateRange;
  openingCash: Money;
  closingCash: Money;
  lines: readonly CashflowLine[];
}): CashflowStatement {
  const totalFor = (category: CashflowCategory) =>
    Money.total(
      input.lines.filter((line) => line.category === category).map((line) => line.amount),
      input.openingCash.currency,
    );

  const operating = totalFor("OPERATING");
  const investing = totalFor("INVESTING");
  const financing = totalFor("FINANCING");
  const netChange = operating.plus(investing).plus(financing);

  return {
    period: input.period,
    lines: input.lines,
    operating,
    investing,
    financing,
    netChange,
    openingCash: input.openingCash,
    closingCash: input.closingCash,
    reconciles: input.openingCash.plus(netChange).equals(input.closingCash),
  };
}

/** Which section an account's movement belongs in. */
export function cashflowCategoryFor(type: AccountTypeName, subtype: string | null): CashflowCategory {
  if (type === "INCOME" || type === "EXPENSE") return "OPERATING";
  if (type === "LIABILITY") return "FINANCING";
  if (type === "EQUITY") return "FINANCING";
  switch (subtype) {
    case "DEPOSIT":
    case "RETIREMENT":
    case "BROKERAGE":
    case "REAL_ESTATE":
    case "PRECIOUS_METAL":
    case "VEHICLE":
      return "INVESTING";
    default:
      return "OPERATING";
  }
}

/* ═══ B02 ═════════════════════════════════════════════════════════════ */

export interface AccountingIdentity {
  readonly assets: Money;
  readonly liabilities: Money;
  readonly equity: Money;
  readonly income: Money;
  readonly expenses: Money;
  /** `(assets − liabilities) − (equity + income − expenses)`. Must be zero. */
  readonly difference: Money;
  readonly holds: boolean;
}

/**
 * B02: `assets − liabilities = equity + (income − expenses)`, at any date.
 *
 * The identity every double-entry system rests on, checked directly rather than
 * inferred from "the transactions balanced". Both are true and they fail
 * differently: a transaction can balance while being posted to the wrong *type* of
 * account, and that is exactly the mistake this catches — an expense booked as an
 * asset leaves debits equal to credits and the identity broken.
 *
 * Income and expense balances are **cumulative from the beginning of time**, not
 * for a period, because the identity is about the whole history: an income
 * statement for one year does not explain a balance sheet built from ten.
 */
export function checkAccountingIdentity(balances: readonly ReportedBalance[]): AccountingIdentity {
  const totalFor = (type: AccountTypeName) =>
    Money.total(balances.filter((row) => row.type === type).map((row) => row.balance));

  const assets = totalFor("ASSET");
  const liabilities = totalFor("LIABILITY");
  const equity = totalFor("EQUITY");
  const income = totalFor("INCOME");
  const expenses = totalFor("EXPENSE");

  const left = assets.minus(liabilities);
  const right = equity.plus(income).minus(expenses);
  const difference = left.minus(right);

  return { assets, liabilities, equity, income, expenses, difference, holds: difference.isZero };
}

/* ═══ Personal-finance metrics ════════════════════════════════════════ */

export interface NetWorthPoint {
  readonly on: CalendarDate;
  readonly assets: Money;
  readonly liabilities: Money;
  readonly netWorth: Money;
}

export interface PersonalMetrics {
  readonly netWorth: Money;
  /** Restricted to accounts that can be spent today. */
  readonly liquidNetWorth: Money;
  readonly savingsRate: Percentage | null;
  /** Trailing mean of non-discretionary monthly spending. */
  readonly burnRate: Money | null;
  /** Months of liquid net worth at the burn rate. `null` when nothing is spent. */
  readonly runwayMonths: number | null;
  /** Monthly debt payments over monthly gross income. */
  readonly debtToIncome: Percentage | null;
  readonly creditUtilisation: Percentage | null;
}

export interface MetricsInput {
  readonly netWorth: Money;
  readonly liquidNetWorth: Money;
  /** Income and expenses for the period the savings rate is over. */
  readonly periodIncome: Money;
  readonly periodExpenses: Money;
  /** Monthly non-discretionary expenses, most recent last. */
  readonly essentialMonthlyExpenses: readonly Money[];
  readonly monthlyDebtPayments: Money;
  readonly monthlyGrossIncome: Money;
  readonly cardBalances: Money;
  readonly cardLimits: Money;
}

/**
 * The metrics of `30-CALCULATIONS.md` §4.4.
 *
 * Two of them are honest about not being answerable: `runwayMonths` is `null` when
 * nothing is being spent (dividing by zero would report infinite runway, which is
 * true and useless), and `debtToIncome` is `null` with no income rather than
 * infinite. Every one of these is a figure someone might make a decision on, and
 * "cannot say" is a better input to a decision than a number that means nothing.
 *
 * The **burn rate is trailing-mean over the supplied months**, and the caller
 * decides which expenses are non-discretionary — that judgement belongs to the
 * person whose money it is, not to a category list shipped in a library.
 */
export function personalMetrics(input: MetricsInput): PersonalMetrics {
  const burnRate =
    input.essentialMonthlyExpenses.length === 0
      ? null
      : Money.total(input.essentialMonthlyExpenses).dividedBy(
          BigInt(input.essentialMonthlyExpenses.length),
          "HALF_UP",
        );

  return {
    netWorth: input.netWorth,
    liquidNetWorth: input.liquidNetWorth,
    savingsRate: input.periodIncome.isZero
      ? null
      : Percentage.ratio(input.periodIncome.minus(input.periodExpenses), input.periodIncome),
    burnRate,
    runwayMonths:
      burnRate && burnRate.isPositive
        ? Number(
            (input.liquidNetWorth.minor * 100n) / burnRate.minor,
          ) / 100
        : null,
    debtToIncome: input.monthlyGrossIncome.isZero
      ? null
      : Percentage.ratio(input.monthlyDebtPayments, input.monthlyGrossIncome),
    creditUtilisation: input.cardLimits.isZero
      ? null
      : Percentage.ratio(input.cardBalances, input.cardLimits),
  };
}

/* ═══ Allocation ══════════════════════════════════════════════════════ */

export interface AllocationBucket {
  readonly label: string;
  readonly value: Money;
  readonly weight: Percentage;
}

/**
 * Net worth by asset class, from the account subtypes.
 *
 * Liabilities are excluded rather than netted: an allocation is about how the
 * *assets* are spread, and subtracting a home loan from the property bucket would
 * report a negative allocation to real estate for anyone with a mortgage.
 */
export function allocationByClass(balances: readonly ReportedBalance[]): readonly AllocationBucket[] {
  const buckets = new Map<string, Money>();
  for (const row of balances) {
    if (row.type !== "ASSET" || row.balance.isZero) continue;
    const label = ASSET_CLASS_LABELS[row.subtype ?? "OTHER"] ?? "Other";
    buckets.set(label, (buckets.get(label) ?? Money.zero(row.balance.currency)).plus(row.balance));
  }

  const total = Money.total([...buckets.values()]);
  return [...buckets.entries()]
    .map(([label, value]) => ({
      label,
      value,
      weight: total.isZero ? Percentage.ZERO : Percentage.ratio(value, total),
    }))
    .sort((a, b) => b.value.compareTo(a.value));
}

const ASSET_CLASS_LABELS: Readonly<Record<string, string>> = {
  BANK: "Cash and bank",
  SAVINGS: "Cash and bank",
  CASH: "Cash and bank",
  WALLET: "Cash and bank",
  DEPOSIT: "Deposits",
  RETIREMENT: "Retirement",
  BROKERAGE: "Investments",
  REAL_ESTATE: "Property",
  VEHICLE: "Vehicles",
  PRECIOUS_METAL: "Gold and metals",
  RECEIVABLE: "Money owed to me",
  OTHER: "Other",
};

/* ═══ Net worth over time ═════════════════════════════════════════════ */

/**
 * B03: net worth at `t` equals net worth at `t−1` plus the change at `t`.
 *
 * A series-level check rather than a point one, and it catches a different failure
 * from B02: a backdated transaction that changed an earlier month without the
 * later months being recomputed. That is the exact bug the projection cache's
 * revision vector exists to prevent, so this is the assertion that proves the
 * prevention works.
 */
export function checkContinuity(series: readonly NetWorthPoint[]): {
  holds: boolean;
  breaks: readonly { on: CalendarDate; expected: Money; actual: Money }[];
} {
  const breaks: { on: CalendarDate; expected: Money; actual: Money }[] = [];
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1];
    const current = series[index];
    const expected = previous.netWorth.plus(
      current.assets.minus(previous.assets).minus(current.liabilities.minus(previous.liabilities)),
    );
    if (!expected.equals(current.netWorth)) {
      breaks.push({ on: current.on, expected, actual: current.netWorth });
    }
  }
  return { holds: breaks.length === 0, breaks };
}

/* ═══ Shared ══════════════════════════════════════════════════════════ */

function section(label: string, rows: readonly ReportedBalance[]): StatementSection {
  const live = rows.filter((row) => !row.balance.isZero);
  return {
    label,
    rows: [...live].sort((a, b) => b.balance.compareTo(a.balance)),
    total: Money.total(live.map((row) => row.balance)),
  };
}

/** Every account type, for a caller building the sections in order. */
export const STATEMENT_ORDER: readonly AccountType[] = [
  AccountType.ASSET,
  AccountType.LIABILITY,
  AccountType.EQUITY,
  AccountType.INCOME,
  AccountType.EXPENSE,
];
