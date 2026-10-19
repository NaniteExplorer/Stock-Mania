/**
 * Deleting an account, and what has to go with it.
 *
 * Two things were left behind before this spec existed, and neither was visible
 * from the screen that did the deleting: the postings of the transactions it
 * tombstoned, and the import batches those transactions came from. The second is
 * the one with teeth — an orphaned batch keeps its file hash, and the obvious way
 * to rebuild an account you deleted by mistake is to import the same statement
 * again, which that hash refuses as a duplicate.
 */

import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { importBatches, importRows, postings, transactions, users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { FixedClock, UserId, newUuid } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import {
  DrizzleAccountRepository,
  DrizzleImportRepository,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { OpenAccount, RecordTransaction, SeedChartOfAccounts } from "@/app/ledger.usecases";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/account-deletion.db";
const rupees = (value: string) => Money.fromRupees(value);
const on = (value: string) => CalendarDate.parse(value);

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

  const userId = UserId.from("user_deletion_1");
  const now = new Date("2026-09-01T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "deletion@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const accountRepo = new DrizzleAccountRepository(db);
  const txnRepo = new DrizzleTransactionRepository(db);
  const importRepo = new DrizzleImportRepository(db);
  const openAccount = new OpenAccount(accountRepo, txnRepo, new FixedClock(now));
  const record = new RecordTransaction(accountRepo, txnRepo);

  await new SeedChartOfAccounts(accountRepo).execute({ userId });

  const opened = await openAccount.execute({
    userId,
    name: "SBI Savings",
    type: "ASSET",
    subtype: "BANK",
    openingBalance: rupees("10000"),
    openingBalanceOn: on("2026-04-01"),
  });
  if (!opened.ok) throw new Error("account setup failed");
  const accountId = opened.value.accountId;

  const groceries = (await accountRepo.list(userId, { includeClosed: true })).find(
    (candidate) => candidate.code.toString() === "Expenses:Food:Groceries",
  )!;
  const spent = await record.execute({
    userId,
    fromAccountId: accountId,
    toAccountId: groceries.id,
    amount: rupees("250.00"),
    postedOn: on("2026-05-02"),
    narration: "A spend to be deleted with the account",
  });
  if (!spent.ok) throw new Error(`spend failed: ${spent.error.message}`);

  // A batch staged against this account, as an import leaves one.
  const batchId = newUuid();
  await db.insert(importBatches).values({
    id: batchId,
    userId: userId.value,
    kind: "BANK_STATEMENT",
    accountId: accountId.value,
    fileName: "sbi.pdf",
    fileHash: "hash-of-the-statement",
    rowsRead: 2,
    rowsImported: 1,
    status: "COMPLETED",
  });
  await db.insert(importRows).values({
    id: newUuid(),
    batchId,
    userId: userId.value,
    rowIndex: 1,
    rawJson: "{}",
    status: "PARSED",
  });

  section("before the account is deleted");

  const liveBatches = async () =>
    (
      await db
        .select({ id: importBatches.id })
        .from(importBatches)
        .where(and(eq(importBatches.userId, userId.value), isNull(importBatches.deletedAt)))
    ).length;
  const liveRows = async () =>
    (
      await db
        .select({ id: importRows.id })
        .from(importRows)
        .where(and(eq(importRows.userId, userId.value), isNull(importRows.deletedAt)))
    ).length;
  const livePostingsOfDeletedEntries = async () =>
    (
      await db
        .select({ id: postings.id })
        .from(postings)
        .innerJoin(transactions, eq(postings.transactionId, transactions.id))
        .where(and(eq(transactions.userId, userId.value), isNull(postings.deletedAt)))
    ).length;

  check("the batch is live", await liveBatches(), 1);
  check("and its staged row with it", await liveRows(), 1);
  const postingsBefore = await livePostingsOfDeletedEntries();
  checkTrue("the account has postings", postingsBefore > 0);

  section("deleting the account takes its history with it");

  const at = new Date("2026-09-20T10:00:00Z");
  const reversed = await txnRepo.softDeleteByAccount(userId, accountId, at);
  const batches = await importRepo.softDeleteBatchesForAccount(userId, accountId, at);
  await accountRepo.softDelete(userId, accountId, at);

  checkTrue("its transactions are tombstoned", reversed > 0);
  check("its import batch goes too", batches, 1);
  check("no batch is left behind", await liveBatches(), 0);
  check("and no staged row", await liveRows(), 0);

  /*
   * The quiet one. Tombstoning the transaction alone leaves its legs live, and a
   * read that filters `postings.deleted_at` without joining `transactions` then
   * counts money belonging to an account that no longer exists.
   */
  const orphanLegs = await db
    .select({ id: postings.id })
    .from(postings)
    .innerJoin(transactions, eq(postings.transactionId, transactions.id))
    .where(
      and(
        eq(transactions.userId, userId.value),
        isNull(postings.deletedAt),
        isNotNull(transactions.deletedAt),
      ),
    );
  check("no posting outlives the transaction that owns it", orphanLegs.length, 0);

  done();
}

await main();
