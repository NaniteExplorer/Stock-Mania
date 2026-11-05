/**
 * Task 2.7.b follow-up: the Drizzle `ActivityLog` adapter (`src/infra/activity-log.ts`)
 * against a real libSQL file with the migrations applied.
 *
 *   - `eventsSince` returns only the owner's events, only inside the window, newest first;
 *   - `ListActivity` composed with the real adapter and the real journal exercises
 *     `touchedSince`: an untouched batch can be undone, a newer write on its rows
 *     makes Undo refuse as SUPERSEDED.
 */
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { auditEvents, users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId, newUuid } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { AccountCode } from "@/domain/accounts";
import { UNDO_MESSAGES, UNDO_WINDOW, type TransactionId } from "@/domain/transactions";
import { DrizzleAccountRepository, DrizzleTransactionRepository } from "@/infra/repositories";
import { DrizzleActivityLog } from "@/infra/activity-log";
import { InMemoryRedoCursorStore, OpenAccount, RecordTransaction, RemoveTransactions, SeedChartOfAccounts } from "@/app/ledger.usecases";
import { ListActivity } from "@/app/activity.usecases";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/activity-log-db.db";
const DAY = 86_400_000;

async function main() {
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

  // Audited writes stamp `audit_events.at` with the database's wall clock, so the
  // window is measured from real time, not a fixed date.
  const now = new Date();
  const userId = UserId.from("user_activity_1");
  const other = UserId.from("user_activity_2");
  for (const id of [userId, other]) {
    await db.insert(users).values({ id: id.value, name: "T", email: `${id.value}@example.com`, emailVerified: true, createdAt: now, updatedAt: now });
  }
  const log = new DrizzleActivityLog(db);
  const since = new Date(now.getTime() - UNDO_WINDOW * DAY);

  section("eventsSince: owner-scoped, windowed, newest first");
  const raw = async (owner: UserId, requestId: string, at: Date) => {
    await db.insert(auditEvents).values({
      id: newUuid(), userId: owner.value, actorId: owner.value, action: "UPDATE",
      entityType: "category", entityId: newUuid(), requestId, at,
    });
  };
  await raw(userId, "req-too-old", new Date(now.getTime() - (UNDO_WINDOW + 1) * DAY));
  await raw(userId, "req-day-29", new Date(now.getTime() - 29 * DAY));
  await raw(userId, "req-hour-ago", new Date(now.getTime() - 3_600_000));
  await raw(other, "req-foreign", new Date(now.getTime() - 60_000));

  const mine = await log.eventsSince(userId, since);
  const ids = mine.map((event) => event.requestId);
  check("only the owner's in-window events", ids.join(","), "req-hour-ago,req-day-29");
  check("the event past the window is excluded", ids.includes("req-too-old"), false);
  check("a foreign event never appears", ids.includes("req-foreign"), false);
  checkTrue("times come back as Dates", mine.every((event) => event.at instanceof Date));
  check("actor and entity are carried", `${mine[0]!.actorId}/${mine[0]!.entityType}/${mine[0]!.action}`, `${userId.value}/category/UPDATE`);
  check("a wider window reaches the old event", (await log.eventsSince(userId, new Date(0))).some((e) => e.requestId === "req-too-old"), true);
  check("the other owner sees only their own", (await log.eventsSince(other, since)).map((e) => e.requestId).join(","), "req-foreign");

  section("ListActivity with the real adapter: touchedSince");
  const clock = new FixedClock(now);
  const accounts = new DrizzleAccountRepository(db);
  const journal = new DrizzleTransactionRepository(db);
  await new SeedChartOfAccounts(accounts).execute({ userId });
  const opened = await new OpenAccount(accounts, journal, clock).execute({
    userId, name: "Savings", type: "ASSET", subtype: "BANK",
    openingBalance: Money.fromRupees("100000"), openingBalanceOn: CalendarDate.parse("2026-01-01"),
  });
  if (!opened.ok) throw new Error("setup failed");
  const groceries = (await accounts.findByCode(userId, AccountCode.parse("Expenses:Food:Groceries")))!;
  const record = new RecordTransaction(accounts, journal);
  const spend = async (amount: string): Promise<TransactionId> => {
    const r = await record.execute({
      userId, fromAccountId: opened.value.accountId, toAccountId: groceries.id,
      amount: Money.fromRupees(amount), postedOn: CalendarDate.parse("2026-01-12"), narration: "Groceries",
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value.transactionId;
  };
  const a = await spend("250");
  const b = await spend("400");
  const removed = await new RemoveTransactions(journal, clock).execute({ userId, transactionIds: [a, b] });
  if (!removed.ok) throw new Error(removed.error.message);
  const requestId = removed.value.requestId;

  const list = new ListActivity(log, journal, new InMemoryRedoCursorStore(), new FixedClock(new Date()));
  const session = { userId, sessionId: "s1" };
  const rowFor = async () => (await list.execute(session)).rows.find((row) => row.requestId === requestId);

  check("touchedSince: nothing newer yet", await journal.touchedSince(userId, requestId, [a, b]), false);
  const before = await rowFor();
  checkTrue("the removal is one row on the screen", before !== undefined);
  check("it counts both removals", before?.counts.SOFT_DELETE, 2);
  check("it is class A, attributed to the owner", `${before?.mutationClass}/${before?.actor}`, "A/YOU");
  check("Undo is available", before?.undo.available, true);

  await journal.restore(userId, a, new Date());
  check("touchedSince: a newer write on one of its rows", await journal.touchedSince(userId, requestId, [a, b]), true);
  check("another owner's view of the same request is untouched", await journal.touchedSince(other, requestId, [a, b]), false);
  const after = await rowFor();
  check("Undo now refuses", after?.undo.available, false);
  check("with the superseded reason", after && !after.undo.available ? after.undo.reason : "", UNDO_MESSAGES.SUPERSEDED);
  check("the other owner's screen does not list it", (await list.execute({ userId: other, sessionId: "s1" })).rows.some((row) => row.requestId === requestId), false);

  client.close();
  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
