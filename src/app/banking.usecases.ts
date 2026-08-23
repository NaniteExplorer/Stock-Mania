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
import { CalendarDate, DateRange } from "@/core/time";
import { Account, AccountCode, AccountId, AccountRepository, AccountSubtype, AccountType, SystemAccountCodes } from "@/domain/accounts";
import { BalanceSource, CashAsset, LiquidPosition, liquidPositions, totalLiquid } from "@/domain/assets";
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

/* ═══ Re-exports for the UI layer ═════════════════════════════════════ */

export type { LiquidPosition, MovementIntent, ReconciliationReport, StagedRow };
export { AccountCode };
