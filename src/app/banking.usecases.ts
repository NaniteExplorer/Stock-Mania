/**
 * Banking use cases: the first slice to reach the UI.
 *
 * Everything here is orchestration. The decisions live elsewhere on purpose —
 * `infra/statements.ts` reads the file, `domain/banking.ts` decides what a row
 * means, `domain/transactions.ts` decides what balances — and this file resolves
 * ports, sequences the steps and turns a domain error into something a form can
 * render.
 *
 * The import path is the interesting part, and its shape is invariant I01: a
 * parsed row lands in `import_rows`, is matched, is reviewed, and **only then**
 * becomes a transaction. Nothing here can post an unconfirmed row, because
 * {@link PostImportBatch} asks the repository for `CONFIRMED` rows and there is no
 * other path from a row to the ledger.
 */

import { AppError, Clock, Err, NotFoundError, Ok, Result, UseCase, UserId, ValidationError, newUuid } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { Account, AccountCode, AccountId, AccountRepository, AccountSubtype, AccountType, SystemAccountCodes } from "@/domain/accounts";
import { BalanceSource, BillingCycle, CardMovement, CardStatement, CardTerms, CardTermsRepository, CashAsset, CreditCard, LiquidPosition, RewardPointBalance, liquidPositions, totalLiquid } from "@/domain/assets";
import {
  BudgetLedger,
  BudgetRepository,
  Categoriser,
  CategoryRuleRepository,
  DuplicateMatcher,
  ImportBatchRecord,
  ImportRepository,
  MatchTarget,
  MatchableRow,
  MonthBudget,
  MovementIntent,
  ReconciliationReport,
  RowDirection,
  SelfPayeeQuery,
  StagedRow,
  StatementInput,
  fingerprintOf,
  reconcile,
  resolveBudgets,
} from "@/domain/banking";
import { BalanceQuery, Transaction, TransactionRepository } from "@/domain/transactions";
import { OpenAccount, RecordTransaction } from "@/app/ledger.usecases";

/* ═══ OpenCashAccount ═════════════════════════════════════════════════ */

export interface OpenCashAccountInput {
  userId: UserId;
  name: string;
  /** One of the cash-like subtypes; anything else is refused with a reason. */
  subtype: AccountSubtype;
  institution?: string | null;
  accountNumberSuffix?: string | null;
  currency?: Currency;
  openingBalance?: Money | null;
  openingBalanceOn?: CalendarDate;
}

export interface OpenCashAccountOutput {
  accountId: AccountId;
  code: string;
  kind: string;
}

/**
 * Opens a bank account, wallet or cash account.
 *
 * A thin front for {@link OpenAccount} that adds one thing: it will only create a
 * subtype {@link CashAsset.classify} recognises. Without that check a "bank
 * account" could be created with subtype `OTHER`, classify as nothing, and then
 * be missing from liquid net worth for reasons no screen explains.
 */
export class OpenCashAccount implements UseCase<OpenCashAccountInput, OpenCashAccountOutput> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly openAccount: OpenAccount,
  ) {}

  async execute(input: OpenCashAccountInput): Promise<Result<OpenCashAccountOutput, AppError>> {
    if (!CashAsset.cashSubtypes.includes(input.subtype)) {
      return Err(
        new ValidationError(
          `${input.subtype} is not a cash account. Choose one of ${CashAsset.cashSubtypes.join(", ")} — ` +
            `a deposit or a brokerage account is an asset but not spendable money.`,
          { subtype: ["Not a cash subtype"] },
        ),
      );
    }

    const opened = await this.openAccount.execute({
      userId: input.userId,
      name: input.name,
      type: "ASSET",
      subtype: input.subtype,
      institution: input.institution,
      accountNumberSuffix: input.accountNumberSuffix,
      currency: input.currency,
      openingBalance: input.openingBalance,
      openingBalanceOn: input.openingBalanceOn,
    });
    if (!opened.ok) return opened;

    const account = await this.accounts.findById(input.userId, opened.value.accountId);
    const asset = account ? CashAsset.classify(account) : null;

    return Ok({
      accountId: opened.value.accountId,
      code: opened.value.code,
      kind: asset?.kind ?? "BANK_ACCOUNT",
    });
  }
}

/* ═══ ListCashPositions ═══════════════════════════════════════════════ */

export interface ListCashPositionsInput {
  userId: UserId;
  asOf: CalendarDate;
  includeClosed?: boolean;
}

export interface ListCashPositionsOutput {
  positions: readonly LiquidPosition[];
  /** Total of the positions in the reporting currency; others are excluded, not converted. */
  total: Money;
  anomalies: readonly string[];
}

/**
 * The accounts screen's data, derived.
 *
 * Every figure here is a sum of postings on the way out of the database; there is
 * no balance column to read and therefore none to be stale.
 */
export class ListCashPositions implements UseCase<ListCashPositionsInput, ListCashPositionsOutput> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly balances: BalanceSource,
  ) {}

  async execute(input: ListCashPositionsInput): Promise<Result<ListCashPositionsOutput, AppError>> {
    const accounts = await this.accounts.list(input.userId, { includeClosed: input.includeClosed });
    const positions = await liquidPositions(accounts, input.asOf, this.balances);
    return Ok({
      positions,
      total: totalLiquid(positions),
      anomalies: positions.flatMap((position) => position.anomalies.map((finding) => finding.message)),
    });
  }
}

/* ═══ Recording, by intent ════════════════════════════════════════════ */

export interface RecordSpendInput {
  userId: UserId;
  /** The account the money left. */
  fromAccountId: AccountId;
  /** The expense category it went to. */
  categoryAccountId: AccountId;
  amount: Money;
  postedOn: CalendarDate;
  narration: string;
  reference?: string | null;
}

/**
 * Records spending.
 *
 * Deliberately three named use cases — spend, receipt, transfer — over the one
 * generic {@link RecordTransaction}, rather than three copies of its logic. The
 * arithmetic must not fork; only the *validation* differs, and it is the
 * validation that makes an error message useful: "Groceries is a category, not an
 * account you can move money to" beats a legality-matrix rejection.
 */
export class RecordSpend implements UseCase<RecordSpendInput, { transactionId: string }> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly record: RecordTransaction,
  ) {}

  async execute(input: RecordSpendInput): Promise<Result<{ transactionId: string }, AppError>> {
    const category = await this.accounts.findById(input.userId, input.categoryAccountId);
    if (!category) return Err(new NotFoundError("Category", input.categoryAccountId.value));
    if (category.type !== AccountType.EXPENSE) {
      return Err(
        new ValidationError(
          `${category.displayName} is ${category.type.label.toLowerCase()}, not an expense category. ` +
            `Use a transfer to move money between accounts you own.`,
          { categoryAccountId: ["Not an expense category"] },
        ),
      );
    }

    const result = await this.record.execute({
      userId: input.userId,
      fromAccountId: input.fromAccountId,
      toAccountId: input.categoryAccountId,
      amount: input.amount,
      postedOn: input.postedOn,
      narration: input.narration,
      reference: input.reference ?? null,
    });
    return result.ok ? Ok({ transactionId: result.value.transactionId.value }) : result;
  }
}

export interface RecordReceiptInput {
  userId: UserId;
  /** The income category it came from. */
  incomeAccountId: AccountId;
  /** The account the money landed in. */
  toAccountId: AccountId;
  amount: Money;
  postedOn: CalendarDate;
  narration: string;
  reference?: string | null;
}

export class RecordReceipt implements UseCase<RecordReceiptInput, { transactionId: string }> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly record: RecordTransaction,
  ) {}

  async execute(input: RecordReceiptInput): Promise<Result<{ transactionId: string }, AppError>> {
    const income = await this.accounts.findById(input.userId, input.incomeAccountId);
    if (!income) return Err(new NotFoundError("Income category", input.incomeAccountId.value));
    if (income.type !== AccountType.INCOME) {
      return Err(
        new ValidationError(
          `${income.displayName} is ${income.type.label.toLowerCase()}, not an income category.`,
          { incomeAccountId: ["Not an income category"] },
        ),
      );
    }

    const result = await this.record.execute({
      userId: input.userId,
      fromAccountId: input.incomeAccountId,
      toAccountId: input.toAccountId,
      amount: input.amount,
      postedOn: input.postedOn,
      narration: input.narration,
      reference: input.reference ?? null,
    });
    return result.ok ? Ok({ transactionId: result.value.transactionId.value }) : result;
  }
}

export interface RecordAccountTransferInput {
  userId: UserId;
  fromAccountId: AccountId;
  toAccountId: AccountId;
  amount: Money;
  postedOn: CalendarDate;
  narration: string;
  reference?: string | null;
}

export class RecordAccountTransfer
  implements UseCase<RecordAccountTransferInput, { transactionId: string }>
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly record: RecordTransaction,
  ) {}

  async execute(
    input: RecordAccountTransferInput,
  ): Promise<Result<{ transactionId: string }, AppError>> {
    const [from, to] = await Promise.all([
      this.accounts.findById(input.userId, input.fromAccountId),
      this.accounts.findById(input.userId, input.toAccountId),
    ]);
    if (!from) return Err(new NotFoundError("Source account", input.fromAccountId.value));
    if (!to) return Err(new NotFoundError("Destination account", input.toAccountId.value));

    for (const side of [from, to]) {
      if (!side.type.isBalanceSheet) {
        return Err(
          new ValidationError(
            `${side.displayName} is ${side.type.label.toLowerCase()}. A transfer moves money ` +
              `between accounts you own; spending is not a transfer.`,
          ),
        );
      }
    }

    const result = await this.record.execute({
      userId: input.userId,
      fromAccountId: input.fromAccountId,
      toAccountId: input.toAccountId,
      amount: input.amount,
      postedOn: input.postedOn,
      narration: input.narration,
      reference: input.reference ?? null,
    });
    return result.ok ? Ok({ transactionId: result.value.transactionId.value }) : result;
  }
}

/* ═══ StageStatementImport ════════════════════════════════════════════ */

export interface StageStatementImportInput {
  userId: UserId;
  /** The account the statement belongs to. */
  accountId: AccountId;
  fileName: string;
  /** SHA-256 of the file's bytes — invariant I02. */
  fileHash: string;
  statement: StatementInput;
}

export interface StageStatementImportOutput {
  batchId: string;
  rowsStaged: number;
  /** Rows the matcher believes already exist. */
  rowsLikelyDuplicate: number;
  rowsUnreadable: number;
  /** Set when the same bytes were imported before; nothing is staged. */
  alreadyImportedBatchId?: string;
}

/**
 * Parses, categorises, matches and stages a statement — without touching the
 * ledger.
 *
 * Four layers of duplicate detection run here, in increasing order of doubt, and
 * the order is the point:
 *
 *   0. **The same file.** Identical bytes were imported before (I02) — nothing is
 *      staged at all.
 *   1. **The same row of the same file.** The fingerprint already exists, so this
 *      exact row was imported before, possibly from an overlapping statement.
 *   2. **The same bank reference.** The matcher's pass 2.
 *   3. **It looks the same.** The matcher's pass 3, within a week.
 *
 * A row flagged at any layer is staged as `MATCHED` rather than dropped, because
 * "we think you already have this" is a claim the user must be able to overrule.
 */
export class StageStatementImport
  implements UseCase<StageStatementImportInput, StageStatementImportOutput>
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly journal: TransactionRepository,
    private readonly imports: ImportRepository,
    private readonly rules: CategoryRuleRepository,
    private readonly selfPayees: SelfPayeeQuery,
    private readonly categoriser: Categoriser = new Categoriser(),
    private readonly matcher: DuplicateMatcher = new DuplicateMatcher(),
  ) {}

  async execute(
    input: StageStatementImportInput,
  ): Promise<Result<StageStatementImportOutput, AppError>> {
    const account = await this.accounts.findById(input.userId, input.accountId);
    if (!account) return Err(new NotFoundError("Account", input.accountId.value));
    if (!account.acceptsPostings) {
      return Err(new ValidationError(`${account.displayName} is closed.`));
    }

    // I02: the same bytes are a no-op, and saying so is better than staging 200
    // rows the user then has to reject one by one.
    const seen = await this.imports.findBatchByFileHash(input.userId, input.fileHash);
    if (seen) {
      return Ok({
        batchId: seen.id,
        rowsStaged: 0,
        rowsLikelyDuplicate: 0,
        rowsUnreadable: 0,
        alreadyImportedBatchId: seen.id,
      });
    }

    if (input.statement.rows.length === 0) {
      return Err(
        new ValidationError(
          `No transactions could be read from ${input.fileName}. ` +
            `${input.statement.problems.length} line(s) were unreadable.`,
        ),
      );
    }

    const context = await this.categoriserContext(input.userId);
    const batchId = newUuid();

    // Existing transactions the matcher compares against: the statement's own
    // date range widened by the fuzzy window, so a row at either edge still sees
    // its candidates.
    const dates = input.statement.rows.map((row) => row.date);
    const window = DateRange.of(
      dates.reduce((a, b) => CalendarDate.min(a, b)).plusDays(-8),
      dates.reduce((a, b) => CalendarDate.max(a, b)).plusDays(8),
    );
    const existing = await this.journal.find(input.userId, {
      accountIds: [input.accountId],
      range: window,
      limit: 5000,
    });
    const targets = StageStatementImport.targetsFor(existing.transactions, input.accountId);

    const fingerprints = input.statement.rows.map((row) =>
      fingerprintOf({
        accountId: input.accountId,
        date: row.date,
        amount: row.amount,
        direction: row.direction,
        description: row.description,
        occurrence: row.occurrence,
      }),
    );
    const alreadyPresent = await this.journal.findExistingFingerprints(input.userId, fingerprints);

    const matchable: MatchableRow[] = input.statement.rows.map((row, index) => ({
      key: `k${index}`,
      date: row.date,
      amount: row.amount,
      direction: row.direction,
      externalId: row.reference,
    }));
    const outcomes = this.matcher.match(matchable, targets);

    const staged: StagedRow[] = input.statement.rows.map((row, index) => {
      const categorisation = this.categoriser.categorise(
        { description: row.description, reference: row.reference, direction: row.direction },
        context,
      );
      const outcome = outcomes[index];
      const fingerprintSeen = alreadyPresent.has(fingerprints[index]);

      return {
        id: newUuid(),
        batchId,
        rowIndex: row.rowIndex,
        status: fingerprintSeen || outcome.matchedTransactionId ? "MATCHED" : "PARSED",
        date: row.date,
        description: row.description,
        reference: row.reference,
        amount: row.amount,
        direction: row.direction,
        occurrence: row.occurrence,
        raw: row.raw,
        proposedAccountId: categorisation.accountId,
        intent: categorisation.intent,
        because: fingerprintSeen
          ? "This exact row was already imported."
          : `${categorisation.because}${outcome.matchedTransactionId ? ` ${outcome.because}` : ""}`,
        matchedTransactionId: outcome.matchedTransactionId,
        // Zero means "the fingerprint already exists", which is a stronger claim
        // than any of the three sweeps and needs to be distinguishable from them.
        matchPass: fingerprintSeen ? 0 : outcome.pass,
        rejectedReason: null,
      };
    });

    const unreadable = input.statement.problems.length;
    const batch: ImportBatchRecord = {
      id: batchId,
      kind: "BANK_STATEMENT",
      accountId: input.accountId,
      fileName: input.fileName,
      fileHash: input.fileHash,
      rowsRead: staged.length + unreadable,
      rowsImported: 0,
      rowsDuplicate: staged.filter((row) => row.status === "MATCHED").length,
      rowsFailed: unreadable,
      // Not COMPLETED: nothing has been posted yet, and a batch that says
      // "completed" before the user has reviewed it is a lie the UI would repeat.
      status: "PARTIAL",
    };

    await this.imports.createBatch(input.userId, batch, staged);

    return Ok({
      batchId,
      rowsStaged: staged.length,
      rowsLikelyDuplicate: batch.rowsDuplicate,
      rowsUnreadable: unreadable,
    });
  }

  /**
   * Turns existing transactions into match targets **in statement terms**.
   *
   * The flip is the subtle part: on an asset account a *debit* posting is money
   * coming in, which the statement prints as a credit. Getting this backwards
   * would make the matcher compare every incoming debit against the ledger's
   * credits, find nothing, and cheerfully re-import the whole file.
   */
  static targetsFor(
    transactions: readonly Transaction[],
    accountId: AccountId,
  ): readonly MatchTarget[] {
    return transactions.flatMap((txn) => {
      const leg = txn.postings().find((posting) => posting.accountId.equals(accountId));
      if (!leg) return [];
      const direction: RowDirection = leg.isDebit ? "CREDIT" : "DEBIT";
      return [
        {
          transactionId: txn.id.value,
          date: txn.txnDate,
          amount: leg.amount,
          direction,
          externalId: txn.context.reference ?? txn.context.externalId ?? null,
        },
      ];
    });
  }

  private async categoriserContext(userId: UserId) {
    const [rules, payees, chart] = await Promise.all([
      this.rules.list(userId),
      this.selfPayees.list(userId),
      this.accounts.list(userId, { includeClosed: false }),
    ]);
    const accountIdByCode = new Map(chart.map((account) => [account.code.toString(), account.id]));
    return {
      rules,
      selfPayees: payees,
      accountIdByCode,
      fallbackExpenseId: accountIdByCode.get(SystemAccountCodes.uncategorizedExpense) ?? null,
      fallbackIncomeId: accountIdByCode.get(SystemAccountCodes.uncategorizedIncome) ?? null,
    };
  }
}

/* ═══ ReviewImportRow ═════════════════════════════════════════════════ */

export interface ReviewImportRowInput {
  userId: UserId;
  batchId: string;
  rowId: string;
  decision: "CONFIRM" | "REJECT";
  /** The category or counter-account to use, overriding what was proposed. */
  accountId?: AccountId | null;
  rejectedReason?: string;
}

/**
 * The user's decision on one staged row.
 *
 * This is the only thing that can set `CONFIRMED`, and `CONFIRMED` is the only
 * status {@link PostImportBatch} will post — which is invariant I01 expressed as
 * two small pieces of code rather than as a rule someone has to remember.
 */
export class ReviewImportRow implements UseCase<ReviewImportRowInput, { status: string }> {
  constructor(
    private readonly imports: ImportRepository,
    private readonly accounts: AccountRepository,
  ) {}

  async execute(input: ReviewImportRowInput): Promise<Result<{ status: string }, AppError>> {
    const rows = await this.imports.listRows(input.userId, input.batchId);
    const row = rows.find((candidate) => candidate.id === input.rowId);
    if (!row) return Err(new NotFoundError("Import row", input.rowId));

    if (input.decision === "REJECT") {
      await this.imports.setRowStatus(input.userId, row.id, {
        status: "REJECTED",
        rejectedReason: input.rejectedReason ?? "Rejected during review",
      });
      return Ok({ status: "REJECTED" });
    }

    const chosen = input.accountId ?? row.proposedAccountId;
    if (!chosen) {
      return Err(
        new ValidationError(
          row.intent === "TRANSFER" || row.intent === "INVESTMENT"
            ? "Choose the account this money moved to or from — a transfer needs both sides."
            : "Choose a category for this row.",
          { accountId: ["Required"] },
        ),
      );
    }
    const account = await this.accounts.findById(input.userId, chosen);
    if (!account) return Err(new NotFoundError("Account", chosen.value));

    await this.imports.setRowStatus(input.userId, row.id, {
      status: "CONFIRMED",
      proposedAccountId: chosen,
      // Confirming a row the matcher flagged is the user overruling it, so the
      // claim is cleared rather than left to contradict the confirmation.
      matchedTransactionId: null,
      matchPass: null,
    });
    return Ok({ status: "CONFIRMED" });
  }
}

/** Confirms every row the matcher did not flag, which is the common case. */
export class ConfirmUnmatchedRows
  implements UseCase<{ userId: UserId; batchId: string }, { confirmed: number; needingChoice: number }>
{
  constructor(private readonly imports: ImportRepository) {}

  async execute(input: { userId: UserId; batchId: string }) {
    const rows = await this.imports.listRows(input.userId, input.batchId, {
      statuses: ["PARSED"],
    });

    let confirmed = 0;
    let needingChoice = 0;
    for (const row of rows) {
      // A transfer has no category to fall back on: which account the money went
      // to is knowledge only the user has, so it stays for review rather than
      // being guessed.
      if (!row.proposedAccountId) {
        needingChoice += 1;
        continue;
      }
      await this.imports.setRowStatus(input.userId, row.id, {
        status: "CONFIRMED",
        proposedAccountId: row.proposedAccountId,
      });
      confirmed += 1;
    }

    return Ok({ confirmed, needingChoice });
  }
}

/* ═══ PostImportBatch ═════════════════════════════════════════════════ */

export interface PostImportBatchOutput {
  posted: number;
  skipped: number;
  failed: number;
  problems: readonly { rowId: string; reason: string }[];
}

/**
 * Posts the confirmed rows of a batch, and nothing else.
 *
 * The `statuses: ["CONFIRMED"]` filter is invariant I01's enforcement point. It is
 * a filter rather than a check-and-throw because a filter cannot be bypassed by a
 * caller passing the wrong flag: there is no argument here that could widen it.
 *
 * Each row's `fingerprint` goes onto the transaction, so a later overlapping
 * statement's identical row is rejected by the unique index even if this batch is
 * long forgotten.
 */
export class PostImportBatch
  implements UseCase<{ userId: UserId; batchId: string }, PostImportBatchOutput>
{
  constructor(
    private readonly imports: ImportRepository,
    private readonly accounts: AccountRepository,
    private readonly record: RecordTransaction,
    private readonly clock: Clock,
  ) {}

  async execute(input: {
    userId: UserId;
    batchId: string;
  }): Promise<Result<PostImportBatchOutput, AppError>> {
    const batch = await this.imports.findBatch(input.userId, input.batchId);
    if (!batch) return Err(new NotFoundError("Import batch", input.batchId));
    if (batch.status === "UNDONE") {
      return Err(new ValidationError("This import was undone; import the file again."));
    }
    if (!batch.accountId) {
      return Err(new ValidationError("This batch is not tied to an account."));
    }

    const account = await this.accounts.findById(input.userId, batch.accountId);
    if (!account) return Err(new NotFoundError("Account", batch.accountId.value));

    const rows = await this.imports.listRows(input.userId, input.batchId, {
      statuses: ["CONFIRMED"],
    });

    let posted = 0;
    const problems: { rowId: string; reason: string }[] = [];

    for (const row of rows) {
      // Already posted by an earlier run of this use case — a batch may be posted
      // twice if the first attempt failed part way, and re-posting must not
      // duplicate.
      if (row.matchedTransactionId) continue;

      const sides = PostImportBatch.sidesFor(row, account);
      if (!sides) {
        problems.push({ rowId: row.id, reason: "No category or counter-account chosen." });
        continue;
      }

      const result = await this.record.execute({
        userId: input.userId,
        fromAccountId: sides.from,
        toAccountId: sides.to,
        amount: row.amount,
        postedOn: row.date,
        narration: row.description,
        reference: row.reference,
        source: "IMPORT",
        importBatchId: input.batchId,
        fingerprint: fingerprintOf({
          accountId: account.id,
          date: row.date,
          amount: row.amount,
          direction: row.direction,
          description: row.description,
          occurrence: row.occurrence,
        }),
      });

      if (!result.ok) {
        problems.push({ rowId: row.id, reason: result.error.message });
        continue;
      }

      posted += 1;
      await this.imports.setRowStatus(input.userId, row.id, {
        status: "CONFIRMED",
        matchedTransactionId: result.value.transactionId.value,
        // Null pass distinguishes "this row became this transaction" from "this
        // row duplicated that one", which pass 1-3 mean.
        matchPass: null,
      });
    }

    await this.imports.setBatchOutcome(input.userId, input.batchId, {
      status: problems.length === 0 ? "COMPLETED" : "PARTIAL",
      rowsImported: posted,
      rowsFailed: problems.length,
      completedAt: this.clock.now(),
    });

    return Ok({
      posted,
      skipped: rows.length - posted - problems.length,
      failed: problems.length,
      problems,
    });
  }

  /**
   * Which two accounts a row moves money between.
   *
   * The category account is the destination of a spend and the source of a
   * receipt, and the budget keys on that same account — so no separate
   * `categoryId` is set on the posting. One fact, one column: a `categoryId` that
   * could disagree with the expense account it was posted to is a category
   * report that disagrees with the income statement.
   */
  static sidesFor(
    row: StagedRow,
    account: Account,
  ): { from: AccountId; to: AccountId } | null {
    if (!row.proposedAccountId) return null;
    return row.direction === "DEBIT"
      ? { from: account.id, to: row.proposedAccountId }
      : { from: row.proposedAccountId, to: account.id };
  }
}

/* ═══ UndoImport ══════════════════════════════════════════════════════ */

/**
 * Undoes an import.
 *
 * Tombstones every transaction the batch created — a soft delete, so what the
 * import did stays answerable — and marks the batch `UNDONE`, which frees the
 * file hash: a corrected re-import of the same file is exactly what a user does
 * next, and I02 must not block it.
 */
export class UndoImport
  implements UseCase<{ userId: UserId; batchId: string }, { reversed: number }>
{
  constructor(
    private readonly imports: ImportRepository,
    private readonly journal: TransactionRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: { userId: UserId; batchId: string }) {
    const batch = await this.imports.findBatch(input.userId, input.batchId);
    if (!batch) return Err(new NotFoundError("Import batch", input.batchId));
    if (batch.status === "UNDONE") return Ok({ reversed: 0 });

    const at = this.clock.now();
    const reversed = await this.journal.softDeleteByImportBatch(input.userId, input.batchId, at);
    await this.imports.setBatchOutcome(input.userId, input.batchId, {
      status: "UNDONE",
      rowsImported: 0,
      completedAt: at,
    });

    return Ok({ reversed });
  }
}

/* ═══ ReconcileAccount ════════════════════════════════════════════════ */

export interface ReconcileAccountInput {
  userId: UserId;
  accountId: AccountId;
  asOf: CalendarDate;
  /** The closing balance the statement prints. */
  statementClosing: Money;
  /** Optional staged batch, so unmatched rows can be counted into the report. */
  batchId?: string;
}

export class ReconcileAccount implements UseCase<ReconcileAccountInput, ReconciliationReport> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly balances: BalanceSource,
    private readonly imports: ImportRepository | null = null,
  ) {}

  async execute(input: ReconcileAccountInput): Promise<Result<ReconciliationReport, AppError>> {
    const account = await this.accounts.findById(input.userId, input.accountId);
    if (!account) return Err(new NotFoundError("Account", input.accountId.value));
    if (account.currency.code !== input.statementClosing.currency.code) {
      return Err(
        new ValidationError(
          `${account.displayName} is in ${account.currency.code}; the statement closing balance ` +
            `is in ${input.statementClosing.currency.code}.`,
        ),
      );
    }

    const ledgerClosing = await this.balances.balanceOf(input.userId, input.accountId, input.asOf);

    let unmatched = 0;
    if (input.batchId && this.imports) {
      const rows = await this.imports.listRows(input.userId, input.batchId, {
        statuses: ["PARSED", "DRAFT"],
      });
      unmatched = rows.length;
    }

    return Ok(
      reconcile({
        statementClosing: input.statementClosing,
        ledgerClosing,
        asOf: input.asOf,
        unmatchedStatementRows: unmatched,
        unexplainedTransactions: 0,
      }),
    );
  }
}

/* ═══ Budgets ═════════════════════════════════════════════════════════ */

export interface PlanBudgetsInput {
  userId: UserId;
  /** The months to plan, in order. */
  months: readonly string[];
}

/**
 * Builds the budget view for a run of months.
 *
 * Spending comes from {@link BalanceQuery.flowsByAccount} with `rollUp`, so a
 * budget on `Expenses:Food` covers everything under it — a budget that ignored
 * its own subtree would read as unspent while the money was going out through
 * `Expenses:Food:Groceries`.
 *
 * Income for the month is `availableFunds`. Not "cash in the bank": the envelope
 * question is "how much of what arrived this month can be allocated", and a bank
 * balance also contains last year's savings.
 */
export class PlanBudgets implements UseCase<PlanBudgetsInput, { months: readonly MonthBudget[] }> {
  constructor(
    private readonly budgets: BudgetRepository,
    private readonly balanceQuery: BalanceQuery,
    private readonly ledger: BudgetLedger = new BudgetLedger(),
  ) {}

  async execute(input: PlanBudgetsInput): Promise<Result<{ months: readonly MonthBudget[] }, AppError>> {
    if (input.months.length === 0) {
      return Err(new ValidationError("Give at least one month to plan."));
    }

    const stored = await this.budgets.listFor(input.userId, input.months);
    const currency = Currency.reporting;

    const monthly = await Promise.all(
      input.months.map(async (month) => {
        const range = DateRange.monthOf(CalendarDate.parse(`${month}-01`));
        const [expenses, income] = await Promise.all([
          this.balanceQuery.flowsByAccount(input.userId, range, { type: "EXPENSE", rollUp: true }),
          this.balanceQuery.flowsByAccount(input.userId, range, { type: "INCOME", rollUp: true }),
        ]);
        const spentByAccount = new Map(
          expenses.map((flow) => [flow.accountId.value, flow.amount]),
        );

        return {
          month,
          availableFunds: Money.total(
            income.map((flow) => flow.amount),
            currency,
          ),
          envelopes: resolveBudgets(stored, month).map((budget) => ({
            accountId: budget.accountId,
            month,
            budgeted: budget.limit,
            // §7's sign convention: spending is negative. `flowsByAccount`
            // returns an expense total signed in the account's own favour, i.e.
            // positive, so it is negated exactly once, here.
            spent: (spentByAccount.get(budget.accountId.value) ?? Money.zero(currency)).negated(),
            carryover: budget.carryover,
          })),
        };
      }),
    );

    return Ok({ months: this.ledger.plan(monthly) });
  }
}

/* ═══ SeedCategoryRules ═══════════════════════════════════════════════ */

/**
 * Turns the built-in keyword table into editable rules for a new user.
 *
 * Offered as rows rather than kept as behaviour: "why was this groceries?" then
 * has an answer the user can open and change, which is the whole argument for
 * keyword categorisation over a model.
 */
export class SeedCategoryRules implements UseCase<{ userId: UserId }, { created: number }> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly rules: CategoryRuleRepository,
  ) {}

  async execute(input: { userId: UserId }) {
    const chart = await this.accounts.list(input.userId, { includeClosed: true });
    const byCode = new Map(chart.map((account) => [account.code.toString(), account.id]));
    const created = await this.rules.saveMany(input.userId, Categoriser.seedRules(byCode));
    return Ok({ created });
  }
}


/* ═══ Cards ═══════════════════════════════════════════════════════════ */

export interface OpenCreditCardInput {
  userId: UserId;
  name: string;
  institution?: string | null;
  accountNumberSuffix?: string | null;
  terms: CardTerms;
  /** The balance already owed, as a positive amount. */
  openingBalance?: Money | null;
  openingBalanceOn?: CalendarDate;
}

/**
 * Opens a credit card.
 *
 * The opening balance is passed straight through as a positive amount owed:
 * `OpeningBalance` reads which side to debit off the account's legality role, so
 * the liability case and the asset case cannot diverge here and there. Nothing in
 * this use case knows that a card is negative to net worth — that comes from
 * `AccountType.LIABILITY`, which is the point of the plan's done-when.
 */
export class OpenCreditCard
  implements UseCase<OpenCreditCardInput, { accountId: AccountId; code: string }>
{
  constructor(
    private readonly openAccount: OpenAccount,
    private readonly cardTerms: CardTermsRepository,
  ) {}

  async execute(
    input: OpenCreditCardInput,
  ): Promise<Result<{ accountId: AccountId; code: string }, AppError>> {
    if (input.terms.creditLimit.isNegative) {
      return Err(
        new ValidationError("A credit limit is a positive amount.", {
          creditLimit: ["Must not be negative"],
        }),
      );
    }

    const opened = await this.openAccount.execute({
      userId: input.userId,
      name: input.name,
      type: "LIABILITY",
      subtype: "CREDIT_CARD",
      institution: input.institution,
      accountNumberSuffix: input.accountNumberSuffix,
      openingBalance: input.openingBalance,
      openingBalanceOn: input.openingBalanceOn,
    });
    if (!opened.ok) return opened;

    await this.cardTerms.save(input.userId, opened.value.accountId, input.terms);
    return Ok({ accountId: opened.value.accountId, code: opened.value.code });
  }
}

/** Terms can be edited without touching a posting — a limit increase is not an event. */
export class UpdateCardTerms
  implements UseCase<{ userId: UserId; accountId: AccountId; terms: CardTerms }, { updated: true }>
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly cardTerms: CardTermsRepository,
  ) {}

  async execute(
    input: { userId: UserId; accountId: AccountId; terms: CardTerms },
  ): Promise<Result<{ updated: true }, AppError>> {
    const account = await this.accounts.findById(input.userId, input.accountId);
    if (!account) return Err(new NotFoundError("Card", input.accountId.value));
    if (!CreditCard.classify(account, input.terms)) {
      return Err(
        new ValidationError(
          `${account.displayName} is not a credit card, so card terms do not apply to it.`,
        ),
      );
    }
    await this.cardTerms.save(input.userId, input.accountId, input.terms);
    return Ok({ updated: true as const });
  }
}

export interface CardSummary {
  readonly card: CreditCard;
  /** Positive means owed. */
  readonly owed: Money;
  readonly available: Money;
  readonly utilisation: Percentage;
  readonly cycle: BillingCycle;
  /** What the last generated statement says is due, and by when. */
  readonly statement: CardStatement;
  readonly daysToDue: number;
}

/**
 * Every card, with the figures the list screen shows.
 *
 * The statement is built for the cycle that has **closed most recently**, not the
 * one in progress: "amount due" is a statement fact, and quoting the running
 * balance of an open cycle as the amount due would tell the user to pay money the
 * issuer has not yet billed.
 */
export class ListCards implements UseCase<{ userId: UserId; asOf: CalendarDate }, { cards: readonly CardSummary[] }> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly journal: TransactionRepository,
    private readonly balances: BalanceSource,
    private readonly cardTerms: CardTermsRepository,
  ) {}

  async execute(
    input: { userId: UserId; asOf: CalendarDate },
  ): Promise<Result<{ cards: readonly CardSummary[] }, AppError>> {
    const accounts = await this.accounts.list(input.userId, { includeClosed: false });
    const cardSubtype = accounts.filter((account) => account.subtype === "CREDIT_CARD");
    const termsById = await this.cardTerms.findManyFor(
      input.userId,
      cardSubtype.map((account) => account.id),
    );

    /*
     * The seeded chart's own `Liabilities:Credit Cards` group account has the card
     * subtype too, so "every account with subtype CREDIT_CARD" listed a card the
     * user never opened. A card is one that has *terms* — which `OpenCreditCard`
     * always writes — or one carrying a balance, so a card created through the
     * generic account path is not hidden from its owner either.
     */
    const balancesById = new Map(
      await Promise.all(
        cardSubtype.map(
          async (account) =>
            [
              account.id.value,
              await this.balances.balanceOf(input.userId, account.id, input.asOf),
            ] as const,
        ),
      ),
    );
    const cardAccounts = cardSubtype.filter(
      (account) =>
        termsById.has(account.id.value) || !(balancesById.get(account.id.value)?.isZero ?? true),
    );

    const summaries = await Promise.all(
      cardAccounts.map(async (account) => {
        const terms = termsById.get(account.id.value) ?? CreditCard.defaultTerms(account.currency);
        const card = new CreditCard(account, terms);

        // The last cycle whose statement has been generated.
        const current = card.cycleFor(input.asOf);
        const closed = current.through.isOnOrBefore(input.asOf)
          ? current
          : terms.cycle.cycleContaining(current.from.plusDays(-1));

        const [owed, statement] = await Promise.all([
          card.valueOn(input.asOf, this.balances),
          buildCardStatement({
            card,
            cycle: closed,
            userId: input.userId,
            accounts,
            journal: this.journal,
            balances: this.balances,
          }),
        ]);

        return {
          card,
          owed,
          available: card.availableCredit(owed),
          utilisation: card.utilisation(owed),
          cycle: current,
          statement,
          daysToDue: input.asOf.daysUntil(closed.dueOn),
        };
      }),
    );

    return Ok({ cards: summaries });
  }
}

export interface CardDetailInput {
  userId: UserId;
  accountId: AccountId;
  asOf: CalendarDate;
  /** How many closed cycles of history to build. */
  cycles?: number;
}

export interface CardDetail {
  readonly card: CreditCard;
  readonly owed: Money;
  readonly available: Money;
  readonly utilisation: Percentage;
  readonly currentCycle: BillingCycle;
  /** Newest last, so a timeline reads left to right. */
  readonly statements: readonly CardStatement[];
  readonly points: RewardPointBalance;
}

/**
 * One card, with a run of statements rebuilt from the ledger.
 *
 * Statements are *reconstructed*, never stored, so history is answerable for
 * months that predate the app. Reward points are computed from the spends the
 * ledger holds rather than tracked as a balance, because a stored points balance
 * would be a second number nothing reconciles — and points are exactly the kind of
 * figure an issuer silently adjusts.
 */
export class ViewCard implements UseCase<CardDetailInput, CardDetail> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly journal: TransactionRepository,
    private readonly balances: BalanceSource,
    private readonly cardTerms: CardTermsRepository,
  ) {}

  async execute(input: CardDetailInput): Promise<Result<CardDetail, AppError>> {
    const accounts = await this.accounts.list(input.userId, { includeClosed: true });
    const account = accounts.find((candidate) => candidate.id.equals(input.accountId));
    if (!account) return Err(new NotFoundError("Card", input.accountId.value));

    const terms =
      (await this.cardTerms.findFor(input.userId, input.accountId)) ??
      CreditCard.defaultTerms(account.currency);
    const card = CreditCard.classify(account, terms);
    if (!card) {
      return Err(new ValidationError(`${account.displayName} is not a credit card.`));
    }

    const cycles = card.recentCycles(input.asOf, input.cycles ?? 6);
    const statements = await Promise.all(
      cycles.map((cycle) =>
        buildCardStatement({
          card,
          cycle,
          userId: input.userId,
          accounts,
          journal: this.journal,
          balances: this.balances,
        }),
      ),
    );

    const owed = await card.valueOn(input.asOf, this.balances);
    const earned = statements.reduce(
      (total, statement) => total.plus(card.pointsFor(statement.spends)),
      Quantity.ZERO,
    );

    return Ok({
      card,
      owed,
      available: card.availableCredit(owed),
      utilisation: card.utilisation(owed),
      currentCycle: card.cycleFor(input.asOf),
      statements,
      points: new RewardPointBalance(earned),
    });
  }
}

/**
 * Builds one statement from the postings on the card account.
 *
 * The mapping from a posting to a movement kind is the part with an opinion:
 *
 *   - a **credit** on the card increases the debt, so it is a `SPEND` — or a
 *     `CHARGE` when the transaction is one (a fee, interest), because rolling a
 *     ₹590 late fee into "spent on food" is a wrong budget nobody can see;
 *   - a **debit** reduces it, and is a `PAYMENT` when the other leg is an account
 *     the user owns and a `REFUND` when it is a category. That distinction cannot
 *     be read off the card's own leg, which is why the other leg is consulted.
 */
async function buildCardStatement(context: {
  card: CreditCard;
  cycle: BillingCycle;
  userId: UserId;
  accounts: readonly Account[];
  journal: TransactionRepository;
  balances: BalanceSource;
}): Promise<CardStatement> {
  const { card, cycle, userId, accounts, journal, balances } = context;
  const byId = new Map(accounts.map((account) => [account.id.value, account]));

  const [opening, page] = await Promise.all([
    balances.balanceOf(userId, card.id, cycle.from.plusDays(-1)),
    journal.find(userId, { accountIds: [card.id], range: cycle.range, limit: 5000 }),
  ]);

  const movements: CardMovement[] = [];
  for (const txn of page.transactions) {
    for (const posting of txn.postings()) {
      if (!posting.accountId.equals(card.id)) continue;

      const otherLeg = txn
        .postings()
        .find((candidate) => !candidate.accountId.equals(card.id));
      const otherAccount = otherLeg ? byId.get(otherLeg.accountId.value) : undefined;

      const kind: CardMovement["kind"] = posting.isDebit
        ? otherAccount?.type.isIncomeStatement
          ? "REFUND"
          : "PAYMENT"
        : txn.kind === "FEE" || txn.kind === "INTEREST" || txn.kind === "OPENING_BALANCE"
          ? "CHARGE"
          : "SPEND";

      movements.push({
        on: txn.txnDate,
        amount: posting.amount,
        kind,
        description: txn.description,
      });
    }
  }

  return card.statementFor(cycle, opening, movements);
}

export interface PayCardInput {
  userId: UserId;
  fromAccountId: AccountId;
  cardAccountId: AccountId;
  amount: Money;
  postedOn: CalendarDate;
  narration?: string;
}

/**
 * Pays a card bill.
 *
 * A `Transfer`, never an expense — the plan's done-when, and it falls out of
 * {@link RecordAccountTransfer} rather than being enforced here: both sides are
 * balance-sheet accounts, so `RecordTransaction` builds a `Transfer`, which by
 * construction carries no budget category (L12). The spending was already
 * recorded when the card was used; counting the payment as spending too would
 * double every rupee that goes through a card.
 */
export class PayCard implements UseCase<PayCardInput, { transactionId: string }> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly transfer: RecordAccountTransfer,
  ) {}

  async execute(input: PayCardInput): Promise<Result<{ transactionId: string }, AppError>> {
    const card = await this.accounts.findById(input.userId, input.cardAccountId);
    if (!card) return Err(new NotFoundError("Card", input.cardAccountId.value));
    if (card.subtype !== "CREDIT_CARD") {
      return Err(new ValidationError(`${card.displayName} is not a credit card.`));
    }

    return this.transfer.execute({
      userId: input.userId,
      fromAccountId: input.fromAccountId,
      toAccountId: input.cardAccountId,
      amount: input.amount,
      postedOn: input.postedOn,
      narration: input.narration?.trim() || `Payment to ${card.displayName}`,
    });
  }
}

/**
 * Posts the interest and fees a cycle earned, as `Charge` transactions.
 *
 * Interest is computed from the daily balances the ledger already implies, so the
 * figure is reproducible from the postings rather than taken from the issuer's
 * statement on trust — which is what makes "the issuer billed something else" a
 * question the app can answer instead of a discrepancy it inherits.
 *
 * Each charge is booked to an expense account (`Expenses:Fees:Interest`,
 * `Expenses:Fees:Bank`) *from* the card, so it increases the debt and appears as a
 * cost. Interest on a card is genuinely an expense; a payment is not.
 */
export interface AccrueCardChargesInput {
  userId: UserId;
  cardAccountId: AccountId;
  /** The cycle to charge for — normally the one that has just closed. */
  statementDate: CalendarDate;
  /** Set when the cardholder missed the minimum due, so the late fee applies. */
  lateFeeApplies?: boolean;
  /** Set on the anniversary, so the annual fee applies. */
  annualFeeApplies?: boolean;
}

export interface AccrueCardChargesOutput {
  interest: Money;
  fees: Money;
  gst: Money;
  transactionIds: readonly string[];
}

export class AccrueCardCharges
  implements UseCase<AccrueCardChargesInput, AccrueCardChargesOutput>
{
  constructor(
    private readonly accounts: AccountRepository,
    private readonly journal: TransactionRepository,
    private readonly balances: BalanceSource,
    private readonly cardTerms: CardTermsRepository,
    private readonly record: RecordTransaction,
  ) {}

  async execute(input: AccrueCardChargesInput): Promise<Result<AccrueCardChargesOutput, AppError>> {
    const accounts = await this.accounts.list(input.userId, { includeClosed: false });
    const account = accounts.find((candidate) => candidate.id.equals(input.cardAccountId));
    if (!account) return Err(new NotFoundError("Card", input.cardAccountId.value));

    const terms =
      (await this.cardTerms.findFor(input.userId, input.cardAccountId)) ??
      CreditCard.defaultTerms(account.currency);
    const card = CreditCard.classify(account, terms);
    if (!card) return Err(new ValidationError(`${account.displayName} is not a credit card.`));

    const cycle = card.cycleFor(input.statementDate);
    const previous = terms.cycle.cycleContaining(cycle.from.plusDays(-1));

    // Interest is charged only on what was carried past the previous due date.
    const carried = await this.balances.balanceOf(input.userId, card.id, previous.dueOn);
    const dailyBalances: { on: CalendarDate; owed: Money }[] = [];
    if (carried.isPositive) {
      for (let cursor = previous.dueOn; cursor.isOnOrBefore(cycle.through); cursor = cursor.plusDays(1)) {
        dailyBalances.push({
          on: cursor,
          owed: await this.balances.balanceOf(input.userId, card.id, cursor),
        });
      }
    }

    const finance = card.financeChargeFor({ dailyBalances });
    const interestAccount = accounts.find(
      (candidate) => candidate.code.toString() === "Expenses:Fees:Interest",
    );
    const feeAccount = accounts.find(
      (candidate) => candidate.code.toString() === "Expenses:Fees:Bank",
    );
    if (!interestAccount || !feeAccount) {
      return Err(
        new NotFoundError("System fee accounts — seed the chart of accounts first"),
      );
    }

    const transactionIds: string[] = [];
    let fees = Money.zero(account.currency);
    let gst = finance.gstOnInterest;

    const post = async (amount: Money, to: Account, narration: string) => {
      if (!amount.isPositive) return;
      const result = await this.record.execute({
        userId: input.userId,
        fromAccountId: card.id,
        toAccountId: to.id,
        amount,
        postedOn: input.statementDate,
        narration,
        chargeDeductibility: "NOT_DEDUCTIBLE",
      });
      if (result.ok) transactionIds.push(result.value.transactionId.value);
    };

    await post(finance.interest, interestAccount, `Finance charge — ${cycle.label}`);
    await post(finance.gstOnInterest, feeAccount, `GST on finance charge — ${cycle.label}`);

    if (input.lateFeeApplies) {
      const fee = terms.lateFee;
      const feeGst = terms.gstOnCharges.applyTo(fee);
      fees = fees.plus(fee);
      gst = gst.plus(feeGst);
      await post(fee, feeAccount, `Late payment fee — ${cycle.label}`);
      await post(feeGst, feeAccount, `GST on late payment fee — ${cycle.label}`);
    }
    if (input.annualFeeApplies) {
      const fee = terms.annualFee;
      const feeGst = terms.gstOnCharges.applyTo(fee);
      fees = fees.plus(fee);
      gst = gst.plus(feeGst);
      await post(fee, feeAccount, `Annual fee — ${cycle.label}`);
      await post(feeGst, feeAccount, `GST on annual fee — ${cycle.label}`);
    }

    return Ok({ interest: finance.interest, fees, gst, transactionIds });
  }
}

/* ═══ Re-exports for the UI layer ═════════════════════════════════════ */

export type { LiquidPosition, MovementIntent, ReconciliationReport, StagedRow };
export { AccountCode };
