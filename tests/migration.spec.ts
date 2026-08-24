/**
 * The v1 migration, over a synthetic v1 export — the Phase 7 gate.
 *
 * Three claims, each of which is the plan's own done-when:
 *
 *   1. **A dry run prints a complete report and writes nothing.** Complete means
 *      every row of every collection appears with an outcome — including the ones
 *      that will be rejected — because a dry run that quietly omits rows is worse
 *      than no dry run: it reads as "all clear" and then the real run loses data.
 *   2. **A real run is idempotent.** Running it twice migrates once. The mechanism
 *      is a fingerprint derived from v1's own document id, so the second run
 *      recognises its own output rather than relying on the export not changing.
 *   3. **Every remaining difference from v1 is explained**, with float drift the
 *      expected explanation and anything larger loudly unexplained.
 *
 * The export is synthetic because the real one is the user's private data, and a
 * gate that can only be run against data nobody else has is not a gate. It is built
 * to contain every case the migration has an opinion about: a bank, a card, an
 * unknown account type, a transfer between two migrated accounts, a transaction
 * pointing at an account that was rejected, a zero amount, a float with four
 * decimal places, and a trade.
 */

import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import {
  DrizzleAccountRepository,
  DrizzleBalanceQuery,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { OpenAccount, RecordTransaction, SeedChartOfAccounts } from "@/app/ledger.usecases";
import {
  MigrateV1,
  ReconcileV1,
  cutoverReadiness,
  fromV1Float,
  type V1Export,
} from "@/app/migration.usecases";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/migration.db";

/* ── The export ──────────────────────────────────────────────────────── */

const V1: V1Export = {
  accounts: [
    { _id: "a1", name: "HDFC Savings", type: "SAVINGS", balance: 125000.5, createdAt: "2025-04-01T00:00:00Z" },
    { _id: "a2", name: "Cash in hand", type: "CASH", balance: 4000, createdAt: "2025-04-01T00:00:00Z" },
    { _id: "a3", name: "Axis Credit Card", type: "CREDIT_CARD", balance: -18000, createdAt: "2025-04-01T00:00:00Z" },
    // v1 let people type a type. This one is not a type, and nothing is guessed.
    { _id: "a4", name: "Mystery pot", type: "SOMETHING", balance: 999, createdAt: "2025-04-01T00:00:00Z" },
  ],
  transactions: [
    { _id: "t1", accountId: "a1", date: "2025-04-05T00:00:00Z", description: "Salary", amount: 90000, direction: "CREDIT" },
    { _id: "t2", accountId: "a1", date: "2025-04-07T00:00:00Z", description: "Rent", amount: 32000, direction: "DEBIT" },
    // A float that was never a rupee amount — four decimal places.
    { _id: "t3", accountId: "a3", date: "2025-04-09T00:00:00Z", description: "Groceries", amount: 2499.9999, direction: "DEBIT" },
    // A transfer between two migrated accounts: one transaction, not two.
    { _id: "t4", accountId: "a1", date: "2025-04-10T00:00:00Z", description: "ATM", amount: 5000, direction: "DEBIT", transferAccountId: "a2" },
    // Its account was rejected, so there is nowhere to post it.
    { _id: "t5", accountId: "a4", date: "2025-04-11T00:00:00Z", description: "Who knows", amount: 100, direction: "DEBIT" },
    // Records nothing (L03).
    { _id: "t6", accountId: "a1", date: "2025-04-12T00:00:00Z", description: "Zero", amount: 0, direction: "DEBIT" },
  ],
  trades: [
    { _id: "r1", symbol: "INFY", side: "BUY", date: "2025-05-02T00:00:00Z", quantity: 10, price: 1500 },
  ],
  snapshots: [{ month: "2025-04", assets: 186500.5, liabilities: 20499.9999, netWorth: 166000.5001 }],
};

async function main() {
  for (const suffix of ["", "-shm", "-wal"]) {
    try {
      rmSync(DB_FILE + suffix);
    } catch {
      /* not there */
    }
  }

  const client = createClient({ url: "file:" + DB_FILE });
  const db = drizzle(client, { schema }) as unknown as Database;
  const dir = "./src/infra/db/migrations";
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${dir}/${file}`, "utf8").split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.execute(trimmed);
    }
  }

  const userId = UserId.from("user_migration_1");
  const now = new Date("2026-08-24T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "migration@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const clock = new FixedClock(now);
  const accounts = new DrizzleAccountRepository(db);
  const journal = new DrizzleTransactionRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  const migrate = () =>
    new MigrateV1(
      accounts,
      new OpenAccount(accounts, journal, clock),
      new RecordTransaction(accounts, journal),
      clock,
    );

  /* ── 1. The float reader ──────────────────────────────────────────── */

  section("what a v1 float is worth");

  check("a clean two-decimal float converts exactly", fromV1Float(125000.5).amount.toDecimalString(), "125000.50");
  checkTrue("and is not flagged", !fromV1Float(125000.5).suspicious);
  checkTrue("four decimal places are flagged", fromV1Float(2499.9999).suspicious);
  check(
    "the flagged value still converts to its nearest paisa",
    fromV1Float(2499.9999).amount.toDecimalString(),
    "2500.00",
  );

  /* ── 2. The dry run ───────────────────────────────────────────────── */

  section("a dry run reports everything and writes nothing");

  const dry = await migrate().execute({ userId, export: V1, dryRun: true });
  checkTrue("the dry run succeeded", dry.ok);
  if (!dry.ok) return done();

  check(
    "every row of every collection is accounted for",
    dry.value.rows.length,
    V1.accounts.length + V1.transactions.length + V1.trades.length + V1.snapshots.length,
  );
  checkTrue(
    "every row that is not a plain migrate carries a written reason",
    dry.value.rows.every((row) => row.outcome === "MIGRATED" || (row.reason ?? "").length > 20),
  );
  check(
    "the unknown account type is rejected, not guessed",
    dry.value.rows.find((row) => row.sourceId === "a4")?.outcome,
    "REJECTED",
  );
  check("the trade is reported, not migrated", dry.value.rows.find((row) => row.sourceId === "r1")?.outcome, "REJECTED");
  check(
    "the snapshot is skipped as a cache",
    dry.value.rows.find((row) => row.sourceId === "2025-04")?.outcome,
    "SKIPPED_ALREADY_PRESENT",
  );
  checkTrue(
    "the float amount is warned about by name",
    dry.value.warnings.some((warning) => warning.includes("2499.9999")),
  );

  const afterDryRun = await accounts.list(userId, { includeClosed: true });
  check("nothing was written — no accounts exist", afterDryRun.length, 0);
  check("and no transactions", (await journal.find(userId, { limit: 100 })).transactions.length, 0);

  /* ── 3. The real run ──────────────────────────────────────────────── */

  section("the real run");

  await new SeedChartOfAccounts(accounts).execute({ userId });
  const first = await migrate().execute({ userId, export: V1, dryRun: false });
  checkTrue("it succeeded", first.ok);
  if (!first.ok) return done();

  check("three of four accounts migrated", first.value.accountIdByV1Id.size, 3);
  check(
    "the transaction whose account was rejected is rejected too",
    first.value.rows.find((row) => row.sourceId === "t5")?.outcome,
    "REJECTED",
  );
  check(
    "the zero-amount transaction is rejected under L03",
    first.value.rows.find((row) => row.sourceId === "t6")?.outcome,
    "REJECTED",
  );
  check(
    "four transactions migrated",
    first.value.rows.filter((row) => row.collection === "transactions" && row.outcome === "MIGRATED").length,
    4,
  );

  const opened = await accounts.list(userId, { includeClosed: true });
  const savings = opened.find((account) => account.name === "HDFC Savings");
  checkTrue("the savings account exists", savings !== undefined);
  const card = opened.find((account) => account.name === "Axis Credit Card");
  checkTrue("the card came across as a liability", card?.type.name === "LIABILITY");

  /*
   * Opening ₹1,25,000.50, salary +₹90,000, rent −₹32,000, ATM −₹5,000.
   * The card's ₹2,500 spend does not touch the bank.
   */
  const savingsBalance = await balances.balanceOf(userId, savings!.id, CalendarDate.parse("2025-04-30"));
  check("the bank balance is the ledger's own sum", savingsBalance.toDecimalString(), "178000.50");

  /* ── 4. Idempotency ──────────────────────────────────────────────── */

  section("running it twice migrates once");

  const second = await migrate().execute({ userId, export: V1, dryRun: false });
  checkTrue("the second run succeeded", second.ok);
  if (!second.ok) return done();

  check("nothing new was migrated", second.value.migrated, 0);
  check(
    "every account is recognised as already present",
    second.value.rows.filter((row) => row.collection === "accounts" && row.outcome === "SKIPPED_ALREADY_PRESENT")
      .length,
    3,
  );
  check(
    "and so is every transaction that migrated the first time",
    second.value.rows.filter((row) => row.collection === "transactions" && row.outcome === "SKIPPED_ALREADY_PRESENT")
      .length,
    4,
  );

  const totalAfterTwoRuns = (await journal.find(userId, { limit: 1000 })).transactions.length;
  const balanceAfterTwoRuns = await balances.balanceOf(userId, savings!.id, CalendarDate.parse("2025-04-30"));
  check("the balance is unchanged by the second run", balanceAfterTwoRuns.toDecimalString(), "178000.50");

  const third = await migrate().execute({ userId, export: V1, dryRun: false });
  checkTrue("a third run also adds nothing", third.ok && third.value.migrated === 0);
  check(
    "the journal is the same size",
    (await journal.find(userId, { limit: 1000 })).transactions.length,
    totalAfterTwoRuns,
  );

  /* ── 5. Reconciliation ───────────────────────────────────────────── */

  section("every difference from v1 is explained");

  /*
   * v1's snapshot claims ₹1,66,000.5001, built from floats and from a "Mystery pot"
   * that did not migrate. The point of the test is not that the two numbers agree;
   * it is that a difference of this size is *named* rather than rounded away.
   */
  const reconciliation = await new ReconcileV1(balances).execute({ userId, snapshots: V1.snapshots });
  checkTrue("reconciliation ran", reconciliation.ok);
  if (!reconciliation.ok) return done();

  const april = reconciliation.value.months[0]!;
  check("one month is compared", reconciliation.value.months.length, 1);
  checkTrue("a rejected account leaves a difference beyond rounding", april.cause === "UNEXPLAINED");
  checkTrue("and the explanation says not to cut over", april.explanation.includes("Do not cut over"));
  checkTrue("the run is therefore not all-explained", !reconciliation.value.allExplained);

  // The same comparison against a snapshot that only differs by v1's float
  // arithmetic: the tolerance names it, and names v2's figure as the correct one.
  const totals = await balances.totals(userId, CalendarDate.parse("2025-04-30"));
  const v2NetWorth = Number(totals.netWorth.toDecimalString());
  const drifted = { month: "2025-04", assets: 0, liabilities: 0, netWorth: v2NetWorth + 0.37 };
  const explained = await new ReconcileV1(balances).execute({ userId, snapshots: [drifted] });
  checkTrue("a sub-tolerance difference reconciles", explained.ok && explained.value.allExplained);
  check("and is attributed to float drift", explained.ok ? explained.value.months[0]!.cause : "?", "FLOAT_DRIFT");
  checkTrue(
    "with v2 named as the correct figure",
    explained.ok && explained.value.months[0]!.explanation.includes("v2's figure is the correct one"),
  );

  const exact = await new ReconcileV1(balances).execute({
    userId,
    snapshots: [{ month: "2025-04", assets: 0, liabilities: 0, netWorth: v2NetWorth }],
  });
  check("an exact match is NONE, not a tolerated drift", exact.ok ? exact.value.months[0]!.cause : "?", "NONE");

  const tight = await new ReconcileV1(balances).execute({
    userId,
    snapshots: [drifted],
    floatTolerance: Money.fromRupees("0.10"),
  });
  checkTrue(
    "and the tolerance is a parameter, not a hidden constant",
    tight.ok && tight.value.months[0]!.cause === "UNEXPLAINED",
  );

  /* ── 6. The cutover checklist ────────────────────────────────────── */

  section("readiness is a checklist, not a judgement");

  const notReady = cutoverReadiness({
    migration: first.value,
    reconciliation: reconciliation.value,
    ledgerBalances: true,
    identityHolds: true,
    v1Archived: true,
  });
  checkTrue("an unexplained month blocks the cutover", !notReady.ready);
  checkTrue(
    "and the blocking item says which month",
    notReady.checklist.some((item) => item.id === "RECONCILED" && !item.satisfied && item.detail.includes("2025-04")),
  );

  const allExplained = { months: [], allExplained: true, unexplained: [] } as const;

  const unarchived = cutoverReadiness({
    migration: first.value,
    reconciliation: allExplained,
    ledgerBalances: true,
    identityHolds: true,
    v1Archived: false,
  });
  checkTrue("the one manual item cannot be inferred away", !unarchived.ready);

  const ready = cutoverReadiness({
    migration: first.value,
    reconciliation: allExplained,
    ledgerBalances: true,
    identityHolds: true,
    v1Archived: true,
  });
  checkTrue("with every box ticked, it is ready", ready.ready);
  checkTrue(
    "every rejected row still carried a reason",
    ready.checklist.find((item) => item.id === "NO_SILENT_REJECTS")?.satisfied === true,
  );

  const broken = cutoverReadiness({
    migration: first.value,
    reconciliation: allExplained,
    ledgerBalances: true,
    identityHolds: false,
    v1Archived: true,
  });
  checkTrue("a broken accounting identity blocks it too", !broken.ready);

  done();
}

main();
