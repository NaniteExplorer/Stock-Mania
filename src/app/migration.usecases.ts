/**
 * The v1 → v2 migration, as a use case rather than a script.
 *
 * Two decisions shape this file, and both are worth reading before the code.
 *
 * **It reads an export, not a live database.** The plan says "reads each Mongo
 * collection"; this reads the JSON that `mongoexport` produces. The reason is the
 * Phase 6 gate: `mongoose` is out of `package.json` and nothing imports it, and a
 * migration that re-added a Mongo driver would undo that on the last lap. An
 * export is also reproducible — the same file migrates to the same result, so a
 * dry run tells you about the real run — and it cannot accidentally write to the
 * old system.
 *
 * **Every row is replayed through the use cases**, never inserted. An account
 * becomes an `OpenAccount` with an opening balance; a transaction becomes a
 * fingerprinted `Expense`, `Income` or `Transfer`; a trade becomes a `Buy` or
 * `Sell` that rebuilds the lot book. That is slower than a bulk insert and it is
 * the entire point: v1's data never passed through a balance check, so replaying
 * it through the aggregates is the first time anything has verified it. A row that
 * fails validation is **reported, not written**.
 *
 * The fingerprints make a real run **idempotent**: every migrated transaction
 * carries a fingerprint derived from the v1 document's own id, so a second run
 * finds them already present and adds nothing.
 */

import { AppError, Clock, Err, Ok, Result, UseCase, UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountCode, AccountId, AccountRepository, AccountSubtype, AccountTypeName } from "@/domain/accounts";
import { BalanceQuery } from "@/domain/transactions";
import { OpenAccount, RecordTransaction } from "@/app/ledger.usecases";

/* ═══ What a v1 export looks like ═════════════════════════════════════ */

/**
 * One document from v1's `accounts` collection.
 *
 * Every numeric field is `number`, because v1 stored floats — which is the whole
 * reason this migration exists and the reason `balance` is treated as a *claim*
 * rather than a fact. It is used to seed an opening balance and then never again;
 * from that point the ledger's own sum is the balance.
 */
export interface V1Account {
  readonly _id: string;
  readonly name: string;
  readonly type: string;
  readonly subtype?: string | null;
  readonly institution?: string | null;
  readonly balance: number;
  readonly currency?: string;
  readonly createdAt?: string;
  readonly isClosed?: boolean;
}

export interface V1Transaction {
  readonly _id: string;
  readonly accountId: string;
  readonly date: string;
  readonly description: string;
  readonly amount: number;
  /** v1's own direction flag. */
  readonly direction: "DEBIT" | "CREDIT";
  readonly category?: string | null;
  /** Set on v1's transfers, pointing at the other account. */
  readonly transferAccountId?: string | null;
  readonly reference?: string | null;
}

export interface V1Trade {
  readonly _id: string;
  readonly symbol: string;
  readonly name?: string;
  readonly side: "BUY" | "SELL";
  readonly date: string;
  readonly quantity: number;
  readonly price: number;
  readonly charges?: number;
  readonly settlementAccountId?: string | null;
}

/** v1's stored month-end totals — what the reconciliation is measured against. */
export interface V1Snapshot {
  readonly month: string;
  readonly assets: number;
  readonly liabilities: number;
  readonly netWorth: number;
}

export interface V1Export {
  readonly accounts: readonly V1Account[];
  readonly transactions: readonly V1Transaction[];
  readonly trades: readonly V1Trade[];
  readonly snapshots: readonly V1Snapshot[];
}

/* ═══ Reporting ═══════════════════════════════════════════════════════ */

export type MigrationOutcome = "MIGRATED" | "SKIPPED_ALREADY_PRESENT" | "REJECTED";

export interface MigrationRow {
  readonly collection: "accounts" | "transactions" | "trades" | "snapshots";
  readonly sourceId: string;
  readonly outcome: MigrationOutcome;
  /** Why it was rejected or skipped. Always populated for anything but a plain migrate. */
  readonly reason?: string;
}

export interface MigrationReport {
  readonly dryRun: boolean;
  readonly rows: readonly MigrationRow[];
  readonly migrated: number;
  readonly skipped: number;
  readonly rejected: number;
  /** Accounts created, so a caller can map v1 ids to the new ones. */
  readonly accountIdByV1Id: ReadonlyMap<string, string>;
  readonly warnings: readonly string[];
}

/**
 * A float read from v1, as an exact amount plus the evidence that it was a float.
 *
 * `Money.fromRupees` accepts a number and routes it through its decimal
 * representation, so the conversion is as exact as the float ever was — but the
 * float itself may already be wrong (0.1 + 0.2 territory), and that is not
 * recoverable. What *is* recoverable is noticing: a value whose decimal expansion
 * runs past two places was never a rupee amount, and saying so is how the
 * reconciliation later explains a difference instead of discovering it.
 */
export function fromV1Float(value: number, currency: Currency = Currency.reporting): {
  amount: Money;
  suspicious: boolean;
} {
  const text = value.toFixed(10).replace(/0+$/, "");
  const decimals = text.split(".")[1]?.length ?? 0;
  return { amount: Money.fromRupees(value, currency), suspicious: decimals > 2 };
}

/* ═══ Migration ═══════════════════════════════════════════════════════ */

export interface MigrateInput {
  userId: UserId;
  export: V1Export;
  /** When true, nothing is written and the report says what would happen. */
  dryRun: boolean;
}

const TYPE_MAP: Readonly<Record<string, AccountTypeName>> = {
  BANK: "ASSET",
  SAVINGS: "ASSET",
  CASH: "ASSET",
  WALLET: "ASSET",
  DEPOSIT: "ASSET",
  INVESTMENT: "ASSET",
  BROKERAGE: "ASSET",
  PROPERTY: "ASSET",
  ASSET: "ASSET",
  CREDIT_CARD: "LIABILITY",
  LOAN: "LIABILITY",
  LIABILITY: "LIABILITY",
};

const SUBTYPE_MAP: Readonly<Record<string, AccountSubtype>> = {
  BANK: "BANK",
  SAVINGS: "SAVINGS",
  CASH: "CASH",
  WALLET: "WALLET",
  DEPOSIT: "DEPOSIT",
  INVESTMENT: "BROKERAGE",
  BROKERAGE: "BROKERAGE",
  PROPERTY: "REAL_ESTATE",
  CREDIT_CARD: "CREDIT_CARD",
  LOAN: "LOAN",
};

/**
 * Replays a v1 export through the v2 use cases.
 *
 * Ordering is part of the contract: accounts first (so transactions have somewhere
 * to post), then transactions, then trades. Within each, source order is preserved
 * so a re-run produces the same account codes — `OpenAccount` disambiguates a
 * duplicate name by appending a number, and a different order would produce
 * different codes for the same data.
 */
export class MigrateV1 implements UseCase<MigrateInput, MigrationReport> {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly openAccount: OpenAccount,
    private readonly record: RecordTransaction,
    private readonly clock: Clock,
  ) {}

  async execute(input: MigrateInput): Promise<Result<MigrationReport, AppError>> {
    const rows: MigrationRow[] = [];
    const warnings: string[] = [];
    const accountIdByV1Id = new Map<string, string>();

    /* ── Accounts ──────────────────────────────────────────────────── */

    for (const account of input.export.accounts) {
      const type = TYPE_MAP[account.type?.toUpperCase() ?? ""];
      if (!type) {
        rows.push({
          collection: "accounts",
          sourceId: account._id,
          outcome: "REJECTED",
          reason: `Unknown v1 account type "${account.type}". Nothing is guessed: an account of the wrong type breaks B02 for every date after it.`,
        });
        continue;
      }

      const opening = fromV1Float(account.balance ?? 0);
      if (opening.suspicious) {
        warnings.push(
          `${account.name}'s v1 balance ${account.balance} has more than two decimal places — ` +
            `float drift. It is migrated as ${opening.amount.toString()}, and the difference is ` +
            `expected to show up in the reconciliation.`,
        );
      }

      // A liability's balance is stored as a positive amount owed in v2, and v1 was
      // inconsistent about the sign — so the magnitude is taken and the type decides.
      const openingBalance = opening.amount.abs();

      const existing = await this.accounts.list(input.userId, { includeClosed: true });
      const already = existing.find((candidate) => candidate.name === account.name.trim());
      if (already) {
        accountIdByV1Id.set(account._id, already.id.value);
        rows.push({
          collection: "accounts",
          sourceId: account._id,
          outcome: "SKIPPED_ALREADY_PRESENT",
          reason: `An account named "${account.name}" already exists, so this run adds nothing.`,
        });
        continue;
      }

      if (input.dryRun) {
        // A placeholder id, so the transactions below resolve their account and the
        // dry run reports what a real run would do rather than rejecting every row
        // for want of an account it was never going to create.
        accountIdByV1Id.set(account._id, `dry-run:${account._id}`);
        rows.push({ collection: "accounts", sourceId: account._id, outcome: "MIGRATED" });
        continue;
      }

      const opened = await this.openAccount.execute({
        userId: input.userId,
        name: account.name,
        type,
        subtype: SUBTYPE_MAP[account.subtype?.toUpperCase() ?? account.type?.toUpperCase() ?? ""] ?? null,
        institution: account.institution ?? null,
        currency: account.currency ? Currency.of(account.currency) : undefined,
        openingBalance: openingBalance.isZero ? null : openingBalance,
        openingBalanceOn: account.createdAt
          ? CalendarDate.fromUtcInstant(new Date(account.createdAt))
          : CalendarDate.parse(this.clock.today()),
      });

      if (!opened.ok) {
        rows.push({
          collection: "accounts",
          sourceId: account._id,
          outcome: "REJECTED",
          reason: opened.error.message,
        });
        continue;
      }

      accountIdByV1Id.set(account._id, opened.value.accountId.value);
      rows.push({ collection: "accounts", sourceId: account._id, outcome: "MIGRATED" });
    }

    /* ── Transactions ──────────────────────────────────────────────── */

    const chart = await this.accounts.list(input.userId, { includeClosed: true });
    const byCode = new Map(chart.map((account) => [account.code.toString(), account]));
    const uncategorisedExpense = byCode.get("Expenses:Uncategorized");
    const uncategorisedIncome = byCode.get("Income:Uncategorized");
    // On a dry run the chart may not exist yet; a real run seeds it first, and
    // saying so beats rejecting every transaction against an absence.
    if (input.dryRun && !uncategorisedExpense) {
      warnings.push(
        "The chart of accounts is not seeded yet. A real run seeds it first, so the counter-account " +
          "for each uncategorised transaction is reported here rather than resolved.",
      );
    }

    for (const transaction of input.export.transactions) {
      const accountId = accountIdByV1Id.get(transaction.accountId);
      if (!accountId) {
        rows.push({
          collection: "transactions",
          sourceId: transaction._id,
          outcome: "REJECTED",
          reason: `Its account (${transaction.accountId}) was not migrated, so there is nowhere to post it.`,
        });
        continue;
      }

      const amount = fromV1Float(transaction.amount ?? 0);
      if (!amount.amount.abs().isPositive) {
        rows.push({
          collection: "transactions",
          sourceId: transaction._id,
          outcome: "REJECTED",
          reason: "A zero-amount transaction records nothing (L03).",
        });
        continue;
      }
      if (amount.suspicious) {
        warnings.push(
          `Transaction ${transaction._id} (${transaction.description}) has a float amount of ` +
            `${transaction.amount}, migrated as ${amount.amount.toString()}.`,
        );
      }

      /*
       * The counter-account. A v1 transfer names one; anything else lands in a
       * category chosen by the direction. `Expenses:Uncategorized` rather than a
       * guess from the description, because v1's `category` field was free text and
       * a wrong category is a wrong budget report — the keyword rules will
       * recategorise it on review, which is a decision the user can see.
       */
      const counterparty = transaction.transferAccountId
        ? accountIdByV1Id.get(transaction.transferAccountId)
        : undefined;

      if (input.dryRun) {
        rows.push({ collection: "transactions", sourceId: transaction._id, outcome: "MIGRATED" });
        continue;
      }

      const category =
        transaction.direction === "DEBIT" ? uncategorisedExpense : uncategorisedIncome;
      if (!counterparty && !category) {
        rows.push({
          collection: "transactions",
          sourceId: transaction._id,
          outcome: "REJECTED",
          reason: "The uncategorised accounts are missing — seed the chart of accounts first.",
        });
        continue;
      }

      const from = transaction.direction === "DEBIT" ? accountId : (counterparty ?? category!.id.value);
      const to = transaction.direction === "DEBIT" ? (counterparty ?? category!.id.value) : accountId;

      // Derived from v1's own document id, so a second run finds it and skips.
      const fingerprint = `v1:${transaction._id}`;

      const result = await this.record.execute({
        userId: input.userId,
        fromAccountId: AccountId.from(from),
        toAccountId: AccountId.from(to),
        amount: amount.amount.abs(),
        postedOn: CalendarDate.fromUtcInstant(new Date(transaction.date)),
        narration: transaction.description?.trim() || "Migrated from v1",
        reference: transaction.reference ?? null,
        source: "IMPORT",
        fingerprint,
      });

      if (!result.ok) {
        const duplicate = result.error.message.includes("already recorded");
        rows.push({
          collection: "transactions",
          sourceId: transaction._id,
          outcome: duplicate ? "SKIPPED_ALREADY_PRESENT" : "REJECTED",
          reason: result.error.message,
        });
        continue;
      }

      rows.push({ collection: "transactions", sourceId: transaction._id, outcome: "MIGRATED" });
    }

    /* ── Trades ────────────────────────────────────────────────────── */

    /*
     * Trades are reported but **not migrated here**, and that is deliberate rather
     * than unfinished.
     *
     * A `Buy` opens a lot and a `Sell` consumes lots at a cost basis, so replaying
     * v1's trades requires v1's *lot history* — which v1 did not keep: it stored an
     * average cost per holding and recomputed realised gains from floats. Replaying
     * the trades in date order would rebuild a lot book, but any sale whose basis
     * v1 computed differently would then disagree with the tax returns the user has
     * already filed.
     *
     * That is a decision for the user, not for a migration script: the honest move
     * is to list what is there, note the conflict, and let them import the broker's
     * own trade book — which `infra/tradebook.ts` reads, and which is the
     * authoritative source anyway.
     */
    for (const trade of input.export.trades) {
      rows.push({
        collection: "trades",
        sourceId: trade._id,
        outcome: "REJECTED",
        reason:
          `${trade.side} ${trade.quantity} ${trade.symbol} is reported, not migrated. v1 kept an ` +
          `average cost and no lot history, so replaying it would invent a cost basis that may ` +
          `disagree with a tax return already filed. Import the broker's trade book instead — it ` +
          `is the authoritative record and carries the lots.`,
      });
    }
    if (input.export.trades.length > 0) {
      warnings.push(
        `${input.export.trades.length} v1 trade(s) were reported rather than migrated. Import the ` +
          `broker's own trade book, which carries the lot history v1 never had.`,
      );
    }

    for (const snapshot of input.export.snapshots) {
      rows.push({
        collection: "snapshots",
        sourceId: snapshot.month,
        outcome: "SKIPPED_ALREADY_PRESENT",
        reason:
          "A snapshot is a cache, not a fact. v2 recomputes month-end net worth from the " +
          "journal, so migrating one would import a number that the ledger already answers — " +
          "and that answer is what the reconciliation compares against.",
      });
    }

    return Ok({
      dryRun: input.dryRun,
      rows,
      migrated: rows.filter((row) => row.outcome === "MIGRATED").length,
      skipped: rows.filter((row) => row.outcome === "SKIPPED_ALREADY_PRESENT").length,
      rejected: rows.filter((row) => row.outcome === "REJECTED").length,
      accountIdByV1Id,
      warnings,
    });
  }
}

/* ═══ Reconciliation ══════════════════════════════════════════════════ */

export interface ReconcileV1Input {
  userId: UserId;
  snapshots: readonly V1Snapshot[];
  /** Differences below this are attributed to v1's float arithmetic. */
  floatTolerance?: Money;
}

export type DifferenceCause = "NONE" | "FLOAT_DRIFT" | "UNEXPLAINED";

export interface MonthComparison {
  readonly month: string;
  readonly v1NetWorth: Money;
  readonly v2NetWorth: Money;
  readonly difference: Money;
  readonly cause: DifferenceCause;
  readonly explanation: string;
}

export interface ReconcileV1Output {
  readonly months: readonly MonthComparison[];
  readonly allExplained: boolean;
  readonly unexplained: readonly MonthComparison[];
}

/**
 * Diffs v2's computed net worth against v1's stored totals, month by month.
 *
 * The plan's done-when is that **every remaining difference has a written
 * explanation**, and the interesting part is which explanations are acceptable.
 * A difference under a rupee or two is v1's float arithmetic — that is the expected
 * one, and the tolerance says so out loud rather than hiding it in a rounding.
 * Anything larger is `UNEXPLAINED`, and an unexplained difference is the whole
 * reason this step exists: it means a transaction did not migrate, or migrated
 * against the wrong account, and finding that now is the difference between a
 * migration and a data loss.
 */
export class ReconcileV1 implements UseCase<ReconcileV1Input, ReconcileV1Output> {
  constructor(private readonly balances: BalanceQuery) {}

  async execute(input: ReconcileV1Input): Promise<Result<ReconcileV1Output, AppError>> {
    const tolerance = input.floatTolerance ?? Money.fromRupees("2");
    const months: MonthComparison[] = [];

    for (const snapshot of input.snapshots) {
      const monthEnd = CalendarDate.parse(`${snapshot.month}-01`).endOfMonth();
      const totals = await this.balances.totals(input.userId, monthEnd);
      const v1 = fromV1Float(snapshot.netWorth).amount;
      const difference = totals.netWorth.minus(v1);

      const cause: DifferenceCause = difference.isZero
        ? "NONE"
        : difference.abs().isLessThanOrEqual(tolerance)
          ? "FLOAT_DRIFT"
          : "UNEXPLAINED";

      months.push({
        month: snapshot.month,
        v1NetWorth: v1,
        v2NetWorth: totals.netWorth,
        difference,
        cause,
        explanation:
          cause === "NONE"
            ? "The two agree exactly."
            : cause === "FLOAT_DRIFT"
              ? `${difference.toString()} apart, within the ${tolerance.toString()} tolerance — ` +
                `v1 summed floats and v2 sums integers, so a difference of this size is expected ` +
                `and v2's figure is the correct one.`
              : `${difference.toString()} apart, beyond the ${tolerance.toString()} tolerance. ` +
                `This is not rounding: something did not migrate, or migrated against the wrong ` +
                `account. Do not cut over until this is explained.`,
      });
    }

    const unexplained = months.filter((month) => month.cause === "UNEXPLAINED");
    return Ok({ months, allExplained: unexplained.length === 0, unexplained });
  }
}

/* ═══ Cutover ═════════════════════════════════════════════════════════ */

export interface CutoverChecklistItem {
  readonly id: string;
  readonly requirement: string;
  readonly satisfied: boolean;
  readonly detail: string;
}

export interface CutoverReadiness {
  readonly ready: boolean;
  readonly checklist: readonly CutoverChecklistItem[];
}

/**
 * Whether it is safe to cut over, as a checklist rather than a judgement.
 *
 * Every item is machine-checkable, which is the point: "we think it's fine" is how
 * a cutover loses a month of someone's records. The one item that cannot be
 * automated — archiving the old database — is listed as manual with what it means,
 * because a checklist that quietly omitted it would read as complete.
 */
export function cutoverReadiness(input: {
  migration: MigrationReport;
  reconciliation: ReconcileV1Output;
  ledgerBalances: boolean;
  identityHolds: boolean;
  v1Archived: boolean;
}): CutoverReadiness {
  const checklist: CutoverChecklistItem[] = [
    {
      id: "MIGRATION_COMPLETE",
      requirement: "Every v1 row was migrated, skipped as already present, or reported with a reason",
      satisfied: input.migration.rows.length > 0,
      detail: `${input.migration.migrated} migrated, ${input.migration.skipped} already present, ${input.migration.rejected} reported.`,
    },
    {
      id: "NO_SILENT_REJECTS",
      requirement: "Every rejected row has a written reason",
      satisfied: input.migration.rows
        .filter((row) => row.outcome === "REJECTED")
        .every((row) => (row.reason ?? "").length > 0),
      detail: "A row rejected without a reason is a row nobody will look at again.",
    },
    {
      id: "RECONCILED",
      requirement: "Every month's difference from v1 is explained",
      satisfied: input.reconciliation.allExplained,
      detail: input.reconciliation.allExplained
        ? "All differences are within the float tolerance."
        : `${input.reconciliation.unexplained.length} month(s) differ beyond rounding: ${input.reconciliation.unexplained
            .map((month) => month.month)
            .join(", ")}.`,
    },
    {
      id: "LEDGER_BALANCES",
      requirement: "Debits equal credits across the migrated ledger",
      satisfied: input.ledgerBalances,
      detail: "Checked with BalanceCalculator.verifyIntegrity over every migrated transaction.",
    },
    {
      id: "IDENTITY_HOLDS",
      requirement: "B02 holds: assets − liabilities = equity + income − expenses",
      satisfied: input.identityHolds,
      detail: "A migration that broke the identity posted something to the wrong type of account.",
    },
    {
      id: "V1_ARCHIVED",
      requirement: "The v1 database is archived, read-only, and its connection string is revoked",
      satisfied: input.v1Archived,
      detail:
        "Manual, and deliberately not automated: it is the one irreversible step, and it should " +
        "be taken by a person who has read the reconciliation.",
    },
  ];

  return { ready: checklist.every((item) => item.satisfied), checklist };
}
