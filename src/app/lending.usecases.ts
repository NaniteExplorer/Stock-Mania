/**
 * Deposits, retirement schemes and loans: the use cases.
 *
 * A fifth `*.usecases.ts` file, which the target shape in `70-UPGRADE-PLAN.md`
 * does not list. It belongs here rather than in `banking.usecases.ts` for the same
 * reason `domain/deposits.ts` is not `domain/assets.ts`: these are the products
 * whose value is *computed from terms*, and the banking file is already the largest
 * in `app/`. Splitting on that line keeps each file about one thing.
 *
 * The one decision worth reading before the code: **an EMI is recorded as two
 * transactions, not one**. An instalment does two different things — it repays
 * principal (a transfer between two accounts the borrower owns) and it pays
 * interest (an expense) — and the ledger's two-legged transactions cannot express
 * both in one entry. A three-legged `LoanPayment` subclass would be better
 * accounting and is the right eventual answer; it needs a new transaction kind and
 * new legality-matrix rows, so until then each instalment posts a `Transfer` and a
 * `Charge` sharing a reference. Both are individually legal, the pair nets to the
 * instalment, and no rupee is counted twice.
 */

import { AppError, Clock, Err, NotFoundError, Ok, Result, UseCase, UserId, ValidationError } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, Rate, UnitPrice } from "@/core/numeric";
import { CalendarDate, FinancialYear } from "@/core/time";
import { Account, AccountId, AccountRepository, AccountSubtype, AccountType, SystemAccountCodes } from "@/domain/accounts";
import { BalanceSource } from "@/domain/assets";
import {
  CompoundingFrequency,
  DepositProduct,
  DepositStore,
  FixedDeposit,
  InterestType,
  NationalPensionSystem,
  NpsScheme,
  NpsTier,
  RecurringDeposit,
  accruedButUnbooked,
} from "@/domain/deposits";
import {
  Loan,
  LoanKind,
  LoanStore,
  PayoffDebt,
  PaymentFrequency,
  comparePayoffStrategies,
  loanFor,
} from "@/domain/loans";
import { TransactionRepository } from "@/domain/transactions";
import { OpenAccount, RecordTransaction } from "@/app/ledger.usecases";

/* ═══ Opening a deposit ═══════════════════════════════════════════════ */

export interface OpenDepositInput {
  userId: UserId;
  name: string;
  kind: "FIXED_DEPOSIT" | "RECURRING_DEPOSIT" | "PPF" | "EPF" | "NPS";
  institution?: string | null;
  currency?: Currency;
  openedOn: CalendarDate;
  /** FD: the lump sum. RD: absent. */
  principal?: Money;
  /** RD: the monthly instalment. */
  instalment?: Money;
  months?: number;
  maturesOn?: CalendarDate;
  rate?: Rate;
  accrualBasis?: InterestType;
  compounding?: CompoundingFrequency;
  payout?: "CUMULATIVE" | "PERIODIC_PAYOUT";
  prematurePenalty?: Percentage;
  npsTier?: NpsTier;
  /**
   * Where the money came from, when it came from an account already tracked.
   *
   * Supplying it books the transfer, so the bank balance falls by exactly what the
   * deposit gained. Omitting it books an opening balance instead — which is right
   * for a deposit that predates the app and wrong for one opened today, so the
   * caller has to say which.
   */
  fundedFromAccountId?: AccountId;
}

const SUBTYPE_FOR: Record<OpenDepositInput["kind"], AccountSubtype> = {
  FIXED_DEPOSIT: "DEPOSIT",
  RECURRING_DEPOSIT: "DEPOSIT",
  PPF: "RETIREMENT",
  EPF: "RETIREMENT",
  NPS: "RETIREMENT",
};

/**
 * Opens a deposit or retirement account and stores its terms.
 *
 * The terms are what everything else is computed from, so this is the only write
 * a deposit needs: no accrual rows, no maturity value, no schedule.
 */
export class OpenDeposit implements UseCase<OpenDepositInput, { accountId: AccountId; code: string }> {
  constructor(
    private readonly openAccount: OpenAccount,
    private readonly deposits: DepositStore,
    private readonly record: RecordTransaction,
  ) {}

  async execute(
    input: OpenDepositInput,
  ): Promise<Result<{ accountId: AccountId; code: string }, AppError>> {
    if (input.kind === "FIXED_DEPOSIT" && (!input.principal || !input.maturesOn)) {
      return Err(
        new ValidationError("A fixed deposit needs a principal and a maturity date.", {
          principal: input.principal ? [] : ["Required"],
          maturesOn: input.maturesOn ? [] : ["Required"],
        }),
      );
    }
    if (input.kind === "RECURRING_DEPOSIT" && (!input.instalment || !input.months)) {
      return Err(
        new ValidationError("A recurring deposit needs an instalment and a number of months."),
      );
    }

    const currency = input.currency ?? Currency.reporting;
    const opened = await this.openAccount.execute({
      userId: input.userId,
      name: input.name,
      type: "ASSET",
      subtype: SUBTYPE_FOR[input.kind],
      institution: input.institution,
      currency,
      // A deposit funded from a tracked account is a transfer, not an opening
      // balance: booking both would double the money.
      openingBalance: input.fundedFromAccountId ? null : input.principal ?? null,
      openingBalanceOn: input.openedOn,
    });
    if (!opened.ok) return opened;

    await this.deposits.saveTerms(input.userId, {
      accountId: opened.value.accountId,
      kind: input.kind,
      currency,
      openedOn: input.openedOn,
      accrualBasis: input.accrualBasis ?? "COMPOUND",
      compounding: input.compounding ?? "QUARTERLY",
      payout: input.payout ?? "CUMULATIVE",
      rate: input.rate,
      principal: input.principal,
      instalment: input.instalment,
      months: input.months,
      maturesOn: input.maturesOn,
      prematurePenalty: input.prematurePenalty,
      npsTier: input.npsTier,
    });

    if (input.fundedFromAccountId && input.principal) {
      const funded = await this.record.execute({
        userId: input.userId,
        fromAccountId: input.fundedFromAccountId,
        toAccountId: opened.value.accountId,
        amount: input.principal,
        postedOn: input.openedOn,
        narration: `Opened ${input.name}`,
      });
      if (!funded.ok) return funded;
    }

    return Ok({ accountId: opened.value.accountId, code: opened.value.code });
  }
}

/* ═══ Listing deposits ════════════════════════════════════════════════ */

export interface DepositPosition {
  readonly deposit: DepositProduct;
  /** The computed value on the as-of date. */
  readonly value: Money;
  /** What the journal has recorded — which lags, because interest is not booked daily. */
  readonly booked: Money;
  /** Computed less booked: interest earned that no posting reflects yet. */
  readonly unbooked: Money;
  readonly maturesOn: CalendarDate | null;
  readonly daysToMaturity: number | null;
}

export interface ListDepositsOutput {
  positions: readonly DepositPosition[];
  total: Money;
  /** NPS positions cannot be valued without NAVs and are reported separately. */
  unvalued: readonly string[];
}

/**
 * Every deposit, valued.
 *
 * `unbooked` is the number this screen exists to show. A deposit's value grows
 * every day and the journal only learns about it when interest is credited, so the
 * two legitimately differ — and naming the difference turns "these figures
 * disagree" into "₹4,231 of interest has accrued and is not yet in the ledger",
 * which is a fact rather than a bug.
 */
export class ListDeposits implements UseCase<{ userId: UserId; asOf: CalendarDate }, ListDepositsOutput> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly deposits: DepositStore,
    private readonly balances: BalanceSource,
  ) {}

  async execute(input: {
    userId: UserId;
    asOf: CalendarDate;
  }): Promise<Result<ListDepositsOutput, AppError>> {
    const accounts = await this.accounts.list(input.userId, { includeClosed: false });
    const products = await this.deposits.loadDeposits(input.userId, accounts);

    const positions: DepositPosition[] = [];
    const unvalued: string[] = [];

    for (const deposit of products) {
      if (deposit instanceof NationalPensionSystem) {
        // Priced, not accrued: without a NAV there is no value, and inventing one
        // is exactly what this codebase refuses to do.
        unvalued.push(deposit.displayName);
        continue;
      }
      const reconciliation = await accruedButUnbooked(deposit, input.asOf, this.balances);
      const maturesOn =
        deposit instanceof FixedDeposit
          ? deposit.terms.maturesOn
          : deposit instanceof RecurringDeposit
            ? deposit.maturesOn
            : null;

      positions.push({
        deposit,
        value: reconciliation.computed,
        booked: reconciliation.booked,
        unbooked: reconciliation.unbooked,
        maturesOn,
        daysToMaturity: maturesOn ? input.asOf.daysUntil(maturesOn) : null,
      });
    }

    return Ok({
      positions,
      total: Money.total(positions.map((position) => position.value)),
      unvalued,
    });
  }
}

/** Values an NPS account from NAVs the caller has resolved. */
export class ValueNps
  implements UseCase<{ userId: UserId; accountId: AccountId; navs: ReadonlyMap<NpsScheme, UnitPrice> }, { value: Money | null; allocation: readonly { scheme: NpsScheme; value: Money; share: Percentage }[] }>
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly deposits: DepositStore,
  ) {}

  async execute(input: {
    userId: UserId;
    accountId: AccountId;
    navs: ReadonlyMap<NpsScheme, UnitPrice>;
  }): Promise<
    Result<
      {
        value: Money | null;
        allocation: readonly { scheme: NpsScheme; value: Money; share: Percentage }[];
      },
      AppError
    >
  > {
    const account = await this.accounts.findById(input.userId, input.accountId);
    if (!account) return Err(new NotFoundError("Account", input.accountId.value));
    const deposit = await this.deposits.loadDeposit(input.userId, account);
    if (!(deposit instanceof NationalPensionSystem)) {
      return Err(new ValidationError(`${account.displayName} is not an NPS account.`));
    }
    return Ok({
      value: deposit.valueFrom(input.navs),
      allocation: deposit.allocation(input.navs),
    });
  }
}

/**
 * Books the interest a deposit has accrued but not yet recorded.
 *
 * Income, from `Income:Investing:Interest` into the deposit account, so the
 * journal catches up with the computation. Deliberately a *user action* rather
 * than a nightly job: the computed value is already correct without it, so this
 * exists only to make the journal tell the same story — and a job that ran on its
 * own would recreate exactly the drift the computed value was designed to avoid.
 */
export class BookAccruedInterest
  implements UseCase<{ userId: UserId; accountId: AccountId; asOf: CalendarDate }, { booked: Money }>
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly deposits: DepositStore,
    private readonly balances: BalanceSource,
    private readonly record: RecordTransaction,
  ) {}

  async execute(input: {
    userId: UserId;
    accountId: AccountId;
    asOf: CalendarDate;
  }): Promise<Result<{ booked: Money }, AppError>> {
    const accounts = await this.accounts.list(input.userId, { includeClosed: true });
    const account = accounts.find((candidate) => candidate.id.equals(input.accountId));
    if (!account) return Err(new NotFoundError("Deposit", input.accountId.value));

    const deposit = await this.deposits.loadDeposit(input.userId, account);
    if (!deposit) return Err(new ValidationError(`${account.displayName} has no deposit terms.`));

    const { unbooked } = await accruedButUnbooked(deposit, input.asOf, this.balances);
    if (!unbooked.isPositive) return Ok({ booked: Money.zero(account.currency) });

    const interestAccount = accounts.find(
      (candidate) => candidate.code.toString() === SystemAccountCodes.interestIncome,
    );
    if (!interestAccount) {
      return Err(new NotFoundError(`System account "${SystemAccountCodes.interestIncome}"`));
    }

    const result = await this.record.execute({
      userId: input.userId,
      fromAccountId: interestAccount.id,
      toAccountId: account.id,
      amount: unbooked,
      postedOn: input.asOf,
      narration: `Interest accrued on ${account.displayName} to ${input.asOf.toISO()}`,
    });
    if (!result.ok) return result;
    return Ok({ booked: unbooked });
  }
}

/* ═══ Loans ═══════════════════════════════════════════════════════════ */

export interface OpenLoanInput {
  userId: UserId;
  name: string;
  kind: LoanKind;
  institution?: string | null;
  principal: Money;
  annualRate: Rate;
  periods: number;
  frequency?: PaymentFrequency;
  disbursedOn: CalendarDate;
  firstPaymentOn?: CalendarDate;
  accrualBasis?: "REDUCING_BALANCE" | "FLAT";
  prepaymentPenalty?: Percentage;
  /** Where the borrowed money landed, when it was a cash disbursement. */
  disbursedToAccountId?: AccountId;
}

/**
 * Opens a loan.
 *
 * The disbursement is the interesting half. A loan that put cash in a bank account
 * is a transfer *from* the loan account, which raises the liability and the asset
 * together — net worth is unchanged, which is correct: borrowing does not make
 * anyone richer. A loan taken to buy something directly (a car, a house) has no
 * cash leg, and its opening balance is booked against equity instead.
 */
export class OpenLoan implements UseCase<OpenLoanInput, { accountId: AccountId; code: string; instalment: Money }> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly openAccount: OpenAccount,
    private readonly loans: LoanStore,
    private readonly record: RecordTransaction,
  ) {}

  async execute(
    input: OpenLoanInput,
  ): Promise<Result<{ accountId: AccountId; code: string; instalment: Money }, AppError>> {
    const opened = await this.openAccount.execute({
      userId: input.userId,
      name: input.name,
      type: "LIABILITY",
      subtype: input.kind === "HOME" ? "MORTGAGE" : "LOAN",
      institution: input.institution,
      currency: input.principal.currency,
      openingBalance: input.disbursedToAccountId ? null : input.principal,
      openingBalanceOn: input.disbursedOn,
    });
    if (!opened.ok) return opened;

    await this.loans.saveLoanTerms(input.userId, {
      accountId: opened.value.accountId,
      kind: input.kind,
      principal: input.principal,
      annualRate: input.annualRate,
      periods: input.periods,
      frequency: input.frequency ?? "MONTHLY",
      disbursedOn: input.disbursedOn,
      firstPaymentOn: input.firstPaymentOn,
      accrualBasis: input.accrualBasis ?? "REDUCING_BALANCE",
      prepaymentPenalty: input.prepaymentPenalty,
    });

    if (input.disbursedToAccountId) {
      const disbursed = await this.record.execute({
        userId: input.userId,
        fromAccountId: opened.value.accountId,
        toAccountId: input.disbursedToAccountId,
        amount: input.principal,
        postedOn: input.disbursedOn,
        narration: `${input.name} disbursed`,
      });
      if (!disbursed.ok) return disbursed;
    }

    const account = await this.accounts.findById(input.userId, opened.value.accountId);
    const loan = account
      ? loanFor(account, {
          accountId: opened.value.accountId,
          kind: input.kind,
          principal: input.principal,
          annualRate: input.annualRate,
          periods: input.periods,
          frequency: input.frequency ?? "MONTHLY",
          disbursedOn: input.disbursedOn,
          firstPaymentOn: input.firstPaymentOn ?? null,
          interestType: input.accrualBasis ?? "REDUCING_BALANCE",
          prepaymentPenalty: input.prepaymentPenalty ?? null,
        })
      : null;

    return Ok({
      accountId: opened.value.accountId,
      code: opened.value.code,
      instalment: loan?.instalment() ?? Money.zero(input.principal.currency),
    });
  }
}

export interface LoanSummary {
  readonly loan: Loan;
  readonly instalment: Money;
  /** From the schedule — what the terms say is left. */
  readonly scheduledOutstanding: Money;
  /** From the journal — what has actually been posted. */
  readonly bookedOutstanding: Money;
  readonly totalInterest: Money;
  readonly effectiveRate: Rate;
  readonly closesOn: CalendarDate | null;
}

/** Every loan, with both the scheduled and the recorded balance. */
export class ListLoans implements UseCase<{ userId: UserId; asOf: CalendarDate }, { loans: readonly LoanSummary[] }> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly loans: LoanStore,
    private readonly balances: BalanceSource,
  ) {}

  async execute(
    input: { userId: UserId; asOf: CalendarDate },
  ): Promise<Result<{ loans: readonly LoanSummary[] }, AppError>> {
    const accounts = await this.accounts.list(input.userId, { includeClosed: false });
    const products = await this.loans.loadLoans(input.userId, accounts);

    const summaries = await Promise.all(
      products.map(async (loan) => {
        const schedule = loan.schedule();
        return {
          loan,
          instalment: loan.instalment(),
          scheduledOutstanding: loan.outstandingOn(input.asOf),
          bookedOutstanding: await this.balances.balanceOf(input.userId, loan.id, input.asOf),
          totalInterest: schedule.totalInterest,
          effectiveRate: loan.effectiveAnnualRate(),
          closesOn: schedule.closedOn,
        };
      }),
    );

    return Ok({ loans: summaries });
  }
}

export interface RecordInstalmentInput {
  userId: UserId;
  loanAccountId: AccountId;
  fromAccountId: AccountId;
  /** Which scheduled period this payment settles. */
  period: number;
  paidOn?: CalendarDate;
}

export interface RecordInstalmentOutput {
  principal: Money;
  interest: Money;
  total: Money;
  transactionIds: readonly string[];
}

/**
 * Records one EMI: a principal transfer and an interest charge.
 *
 * The split comes from the schedule, not from the user, and that is the point — an
 * EMI is a single debit on a bank statement whose composition changes every month,
 * and asking a person to type "₹35,416.67 interest, ₹7,974.49 principal" is asking
 * them to do the amortisation by hand.
 */
export class RecordLoanInstalment implements UseCase<RecordInstalmentInput, RecordInstalmentOutput> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly loans: LoanStore,
    private readonly record: RecordTransaction,
  ) {}

  async execute(input: RecordInstalmentInput): Promise<Result<RecordInstalmentOutput, AppError>> {
    const accounts = await this.accounts.list(input.userId, { includeClosed: true });
    const account = accounts.find((candidate) => candidate.id.equals(input.loanAccountId));
    if (!account) return Err(new NotFoundError("Loan", input.loanAccountId.value));

    const loans = await this.loans.loadLoans(input.userId, accounts);
    const loan = loans.find((candidate) => candidate.id.equals(input.loanAccountId));
    if (!loan) return Err(new ValidationError(`${account.displayName} has no loan terms.`));

    const row = loan.schedule().rows.find((candidate) => candidate.period === input.period && !candidate.note?.startsWith("Prepayment"));
    if (!row) {
      return Err(
        new ValidationError(
          `This loan has no period ${input.period} — it runs for ${loan.terms.periods}.`,
        ),
      );
    }

    const interestAccount = accounts.find(
      (candidate) => candidate.code.toString() === "Expenses:Fees:Interest",
    );
    if (!interestAccount) {
      return Err(new NotFoundError('System account "Expenses:Fees:Interest"'));
    }

    const paidOn = input.paidOn ?? row.on;
    const reference = `EMI ${input.period}/${loan.terms.periods}`;
    const transactionIds: string[] = [];

    if (row.principal.isPositive) {
      const principalLeg = await this.record.execute({
        userId: input.userId,
        fromAccountId: input.fromAccountId,
        toAccountId: input.loanAccountId,
        amount: row.principal,
        postedOn: paidOn,
        narration: `${account.displayName} — principal, ${reference}`,
        reference,
      });
      if (!principalLeg.ok) return principalLeg;
      transactionIds.push(principalLeg.value.transactionId.value);
    }

    if (row.interest.isPositive) {
      const interestLeg = await this.record.execute({
        userId: input.userId,
        fromAccountId: input.fromAccountId,
        toAccountId: interestAccount.id,
        amount: row.interest,
        postedOn: paidOn,
        narration: `${account.displayName} — interest, ${reference}`,
        reference,
        chargeDeductibility: loan.kind === "HOME" || loan.kind === "EDUCATION" ? "DEDUCTIBLE" : "NOT_DEDUCTIBLE",
      });
      if (!interestLeg.ok) return interestLeg;
      transactionIds.push(interestLeg.value.transactionId.value);
    }

    return Ok({
      principal: row.principal,
      interest: row.interest,
      total: row.instalment,
      transactionIds,
    });
  }
}

/** Records a lump-sum prepayment, and re-derives the schedule from it. */
export class RecordPrepayment
  implements UseCase<
    {
      userId: UserId;
      loanAccountId: AccountId;
      fromAccountId: AccountId;
      amount: Money;
      paidOn: CalendarDate;
      reduces: "TERM" | "INSTALMENT";
    },
    { closesOn: CalendarDate | null; interestSaved: Money }
  >
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly loans: LoanStore,
    private readonly record: RecordTransaction,
  ) {}

  async execute(input: {
    userId: UserId;
    loanAccountId: AccountId;
    fromAccountId: AccountId;
    amount: Money;
    paidOn: CalendarDate;
    reduces: "TERM" | "INSTALMENT";
  }) {
    const accounts = await this.accounts.list(input.userId, { includeClosed: true });
    const account = accounts.find((candidate) => candidate.id.equals(input.loanAccountId));
    if (!account) return Err(new NotFoundError("Loan", input.loanAccountId.value));

    const before = (await this.loans.loadLoans(input.userId, accounts)).find((candidate) =>
      candidate.id.equals(input.loanAccountId),
    );
    if (!before) return Err(new ValidationError(`${account.displayName} has no loan terms.`));

    await this.loans.savePrepayment(input.userId, input.loanAccountId, {
      paidOn: input.paidOn,
      amount: input.amount,
      reduces: input.reduces,
    });

    const paid = await this.record.execute({
      userId: input.userId,
      fromAccountId: input.fromAccountId,
      toAccountId: input.loanAccountId,
      amount: input.amount,
      postedOn: input.paidOn,
      narration: `${account.displayName} — prepayment`,
    });
    if (!paid.ok) return paid;

    const after = (await this.loans.loadLoans(input.userId, accounts)).find((candidate) =>
      candidate.id.equals(input.loanAccountId),
    );
    const scheduleAfter = after?.schedule();

    return Ok({
      closesOn: scheduleAfter?.closedOn ?? null,
      interestSaved: before.schedule().totalInterest.minus(scheduleAfter?.totalInterest ?? Money.zero(account.currency)),
    });
  }
}

/**
 * Avalanche versus snowball across every debt the user has.
 *
 * Cards are included alongside loans, because a 42% card and a 16% personal loan
 * are the same decision and a comparison that covered only loans would recommend
 * paying the cheaper debt first.
 */
export class ComparePayoff
  implements UseCase<
    { userId: UserId; monthlyBudget: Money; asOf: CalendarDate },
    ReturnType<typeof comparePayoffStrategies>
  >
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly loans: LoanStore,
    private readonly balances: BalanceSource,
  ) {}

  async execute(input: { userId: UserId; monthlyBudget: Money; asOf: CalendarDate }) {
    const accounts = await this.accounts.list(input.userId, { includeClosed: false });
    const loanProducts = await this.loans.loadLoans(input.userId, accounts);

    const debts: PayoffDebt[] = [];
    for (const loan of loanProducts) {
      const balance = await this.balances.balanceOf(input.userId, loan.id, input.asOf);
      if (!balance.isPositive) continue;
      debts.push({
        id: loan.id.value,
        label: loan.displayName,
        balance,
        annualRate: loan.terms.annualRate,
        minimumPayment: loan.instalment(),
      });
    }

    if (debts.length === 0) {
      return Err(new ValidationError("There is nothing to pay off."));
    }

    try {
      return Ok(comparePayoffStrategies(debts, input.monthlyBudget));
    } catch (error) {
      return Err(new ValidationError((error as Error).message));
    }
  }
}

/* ═══ Contributions ═══════════════════════════════════════════════════ */

/** Records a year's PPF contribution, and the transfer that funded it. */
export class RecordSchemeContribution
  implements UseCase<
    {
      userId: UserId;
      accountId: AccountId;
      financialYear: FinancialYear;
      amount?: Money;
      employee?: Money;
      employer?: Money;
      voluntary?: Money;
      fromAccountId?: AccountId;
      postedOn?: CalendarDate;
    },
    { recorded: true }
  >
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly deposits: DepositStore,
    private readonly record: RecordTransaction,
  ) {}

  async execute(input: {
    userId: UserId;
    accountId: AccountId;
    financialYear: FinancialYear;
    amount?: Money;
    employee?: Money;
    employer?: Money;
    voluntary?: Money;
    fromAccountId?: AccountId;
    postedOn?: CalendarDate;
  }) {
    const account = await this.accounts.findById(input.userId, input.accountId);
    if (!account) return Err(new NotFoundError("Account", input.accountId.value));
    if (account.type !== AccountType.ASSET) {
      return Err(new ValidationError(`${account.displayName} is not an asset account.`));
    }

    await this.deposits.saveContribution(input.userId, {
      accountId: input.accountId,
      financialYear: input.financialYear.label,
      amount: input.amount,
      employee: input.employee,
      employer: input.employer,
      voluntary: input.voluntary,
    });

    // Only the part the user actually paid is a transfer from their own account;
    // an employer's share never passes through it, and booking it as one would
    // invent an outflow that never happened.
    const paid = input.amount ?? Money.total([input.employee, input.voluntary].filter((x): x is Money => x !== undefined));
    if (input.fromAccountId && paid.isPositive) {
      const funded = await this.record.execute({
        userId: input.userId,
        fromAccountId: input.fromAccountId,
        toAccountId: input.accountId,
        amount: paid,
        postedOn: input.postedOn ?? input.financialYear.start,
        narration: `${account.displayName} — ${input.financialYear.label} contribution`,
      });
      if (!funded.ok) return funded;
    }

    return Ok({ recorded: true as const });
  }
}

/** Sets a scheme's notified rate for a year — PPF and EPF are re-notified. */
export class SetSchemeRate
  implements UseCase<{ userId: UserId; schemeKey: string; financialYear: FinancialYear; rate: Rate }, { set: true }>
{
  constructor(private readonly deposits: DepositStore) {}

  async execute(input: { userId: UserId; schemeKey: string; financialYear: FinancialYear; rate: Rate }) {
    await this.deposits.saveSchemeRate(input.userId, input.schemeKey, input.financialYear.label, input.rate);
    return Ok({ set: true as const });
  }
}

/** Records NPS units, which is what an NPS statement actually reports. */
export class SetNpsUnits
  implements UseCase<{ userId: UserId; accountId: AccountId; scheme: NpsScheme; units: Quantity }, { set: true }>
{
  constructor(private readonly deposits: DepositStore) {}

  async execute(input: { userId: UserId; accountId: AccountId; scheme: NpsScheme; units: Quantity }) {
    await this.deposits.saveNpsHolding(input.userId, input.accountId, input.scheme, input.units);
    return Ok({ set: true as const });
  }
}

export type { Account };
