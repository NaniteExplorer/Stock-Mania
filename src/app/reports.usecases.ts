/**
 * Reporting use cases: the three statements, the personal metrics, the net-worth
 * series, and the tax report with its provenance.
 *
 * Every one of these is a **read**. Nothing here writes, which is why a report can
 * be regenerated for any past date and will not have drifted — and it is the whole
 * argument for computing rather than storing. v1's dashboard read stored totals
 * that a failed nightly job had left a month behind, and nothing said so.
 *
 * The tax report is the one with an opinion worth reading before the code: **it
 * carries its provenance**. Every line names the rule that produced it, the regime
 * version that rule came from, and the inputs it used, so "why is this ₹37,500?"
 * has an answer three years later when the rates have changed twice.
 */

import { AppError, Err, NotFoundError, Ok, Result, UseCase, UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate, DateRange, FinancialYear } from "@/core/time";
import { AccountRepository, AccountTypeName } from "@/domain/accounts";
import { CardTermsRepository, CashAsset, liquidPositions, totalLiquid } from "@/domain/assets";
import { BalanceQuery } from "@/domain/transactions";
import { InstrumentRepository } from "@/domain/instruments";
import { LotBook, LotRepository } from "@/domain/lots";
import { PriceLookup } from "@/domain/instruments";
import {
  AllocationBucket,
  BalanceSheet,
  CashflowLine,
  CashflowStatement,
  IncomeStatement,
  NetWorthPoint,
  PersonalMetrics,
  ReportedBalance,
  allocationByClass,
  balanceSheet,
  cashflowCategoryFor,
  cashflowStatement,
  checkAccountingIdentity,
  checkContinuity,
  incomeStatement,
  personalMetrics,
} from "@/domain/reports";
import {
  CarryForward,
  TaxAssessment,
  TaxEngine,
  TaxSettings,
  TaxableEvent,
} from "@/domain/tax";

/* ═══ Shared ══════════════════════════════════════════════════════════ */

/** Turns the read side's balances into what the report functions consume. */
function toReported(
  rows: readonly {
    accountId: { value: string };
    code: string;
    name: string;
    type: AccountTypeName;
    subtype: string | null;
    balance: Money;
  }[],
): readonly ReportedBalance[] {
  return rows.map((row) => ({
    accountId: row.accountId.value,
    code: row.code,
    name: row.name,
    type: row.type,
    subtype: row.subtype,
    balance: row.balance,
  }));
}

/* ═══ The three statements ════════════════════════════════════════════ */

export interface StatementsInput {
  userId: UserId;
  asOf: CalendarDate;
  /** The period the income statement and cash flow cover. */
  period: DateRange;
}

export interface StatementsOutput {
  readonly balanceSheet: BalanceSheet;
  readonly incomeStatement: IncomeStatement;
  readonly cashflow: CashflowStatement;
  readonly allocation: readonly AllocationBucket[];
  /** B02, checked on the same data the statements were built from. */
  readonly identityHolds: boolean;
  readonly identityDifference: Money;
}

/**
 * The three financial statements, from one set of balances.
 *
 * They are built from **the same query result**, deliberately: three statements
 * assembled from three separate reads can disagree if anything is written between
 * them, and "the balance sheet and the income statement disagree" is the single
 * most corrosive thing a finance app can show. One read, three views, and B02
 * checked across them.
 */
export class BuildStatements implements UseCase<StatementsInput, StatementsOutput> {
  constructor(private readonly balances: BalanceQuery) {}

  async execute(input: StatementsInput): Promise<Result<StatementsOutput, AppError>> {
    const [cumulative, opening, flows, periodFlows] = await Promise.all([
      this.balances.balanceSheet(input.userId, input.asOf, { includeClosed: true }),
      // The same sheet at the start of the period, so a cash-flow statement can be
      // built from the *movement* in every account rather than only from the income
      // and expense accounts — which is what makes it tie to the change in cash.
      this.balances.balanceSheet(input.userId, input.period.start.plusDays(-1), {
        includeClosed: true,
      }),
      // Cumulative income and expense, for B02 — the identity is about all history.
      this.balances.flowsByAccount(
        input.userId,
        DateRange.of(CalendarDate.parse("1900-01-01"), input.asOf),
        { rollUp: false },
      ),
      this.balances.flowsByAccount(input.userId, input.period, { rollUp: false }),
    ]);

    const cashOf = (rows: readonly { type: AccountTypeName; subtype: string | null; balance: Money }[]) =>
      Money.total(
        rows
          .filter((row) => row.type === "ASSET" && CASH_SUBTYPES.has(row.subtype ?? ""))
          .map((row) => row.balance),
      );
    const openingCash = cashOf(opening);
    const closingCash = cashOf(cumulative);

    const sheetRows = toReported(cumulative);
    const cumulativeFlowRows = flows.map((flow) => ({
      accountId: flow.accountId.value,
      code: flow.code,
      name: flow.name,
      type: flow.type,
      subtype: null,
      balance: flow.amount,
    }));
    const periodFlowRows = periodFlows.map((flow) => ({
      accountId: flow.accountId.value,
      code: flow.code,
      name: flow.name,
      type: flow.type,
      subtype: null,
      balance: flow.amount,
    }));

    const identity = checkAccountingIdentity([...sheetRows, ...cumulativeFlowRows]);

    /*
     * The cash-flow statement, built so that it *reconciles*.
     *
     * Operating is the income statement. Investing and financing are the **movements
     * in the balance-sheet accounts** over the period: money that went into a
     * deposit or a holding left cash, and a loan drawn down brought cash in. A
     * statement built only from income and expense accounts — the obvious version —
     * cannot tie to the change in cash, because the money that moved into a fixed
     * deposit never touched an expense account.
     *
     * With every account accounted for, the identity is exact:
     *
     *     Δcash = (income − expenses) − Δ(non-cash assets) + Δ(liabilities) + Δ(equity)
     *
     * which is B02 differenced over the period, and `reconciles` asserts it.
     */
    const openingById = new Map(opening.map((row) => [row.accountId.value, row.balance]));
    const movementLines: CashflowLine[] = cumulative
      .filter((row) => !(row.type === "ASSET" && CASH_SUBTYPES.has(row.subtype ?? "")))
      .flatMap((row) => {
        const before = openingById.get(row.accountId.value) ?? Money.zero(row.balance.currency);
        const change = row.balance.minus(before);
        if (change.isZero) return [];
        // An asset growing consumes cash; a liability or equity growing provides it.
        const amount = row.type === "ASSET" ? change.negated() : change;
        return [
          {
            category: cashflowCategoryFor(row.type, row.subtype),
            label: row.name,
            amount,
          },
        ];
      });

    const lines: CashflowLine[] = [
      ...periodFlowRows.map((row) => ({
        category: cashflowCategoryFor(row.type, row.subtype),
        label: row.name,
        // An income arriving is money in; an expense is money out.
        amount: row.type === "INCOME" ? row.balance : row.balance.negated(),
      })),
      ...movementLines,
    ];

    return Ok({
      balanceSheet: balanceSheet(sheetRows, input.asOf),
      incomeStatement: incomeStatement(periodFlowRows, input.period),
      cashflow: cashflowStatement({
        period: input.period,
        openingCash,
        closingCash,
        lines,
      }),
      allocation: allocationByClass(sheetRows),
      identityHolds: identity.holds,
      identityDifference: identity.difference,
    });
  }

}

const CASH_SUBTYPES = new Set(["BANK", "SAVINGS", "CASH", "WALLET"]);

/* ═══ Net worth over time ═════════════════════════════════════════════ */

export interface NetWorthSeriesInput {
  userId: UserId;
  /** Month ends, oldest first. */
  months: number;
  asOf: CalendarDate;
}

export interface NetWorthSeriesOutput {
  readonly series: readonly NetWorthPoint[];
  /** B03 — a backdated write that was not propagated shows up here. */
  readonly continuityHolds: boolean;
}

/**
 * Net worth at each month end.
 *
 * Recomputed from the journal at every point rather than read from a snapshot
 * table, so a transaction backdated last week changes last year's chart — which is
 * correct, and is exactly what a stored snapshot cannot do. `net_worth_snapshots`
 * exists as a cache and this is what would rebuild it.
 */
export class NetWorthSeries implements UseCase<NetWorthSeriesInput, NetWorthSeriesOutput> {
  constructor(private readonly balances: BalanceQuery) {}

  async execute(input: NetWorthSeriesInput): Promise<Result<NetWorthSeriesOutput, AppError>> {
    const points: NetWorthPoint[] = [];
    for (let index = input.months - 1; index >= 0; index -= 1) {
      const on = input.asOf.plusMonths(-index).endOfMonth();
      const totals = await this.balances.totals(input.userId, on);
      points.push({
        on,
        assets: totals.assets,
        liabilities: totals.liabilities,
        netWorth: totals.netWorth,
      });
    }

    return Ok({ series: points, continuityHolds: checkContinuity(points).holds });
  }
}

/* ═══ Personal metrics ════════════════════════════════════════════════ */

export interface PersonalReportInput {
  userId: UserId;
  asOf: CalendarDate;
  /** Which expense accounts count as non-discretionary. The user's judgement. */
  essentialExpenseCodes?: readonly string[];
}

export interface PersonalReportOutput extends PersonalMetrics {
  readonly liquidAccounts: readonly string[];
}

/**
 * The personal-finance metrics of §4.4.
 *
 * `essentialExpenseCodes` is an input rather than a shipped list, because which
 * spending is non-discretionary is a fact about a person's life: a car loan is
 * essential to someone who commutes 40km and discretionary to someone who does
 * not. A library that decided this would compute a runway figure that is wrong for
 * most of its users while looking authoritative.
 */
export class PersonalReport implements UseCase<PersonalReportInput, PersonalReportOutput> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly balances: BalanceQuery,
    /**
     * Card terms, for the credit-utilisation figure.
     *
     * Optional, and the optionality is the honest part: with no terms repository
     * the total limit is unknown, and `personalMetrics` reports
     * `creditUtilisation: null` rather than 0% — which would read as "no credit
     * used" when it means "we do not know the limit".
     */
    private readonly cardTerms?: CardTermsRepository,
  ) {}

  async execute(input: PersonalReportInput): Promise<Result<PersonalReportOutput, AppError>> {
    const essential = new Set(input.essentialExpenseCodes ?? DEFAULT_ESSENTIALS);
    const twelveMonths = DateRange.of(input.asOf.plusMonths(-11).startOfMonth(), input.asOf);

    const [accounts, totals, sheet, flows, monthly] = await Promise.all([
      this.accounts.list(input.userId, { includeClosed: false }),
      this.balances.totals(input.userId, input.asOf),
      this.balances.balanceSheet(input.userId, input.asOf, { includeClosed: true }),
      this.balances.flowsByAccount(input.userId, twelveMonths, { rollUp: false }),
      this.balances.monthlyFlows(input.userId, twelveMonths),
    ]);

    const positions = await liquidPositions(accounts, input.asOf, this.balances);
    const liquid = totalLiquid(positions);

    const income = Money.total(flows.filter((flow) => flow.type === "INCOME").map((flow) => flow.amount));
    const expenses = Money.total(flows.filter((flow) => flow.type === "EXPENSE").map((flow) => flow.amount));

    /*
     * Essential spending, month by month, so the burn rate is a trailing mean of
     * actual months rather than a twelfth of a year — a year with one enormous
     * month averages to something nobody ever spent.
     */
    const essentialTotal = Money.total(
      flows.filter((flow) => flow.type === "EXPENSE" && essential.has(flow.code)).map((flow) => flow.amount),
    );
    const monthsWithData = Math.max(1, monthly.length);
    const essentialPerMonth = essentialTotal.dividedBy(BigInt(monthsWithData), "HALF_UP");

    const cards = sheet.filter((row) => row.subtype === "CREDIT_CARD");
    const cardBalances = Money.total(cards.map((row) => row.balance));

    /*
     * The limits come from the card *terms*, not from the ledger: a credit limit
     * is a contractual fact with no posting behind it, so there is nothing in the
     * journal to derive it from. Cards whose terms are missing are excluded from
     * both sides of the ratio — counting a balance whose limit is unknown would
     * inflate utilisation towards infinity as terms went missing.
     */
    const terms = this.cardTerms
      ? await this.cardTerms.findManyFor(
          input.userId,
          cards.map((row) => row.accountId),
        )
      : new Map<string, { creditLimit: Money }>();
    const withTerms = cards.filter((row) => terms.has(row.accountId.value));
    const cardLimits = Money.total(
      withTerms.map((row) => terms.get(row.accountId.value)!.creditLimit),
      Currency.reporting,
    );
    const measuredBalances = this.cardTerms
      ? Money.total(withTerms.map((row) => row.balance), Currency.reporting)
      : cardBalances;

    const metrics = personalMetrics({
      netWorth: totals.netWorth,
      liquidNetWorth: liquid,
      periodIncome: income,
      periodExpenses: expenses,
      essentialMonthlyExpenses: Array.from({ length: monthsWithData }, () => essentialPerMonth),
      // Debt payments and limits are only knowable from the products, which the
      // caller may not have loaded; zero here means "not measured", and the metric
      // returns null rather than a misleading 0%.
      monthlyDebtPayments: Money.zero(Currency.reporting),
      monthlyGrossIncome: income.dividedBy(BigInt(monthsWithData), "HALF_UP"),
      cardBalances: measuredBalances,
      cardLimits,
    });

    return Ok({
      ...metrics,
      liquidAccounts: positions.map((position) => position.asset.displayName),
    });
  }
}

const DEFAULT_ESSENTIALS: readonly string[] = [
  "Expenses:Housing:Rent",
  "Expenses:Housing:Maintenance",
  "Expenses:Utilities:Electricity",
  "Expenses:Utilities:Gas",
  "Expenses:Utilities:Water",
  "Expenses:Utilities:Internet",
  "Expenses:Utilities:Mobile",
  "Expenses:Food:Groceries",
  "Expenses:Health:Medical",
  "Expenses:Insurance",
  "Expenses:Transport:Fuel",
  "Expenses:Education",
];

/* ═══ Tax report ══════════════════════════════════════════════════════ */

export interface TaxReportInput {
  userId: UserId;
  financialYear: FinancialYear;
  settings: TaxSettings;
  /** Losses brought forward from earlier years. */
  broughtForward?: readonly CarryForward[];
}

export interface TaxReportOutput {
  readonly assessment: TaxAssessment;
  /** Every taxable event that went in, so a line can be traced to a disposal. */
  readonly events: readonly TaxableEvent[];
}

/**
 * The tax report for a financial year.
 *
 * The events come from the **stored disposals**, whose holding days and tax tier
 * were fixed at the moment of sale — so re-running last year's report after a
 * budget produces last year's number. That is the property the whole
 * regime-versioning design exists for, and it would be lost if the report
 * recomputed holding periods against today's thresholds.
 */
export class TaxReport implements UseCase<TaxReportInput, TaxReportOutput> {
  constructor(
    private readonly lots: LotRepository,
    private readonly instruments: InstrumentRepository,
    private readonly engine: TaxEngine = new TaxEngine(),
  ) {}

  async execute(input: TaxReportInput): Promise<Result<TaxReportOutput, AppError>> {
    const disposals = await this.lots.disposalsWithin(
      input.userId,
      input.financialYear.start,
      input.financialYear.end,
    );
    const instruments = await this.instruments.list(input.userId, { includeClosed: true });
    const byId = new Map(instruments.map((instrument) => [instrument.id.value, instrument]));

    const events: TaxableEvent[] = disposals.map((disposal, index) => {
      const instrument = byId.get(disposal.instrumentId.value);
      const profile = instrument?.taxProfile();
      return {
        id: `${disposal.lotId?.value ?? "avg"}-${index}`,
        kind: "CAPITAL_GAIN",
        onDate: disposal.disposedOn,
        // The instrument's own answer, which is where the difference between a debt
        // fund and an equity fund lives. The engine never learns what either is.
        taxCategory: profile?.category ?? "LISTED_EQUITY",
        instrumentId: disposal.instrumentId.value,
        acquiredOn: disposal.acquiredOn,
        holdingDays: disposal.holdingDays,
        proceeds: disposal.proceeds,
        costBasis: disposal.costBasis,
        gain: disposal.gain,
        // Only the deductible part — STT is a real cost and never deductible.
        deductibleCharges: disposal.buyCharges.plus(disposal.sellCharges),
        fmvOnGrandfatherDate: null,
        sourceTransactionId: disposal.lotId?.value ?? "average-cost",
        sourceLotId: disposal.lotId?.value ?? null,
      };
    });

    return Ok({
      assessment: this.engine.assess(input.financialYear, events, input.settings, {
        broughtForwardLosses: input.broughtForward,
      }),
      events,
    });
  }
}

/* ═══ Tax-loss harvesting ═════════════════════════════════════════════ */

export interface HarvestSuggestion {
  readonly instrumentId: string;
  readonly symbol: string;
  readonly units: string;
  readonly unrealisedLoss: Money;
  readonly holdingDays: number;
  readonly term: "SHORT_TERM" | "LONG_TERM";
  /** Whether the loss can be set off at all. Crypto losses cannot. */
  readonly setOffAllowed: boolean;
  readonly note: string;
}

export interface HarvestInput {
  userId: UserId;
  asOf: CalendarDate;
  /** Realised gains so far this year, which a harvest would offset. */
  realisedGains: Money;
}

export interface HarvestOutput {
  readonly suggestions: readonly HarvestSuggestion[];
  readonly harvestableLoss: Money;
  /** What could be offset, capped by the gains there are to offset. */
  readonly offsettable: Money;
  readonly caveats: readonly string[];
}

/**
 * Tax-loss harvesting suggestions.
 *
 * Positions worth less than they cost, ranked by the loss available. The caveats
 * are part of the output rather than left to the reader, because three of them
 * change whether the idea is worth acting on at all:
 *
 *   - **A crypto loss cannot be set off against anything**, so it is listed and
 *     marked rather than counted.
 *   - **Short-term losses are more valuable than long-term ones**, because they
 *     offset short-term gains taxed at 20% rather than long-term at 12.5% — so the
 *     ranking is by tax saved, not by loss size.
 *   - **India has no wash-sale rule**, so a position can be sold and bought back
 *     the same day. That is a real and legal difference from the US, and stating it
 *     is more useful than the vague warning most tools give.
 *
 * These are suggestions about tax, not advice about investing: a position is not
 * worth selling merely because it is down.
 */
export class SuggestHarvest implements UseCase<HarvestInput, HarvestOutput> {
  constructor(
    private readonly instruments: InstrumentRepository,
    private readonly lots: LotRepository,
    private readonly prices: PriceLookup,
  ) {}

  async execute(input: HarvestInput): Promise<Result<HarvestOutput, AppError>> {
    const held = await this.instruments.list(input.userId, { includeClosed: false });
    const suggestions: HarvestSuggestion[] = [];

    for (const instrument of held) {
      const openLots = (await this.lots.openLots(input.userId, instrument.id)).filter(
        (lot) => !lot.isExhausted,
      );
      if (openLots.length === 0) continue;

      const position = LotBook.openPosition(openLots, instrument.currency);
      const valuation = await instrument.valueOn(position.quantity, input.asOf, this.prices);
      if (!valuation.value) continue;

      const cost = position.cost.plus(position.charges);
      const loss = cost.minus(valuation.value);
      if (!loss.isPositive) continue;

      // The oldest open lot's age, which is what decides the term for the bulk of a
      // typical position.
      const oldest = openLots.reduce(
        (earliest, lot) => (lot.acquiredOn.isBefore(earliest.acquiredOn) ? lot : earliest),
        openLots[0],
      );
      const holdingDays = oldest.acquiredOn.daysUntil(input.asOf);
      const profile = instrument.taxProfile();

      suggestions.push({
        instrumentId: instrument.id.value,
        symbol: instrument.symbol,
        units: position.quantity.toDecimalString(),
        unrealisedLoss: loss,
        holdingDays,
        term: holdingDays >= 365 ? "LONG_TERM" : "SHORT_TERM",
        setOffAllowed: profile.lossesSetOffAllowed,
        note: profile.lossesSetOffAllowed
          ? holdingDays >= 365
            ? "A long-term loss offsets long-term gains, taxed at the lower rate — worth less than a short-term one."
            : "A short-term loss offsets short-term gains, which are taxed at the higher rate."
          : `${instrument.symbol} is a virtual digital asset: its losses cannot be set off against anything, or carried forward.`,
      });
    }

    // Ranked by tax saved rather than by loss size: a short-term loss offsets a
    // gain taxed at 20% and a long-term one at 12.5%.
    const ranked = [...suggestions].sort((a, b) => {
      if (a.setOffAllowed !== b.setOffAllowed) return a.setOffAllowed ? -1 : 1;
      if (a.term !== b.term) return a.term === "SHORT_TERM" ? -1 : 1;
      return b.unrealisedLoss.compareTo(a.unrealisedLoss);
    });

    const harvestable = Money.total(
      ranked.filter((suggestion) => suggestion.setOffAllowed).map((suggestion) => suggestion.unrealisedLoss),
    );

    return Ok({
      suggestions: ranked,
      harvestableLoss: harvestable,
      offsettable: harvestable.isGreaterThan(input.realisedGains) ? input.realisedGains : harvestable,
      caveats: [
        "India has no wash-sale rule: a holding may be sold and bought back the same day, and the loss still counts.",
        "A loss is only worth realising if there is a gain to set it against, or if it can be carried forward — eight assessment years, and only if the return is filed on time.",
        "Crypto losses cannot be set off against anything, including other crypto gains.",
        "This is about tax, not about whether the investment is worth keeping.",
      ],
    });
  }
}
