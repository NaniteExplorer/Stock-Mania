/**
 * Ledger use cases.
 *
 * The four files formerly under `application/use-cases/`, in one file per the
 * plan of record. A use case is the only thing a server action may call: it
 * resolves ports, enforces the invariants that need more than one aggregate, and
 * returns a `Result` the UI can render.
 *
 * Note this is `src/app/`, not the Next router at the repository root. Next
 * ignores `src/app/` while a root `app/` exists, which `tests/layout.spec.ts`
 * asserts in both directions.
 */

import { AppError, Clock, Err, NotFoundError, Ok, Result, UseCase, UserId, ValidationError } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Account, AccountClosedError, AccountCode, AccountId, AccountRepository, AccountSubtype, AccountType, AccountTypeName, SystemAccountCodes, resolveDefaultChart } from "@/domain/accounts";
import { Charge, Expense, Income, OpeningBalance, Refund, Transaction, TransactionAlreadyReversedError, TransactionId, TransactionKind, TransactionRepository, TransactionSource, Transfer, accountRef } from "@/domain/transactions";
/* ═══ SeedChartOfAccounts ═════════════════════════════════════════════ */

export interface SeedChartOfAccountsInput {
  userId: UserId;
}

export interface SeedChartOfAccountsOutput {
  created: number;
  /** Already present, so left alone. */
  skipped: number;
}

/**
 * Gives a new user a working chart of accounts.
 *
 * **Idempotent**: it only creates codes that are missing, so running it again
 * after a partial failure — or after a later release adds categories — tops up
 * rather than duplicating. That matters because it runs on first sign-in, where a
 * retry is likely and a duplicate-code crash would lock the user out of an empty
 * app.
 *
 * Parents are created before children in one pass, which the seed list's
 * declaration order guarantees.
 */
export class SeedChartOfAccounts
  implements UseCase<SeedChartOfAccountsInput, SeedChartOfAccountsOutput>
{
  constructor(private readonly accounts: AccountRepository) {}

  async execute(input: SeedChartOfAccountsInput): Promise<Result<SeedChartOfAccountsOutput, AppError>> {
    const existing = await this.accounts.list(input.userId, { includeClosed: true });
    const idByCode = new Map<string, AccountId>(
      existing.map((account) => [account.code.toString(), account.id]),
    );

    const toCreate: Account[] = [];
    for (const seed of resolveDefaultChart()) {
      const code = seed.code.toString();
      if (idByCode.has(code)) continue;

      const parentCode = seed.code.parent?.toString();
      const account = Account.open({
        userId: input.userId,
        code: seed.code,
        name: seed.name,
        type: seed.type,
        subtype: seed.subtype,
        // Resolved from this same map, which the loop fills as it goes — hence
        // the requirement that parents are declared first.
        parentId: parentCode ? idByCode.get(parentCode) ?? null : null,
        isSystem: seed.isSystem,
        sortOrder: seed.sortOrder,
      });

      idByCode.set(code, account.id);
      toCreate.push(account);
    }

    if (toCreate.length > 0) {
      await this.accounts.saveMany(toCreate);
    }

    return Ok({ created: toCreate.length, skipped: existing.length });
  }
}

/* ═══ OpenAccount ═════════════════════════════════════════════════════ */

export interface OpenAccountInput {
  userId: UserId;
  name: string;
  /** Stable ledger-path leaf when the display name contains Unicode or punctuation. */
  codeSegment?: string;
  type: AccountTypeName;
  subtype?: AccountSubtype | null;
  /** Where it sits in the tree. Defaults to the type's root (`Assets`, …). */
  parentId?: AccountId | null;
  institution?: string | null;
  accountNumberSuffix?: string | null;
  currency?: Currency;
  /**
   * The balance the account already has today. Booked against
   * `Equity:Opening Balances` so the ledger stays balanced from the first day —
   * this is the piece that lets a user start mid-life without inventing history.
   *
   * For a liability, pass the amount owed as a positive number.
   */
  openingBalance?: Money | null;
  openingBalanceOn?: CalendarDate;
}

export interface OpenAccountOutput {
  accountId: AccountId;
  code: string;
}

/**
 * Creates an account, and optionally seeds its current balance.
 *
 * The opening balance is the interesting part. A user starting today has ₹3.4
 * lakh in a bank account and no transaction history to explain it, and a
 * single-sided "just set the balance" would leave debits and credits unequal
 * forever. Posting it against `Equity:Opening Balances` is the standard
 * bookkeeping answer: net worth is right immediately, the ledger still balances,
 * and the equity account makes explicit how much of the position was never
 * recorded as income.
 */
export class OpenAccount implements UseCase<OpenAccountInput, OpenAccountOutput> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly journal: TransactionRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: OpenAccountInput): Promise<Result<OpenAccountOutput, AppError>> {
    const name = input.name.trim();
    if (name.length === 0) {
      return Err(new ValidationError("Give the account a name.", { name: ["Required"] }));
    }

    const type = AccountType.of(input.type);
    if (!type.isUserCreatable) {
      return Err(
        new ValidationError(
          `${type.label} accounts are maintained by the app and cannot be created by hand.`,
          { type: ["Not allowed"] },
        ),
      );
    }

    const parent = input.parentId
      ? await this.accounts.findById(input.userId, input.parentId)
      : await this.accounts.findByCode(input.userId, AccountCode.parse(type.label));

    if (input.parentId && !parent) {
      return Err(new NotFoundError("Parent account", input.parentId.value));
    }
    if (parent && parent.type !== type) {
      return Err(
        new ValidationError(
          `A ${type.label.toLowerCase()} account cannot sit under ${parent.displayName}, ` +
            `which is ${parent.type.label.toLowerCase()}.`,
          { parentId: ["Type mismatch"] },
        ),
      );
    }

    // Codes are unique per user; disambiguate rather than rejecting a name the
    // user reasonably wants to reuse ("HDFC" for both a savings and a salary
    // account).
    let baseCode: AccountCode;
    try {
      const codeSegment = input.codeSegment?.trim() || name;
      baseCode = parent ? parent.code.child(codeSegment) : AccountCode.parse(codeSegment);
    } catch {
      return Err(
        new ValidationError("The account name contains characters that cannot be used in its ledger code.", {
          name: ["Use letters, numbers, spaces, and simple punctuation."],
        }),
      );
    }
    const code = await this.uniqueCode(input.userId, baseCode);

    const account = Account.open({
      userId: input.userId,
      code,
      name,
      type,
      subtype: input.subtype ?? parent?.subtype ?? null,
      parentId: parent?.id ?? null,
      currency: input.currency ?? Currency.reporting,
      institution: input.institution ?? parent?.institution ?? null,
      accountNumberSuffix: input.accountNumberSuffix ?? null,
    });

    await this.accounts.save(account);

    const opening = input.openingBalance;
    if (opening && !opening.isZero) {
      const equity = await this.accounts.findByCode(
        input.userId,
        AccountCode.parse(SystemAccountCodes.openingBalances),
      );
      if (!equity) {
        return Err(
          new NotFoundError(
            `System account "${SystemAccountCodes.openingBalances}" — seed the chart of accounts first`,
          ),
        );
      }

      // Which side the account is debited on is `OpeningBalance`'s business, not
      // this use case's: it reads it off the account's legality role, so the asset
      // and liability cases cannot diverge here and there.
      const txn = OpeningBalance.record(
        {
          userId: input.userId,
          txnDate: input.openingBalanceOn ?? CalendarDate.parse(this.clock.today()),
          description: `Opening balance — ${account.displayName}`,
          source: accountRef(equity),
          destination: accountRef(account),
          today: CalendarDate.parse(this.clock.today()),
        },
        { amount: opening.abs(), account: accountRef(account) },
      );
      await this.journal.save(txn);
    }

    return Ok({ accountId: account.id, code: code.toString() });
  }

  /** Appends ` 2`, ` 3`, … until the code is free. */
  private async uniqueCode(userId: UserId, base: AccountCode): Promise<AccountCode> {
    if (!(await this.accounts.findByCode(userId, base))) return base;

    const parent = base.parent;
    for (let suffix = 2; suffix < 50; suffix += 1) {
      const candidate = parent
        ? parent.child(`${base.leaf} ${suffix}`)
        : AccountCode.parse(`${base.leaf} ${suffix}`);
      if (!(await this.accounts.findByCode(userId, candidate))) return candidate;
    }
    throw new Error(`Could not find a free account code based on "${base.toString()}"`);
  }
}

/* ═══ RecordTransaction ═══════════════════════════════════════════════ */

export interface RecordTransactionInput {
  userId: UserId;
  /** Where the money comes FROM — credited. */
  fromAccountId: AccountId;
  /** Where the money goes TO — debited. */
  toAccountId: AccountId;
  amount: Money;
  postedOn: CalendarDate;
  narration: string;
  reference?: string | null;
  source?: TransactionSource;
  importBatchId?: string | null;
  fingerprint?: string | null;
  /** Budget category, for a spend or a receipt. Rejected on a transfer (L12). */
  categoryId?: string | null;
  /**
   * Books the spend as a {@link Charge} rather than an {@link Expense}: a fee is a
   * cost of holding or trading something, and the tax engine may deduct it.
   */
  chargeDeductibility?: "DEDUCTIBLE" | "NOT_DEDUCTIBLE" | "CAPITALISED";
}

export interface RecordTransactionOutput {
  transactionId: TransactionId;
  kind: TransactionKind;
  /** Non-blocking findings, e.g. L11's future-dated warning. */
  warnings: readonly string[];
}

/**
 * Records any single movement of money between two accounts.
 *
 * **One use case covers expenses, income, transfers and card spending**, because
 * in double-entry they are the same operation: debit the destination, credit the
 * source. Working through the four cases with that one rule:
 *
 * | From → To | Debit / Credit | Result |
 * | --- | --- | --- |
 * | HDFC → Groceries | Dr Groceries, Cr HDFC | expense up, bank down |
 * | Salary → HDFC | Dr HDFC, Cr Salary | bank up, income up |
 * | HDFC → Credit Card | Dr Card, Cr HDFC | debt down, bank down |
 * | Credit Card → Groceries | Dr Groceries, Cr Card | expense up, debt up |
 *
 * All four fall out of the account types' normal balances, so there is no
 * per-case sign logic to get wrong — which is what v1's separate transaction,
 * transfer and credit-card paths each got wrong differently. `kind` is *derived*
 * from the two account types for display only; it never affects the arithmetic.
 */
export class RecordTransaction
  implements UseCase<RecordTransactionInput, RecordTransactionOutput>
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly journal: TransactionRepository,
  ) {}

  async execute(input: RecordTransactionInput): Promise<Result<RecordTransactionOutput, AppError>> {
    if (!input.amount.isPositive) {
      return Err(
        new ValidationError("Enter an amount greater than zero.", {
          amount: ["Must be greater than zero"],
        }),
      );
    }
    if (input.fromAccountId.equals(input.toAccountId)) {
      return Err(
        new ValidationError("Pick two different accounts — money cannot move to itself.", {
          toAccountId: ["Must differ from the source account"],
        }),
      );
    }
    if (input.narration.trim().length === 0) {
      return Err(
        new ValidationError("Add a description so you can recognise this later.", {
          narration: ["Required"],
        }),
      );
    }

    const [from, to] = await Promise.all([
      this.accounts.findById(input.userId, input.fromAccountId),
      this.accounts.findById(input.userId, input.toAccountId),
    ]);
    if (!from) return Err(new NotFoundError("Source account", input.fromAccountId.value));
    if (!to) return Err(new NotFoundError("Destination account", input.toAccountId.value));

    for (const account of [from, to]) {
      if (!account.acceptsPostings) return Err(new AccountClosedError(account.displayName));
    }

    // Both legs must share the entry's currency; the aggregate would reject a
    // mismatch, but catching it here gives the user a usable message.
    if (from.currency.code !== input.amount.currency.code || to.currency.code !== input.amount.currency.code) {
      return Err(
        new ValidationError(
          `${from.displayName} and ${to.displayName} must both be in ${input.amount.currency.code} ` +
            `to record this in ${input.amount.currency.code}.`,
        ),
      );
    }

    // An imported row we already have is a friendly no-op, not an error — the
    // unique index would otherwise surface as a driver exception.
    if (input.fingerprint) {
      const seen = await this.journal.existsWithFingerprint(input.userId, input.fingerprint);
      if (seen) {
        return Err(
          new ValidationError("This transaction is already recorded.", {
            fingerprint: ["Duplicate"],
          }),
        );
      }
    }

    const context = {
      userId: input.userId,
      txnDate: input.postedOn,
      description: input.narration.trim(),
      source: accountRef(from),
      destination: accountRef(to),
      txnSource: input.source ?? "MANUAL",
      reference: input.reference ?? null,
      importBatchId: input.importBatchId ?? null,
      fingerprint: input.fingerprint ?? null,
    };
    const movement = {
      amount: input.amount,
      categoryId: input.categoryId ?? null,
    };

    const built = RecordTransaction.build(from, to, context, movement, input.chargeDeductibility);
    if (!built.ok) return built;
    const txn = built.value;

    await this.journal.save(txn);

    return Ok({ transactionId: txn.id, kind: txn.kind, warnings: txn.warnings });
  }

  /**
   * Chooses the subclass from the shape of the movement.
   *
   * This replaces v1's `deriveKind`, which returned a *label* — and a label is
   * exactly what a ledger must not decide by. The class chosen here is what
   * answers the lot, tax and cashflow questions later, so getting it wrong is a
   * wrong number rather than a wrong icon. The mapping is the same reading of the
   * account types that produced the label, and the legality matrix independently
   * rejects a combination that has no meaning.
   */
  private static build(
    from: Account,
    to: Account,
    context: Parameters<typeof Transfer.record>[0],
    movement: { amount: Money; categoryId: string | null },
    deductibility: RecordTransactionInput["chargeDeductibility"],
  ): Result<Transaction, AppError> {
    if (from.type === AccountType.INCOME) return Ok(Income.record(context, movement));

    // An expense account as the *source* is a refund — the one case the legality
    // matrix permits it (§3.6), and the reason L07 is a matrix rule rather than a
    // blanket check. Money is coming back from a category, so the category is on
    // the source and the budget for that category is reduced.
    if (from.type === AccountType.EXPENSE && to.type.isBalanceSheet) {
      return Ok(Refund.record(context, movement));
    }

    if (to.type === AccountType.EXPENSE) {
      return Ok(
        deductibility
          ? Charge.record(context, { ...movement, deductibility })
          : Expense.record(context, movement),
      );
    }

    if (from.type === AccountType.EQUITY || to.type === AccountType.EQUITY) {
      const account = from.type === AccountType.EQUITY ? to : from;
      return Ok(
        OpeningBalance.record(context, { amount: movement.amount, account: accountRef(account) }),
      );
    }

    if (from.type.isBalanceSheet && to.type.isBalanceSheet) {
      if (movement.categoryId) {
        // L12 stated where the user can act on it. The aggregate would also reject
        // this, but as a `DomainError` — which is a bug report, not a form error.
        return Err(
          new ValidationError(
            `A transfer to ${to.displayName} is not spending, so it takes no category: ` +
              `the expense it eventually pays for is where the category belongs.`,
            { categoryId: ["Not allowed on a transfer"] },
          ),
        );
      }
      return Ok(Transfer.record(context, movement));
    }

    return Err(
      new ValidationError(
        `Money cannot move from ${from.displayName} (${from.type.label.toLowerCase()}) to ` +
          `${to.displayName} (${to.type.label.toLowerCase()}). One side must be an account you own.`,
      ),
    );
  }
}

/* ═══ ReverseTransaction ══════════════════════════════════════════════ */

export interface ReverseTransactionInput {
  userId: UserId;
  transactionId: TransactionId;
  /** Defaults to the original transaction's date, so the fix lands in the right period. */
  reversedOn?: CalendarDate;
  narration?: string;
}

export interface ReverseTransactionOutput {
  reversalTransactionId: TransactionId;
}

/**
 * Undoes a transaction by posting its mirror image.
 *
 * This is the *only* way to correct the ledger, and there is deliberately no
 * `EditTransaction` or `DeleteTransaction` beside it. Editing a posted transaction would
 * silently change every report that had already been produced from it; reversing
 * leaves both the mistake and the correction visible, and the pair nets to zero
 * everywhere. It is also how real accounting systems behave, which matters when
 * the numbers feed a tax return.
 *
 * To restate a transaction, reverse it and record the correct one.
 */
export class ReverseTransaction
  implements UseCase<ReverseTransactionInput, ReverseTransactionOutput>
{
  constructor(
    private readonly journal: TransactionRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: ReverseTransactionInput): Promise<Result<ReverseTransactionOutput, AppError>> {
    const original = await this.journal.findById(input.userId, input.transactionId);
    if (!original) return Err(new NotFoundError("Transaction", input.transactionId.value));

    // Reversing a reversal would leave the user unable to tell what the current
    // state is; they should reverse the original instead.
    if (original.isReversal) {
      return Err(new TransactionAlreadyReversedError());
    }
    if (await this.journal.hasReversal(input.userId, original.id)) {
      return Err(new TransactionAlreadyReversedError());
    }

    const reversedOn = input.reversedOn ?? original.txnDate;
    // A reversal dated in the future would sit outside every report until that
    // date arrives, leaving the original apparently un-corrected.
    const today = CalendarDate.parse(this.clock.today());
    const effectiveDate = reversedOn.isAfter(today) ? today : reversedOn;

    const reversal = original.reverse({
      reversedOn: effectiveDate,
      description: input.narration,
    });

    await this.journal.save(reversal);

    return Ok({ reversalTransactionId: reversal.id });
  }
}
