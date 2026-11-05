/**
 * Task 2.1 acceptance: restore() round-trips a tombstone; restored rows re-enter every
 * balance; reconciled rows refuse (L10); D2's 30-day window; a refusal changes nothing.
 */
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { ledgerAccounts, postings, transactions, users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { UserId, FixedClock } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { AccountCode } from "@/domain/accounts";
import { TombstoneRefusedError, RestoreRefusedError, restoreRefusal, UNDO_WINDOW, type TransactionId } from "@/domain/transactions";
import { DrizzleAccountRepository, DrizzleBalanceQuery, DrizzleTransactionRepository } from "@/infra/repositories";
import { OpenAccount, RecordTransaction, SeedChartOfAccounts } from "@/app/ledger.usecases";
import { check, done, section } from "./harness";

const DB_FILE = "./tmp/restore.db";
const DAY = 86_400_000;

async function reasonOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "";
  } catch (error) {
    return error instanceof RestoreRefusedError ? error.reason : `unexpected: ${(error as Error).message}`;
  }
}

async function main() {
  section("the policy, without a database");
  const deletedAt = new Date("2026-08-10T00:00:00Z");
  const facts = { deletedAt, reconciled: false, removedAccount: null, duplicate: false };
  check("the undo window is D2's 30 days", UNDO_WINDOW, 30);
  check("within the window: allowed", restoreRefusal(facts, new Date(deletedAt.getTime() + 30 * DAY)), null);
  check("one ms past 30 days: expired", restoreRefusal(facts, new Date(deletedAt.getTime() + 30 * DAY + 1))?.reason, "EXPIRED");
  check("unknown id", restoreRefusal(null, deletedAt)?.reason, "NOT_FOUND");
  check("a live row is not restorable", restoreRefusal({ ...facts, deletedAt: null }, deletedAt)?.reason, "NOT_DELETED");
  check("reconciled wins over the rest (L10)", restoreRefusal({ ...facts, reconciled: true, duplicate: true }, deletedAt)?.reason, "RECONCILED");
  check("a removed account is named", restoreRefusal({ ...facts, removedAccount: "HDFC Savings" }, deletedAt)?.message.includes("HDFC Savings"), true);
  check("refusal codes are stable", restoreRefusal({ ...facts, duplicate: true }, deletedAt)?.code, "LEDGER_RESTORE_DUPLICATE");

  for (const suffix of ["", "-shm", "-wal"]) {
    try { rmSync(DB_FILE + suffix); } catch { /* not there */ }
  }
  const client = createClient({ url: "file:" + DB_FILE });
  const db = drizzle(client, { schema }) as unknown as Database;
  const dir = "./src/infra/db/migrations";
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${dir}/${file}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.execute(statement.trim());
    }
  }

  const now = new Date("2026-08-20T10:00:00Z");
  const userId = UserId.from("user_restore_1");
  const other = UserId.from("user_restore_2");
  for (const id of [userId, other]) {
    await db.insert(users).values({ id: id.value, name: "T", email: `${id.value}@example.com`, emailVerified: true, createdAt: now, updatedAt: now });
  }
  const accounts = new DrizzleAccountRepository(db);
  const journal = new DrizzleTransactionRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  await new SeedChartOfAccounts(accounts).execute({ userId });
  const opened = await new OpenAccount(accounts, journal, new FixedClock(now)).execute({
    userId, name: "Savings", type: "ASSET", subtype: "BANK",
    openingBalance: Money.fromRupees("100000"), openingBalanceOn: CalendarDate.parse("2026-08-01"),
  });
  if (!opened.ok) throw new Error("setup failed");
  const bank = opened.value.accountId;
  const groceries = (await accounts.findByCode(userId, AccountCode.parse("Expenses:Food:Groceries")))!;
  const record = new RecordTransaction(accounts, journal);
  const spend = async (amount: string, fingerprint?: string): Promise<TransactionId> => {
    const r = await record.execute({
      userId, fromAccountId: bank, toAccountId: groceries.id, amount: Money.fromRupees(amount),
      postedOn: CalendarDate.parse("2026-08-12"), narration: "Groceries",
      ...(fingerprint ? { source: "IMPORT" as const, fingerprint } : {}),
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value.transactionId;
  };
  const asOf = CalendarDate.parse("2026-08-31");
  const bankBalance = async () => (await balances.balanceOf(userId, bank, asOf)).toDecimalString();

  section("round trip: removed, restored, back in every balance");
  const before = await bankBalance();
  const id = await spend("2500");
  const withdrawals = await journal.find(userId, { kinds: ["WITHDRAWAL"] });
  check("kind filter excludes opening balance from count", withdrawals.totalCount, 1);
  check("kind filter excludes opening balance from rows", withdrawals.transactions.every((txn) => txn.kind === "WITHDRAWAL"), true);
  const openings = await journal.find(userId, { kinds: ["OPENING_BALANCE"] });
  check("kind filter can select opening balance alone", openings.totalCount, 1);
  const withSpend = await bankBalance();
  await journal.softDelete(userId, id, now);
  check("removal takes it out of the balance", await bankBalance(), before);
  check("and out of findById", await journal.findById(userId, id), null);
  await journal.restore(userId, id, new Date(now.getTime() + DAY));
  check("restore puts the balance back", await bankBalance(), withSpend);
  check("findById returns it again", (await journal.findById(userId, id))?.id.value, id.value);
  check("the category total sees it again", (await balances.balanceOf(userId, groceries.id, asOf)).toDecimalString(), "2500.00");

  section("legs tombstoned with the account sweep come back too");
  const swept = await spend("700");
  const afterSwept = await bankBalance();
  await journal.softDeleteByAccount(userId, groceries.id, now);
  const liveLegs = async () => (await db.select().from(postings).where(eq(postings.transactionId, swept.value))).filter((p) => p.deletedAt === null).length;
  check("the sweep tombstoned both legs", await liveLegs(), 0);
  await journal.restore(userId, swept, now);
  check("restore revives both legs", await liveLegs(), 2);
  check("one restored: only its own amount comes back", await bankBalance(), "99300.00");
  // The sweep also removed the earlier spend; restoring it too gives the pre-sweep balance.
  await journal.restore(userId, id, now);
  check("both restored: the balance before the sweep", await bankBalance(), afterSwept);

  section("refusals, each leaving the database unchanged");
  const snapshot = async () => JSON.stringify([await bankBalance(), (await db.select().from(transactions)).map((t) => [t.id, t.deletedAt?.getTime() ?? null])]);

  check("a live transaction", await reasonOf(() => journal.restore(userId, id, now)), "NOT_DELETED");
  check("someone else's id reads as not found", await reasonOf(() => journal.restore(other, id, now)), "NOT_FOUND");

  const old = await spend("100");
  await journal.softDelete(userId, old, now);
  const s1 = await snapshot();
  check("past the 30-day window", await reasonOf(() => journal.restore(userId, old, new Date(now.getTime() + 31 * DAY))), "EXPIRED");
  check("unchanged after EXPIRED", await snapshot(), s1);

  const locked = await spend("200");
  await db.update(postings).set({ status: "RECONCILED" }).where(eq(postings.transactionId, locked.value));
  const lockedBefore = JSON.stringify(await client.execute("SELECT * FROM audit_events"));
  const liveBefore = await snapshot();
  let deleteReason = "";
  try { await journal.softDelete(userId, locked, now); }
  catch (error) { if (!(error instanceof TombstoneRefusedError)) throw error; deleteReason = error.reason; }
  check("single delete refuses reconciled postings", deleteReason, "RECONCILED");
  check("single delete refusal preserves balance and tombstones", await snapshot(), liveBefore);
  check("single delete refusal writes no audit", JSON.stringify(await client.execute("SELECT * FROM audit_events")), lockedBefore);
  // Historical invalid state: exercise restore's defensive check without deleting through the API.
  await db.update(transactions).set({ deletedAt: now }).where(eq(transactions.id, locked.value));
  const s2 = await snapshot();
  check("a reconciled posting (L10)", await reasonOf(() => journal.restore(userId, locked, now)), "RECONCILED");
  check("unchanged after RECONCILED", await snapshot(), s2);

  const first = await spend("500", "fp-restore-1");
  await journal.softDelete(userId, first, now);
  await spend("500", "fp-restore-1"); // re-imported while the first was removed
  const s3 = await snapshot();
  check("a live duplicate fingerprint", await reasonOf(() => journal.restore(userId, first, now)), "DUPLICATE");
  check("unchanged after DUPLICATE, no raw constraint error", await snapshot(), s3);

  const orphan = await spend("300");
  await journal.softDelete(userId, orphan, now);
  await db.update(ledgerAccounts).set({ deletedAt: now }).where(eq(ledgerAccounts.id, groceries.id.value));
  const s4 = await snapshot();
  check("a posting on a removed account", await reasonOf(() => journal.restore(userId, orphan, now)), "ACCOUNT_REMOVED");
  check("unchanged after ACCOUNT_REMOVED", await snapshot(), s4);

  client.close();
  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
