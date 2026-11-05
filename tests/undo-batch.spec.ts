/**
 * Tasks 2.2–2.4 acceptance: `audit_events.request_id` is the undo unit — one edit,
 * fifteen removals and a whole import each undo as one unit; undoing an edit
 * tombstones the reversal and the replacement so the original returns to every
 * balance, with the evidence behind a filter; reverse-a-reversal stays blocked; any
 * refusal changes nothing; redo per D3 (one-step class A cursor, class B stack of 20).
 */
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { auditEvents, postings, transactions, users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { UserId, FixedClock } from "@/core/kernel";
import { Count } from "@/core/units";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { AccountCode } from "@/domain/accounts";
import { TransactionId, TombstoneRefusedError, UndoRefusedError, undoPlan, type BatchEntry } from "@/domain/transactions";
import { DrizzleAccountRepository, DrizzleBalanceQuery, DrizzleTransactionRepository } from "@/infra/repositories";
import {
  BoundedRedoStack, EditTransaction, InMemoryRedoCursorStore, OpenAccount, RecordTransaction, RedoBatch,
  RemoveTransactions, ReverseTransaction, SeedChartOfAccounts, UndoBatch,
} from "@/app/ledger.usecases";
import { check, done, section } from "./harness";

const DB_FILE = "./tmp/undo-batch.db";
const DAY = 86_400_000;

async function main() {
  section("the plan, without a database");
  const at = new Date("2026-08-20T10:00:00Z");
  const uuid = (c: string) => `00000000-0000-4000-8000-${c.charCodeAt(0).toString(16).padStart(12, "0")}`;
  const e = (id: string, action: BatchEntry["action"], when = at): BatchEntry => ({ transactionId: TransactionId.from(uuid(id)), action, at: when });
  const plan = undoPlan([e("a", "SOFT_DELETE"), e("b", "REVERSE"), e("c", "CREATE")], at);
  check("removals restore, creations tombstone", Array.isArray(plan) ? plan.map((s) => `${String.fromCharCode(parseInt(s.transactionId.value.slice(-12), 16))}:${s.op}`).join(",") : "refused", "a:RESTORE,b:TOMBSTONE,c:TOMBSTONE");
  const cancel = undoPlan([e("x", "CREATE"), e("x", "SOFT_DELETE")], at);
  check("created and removed in one batch: no step", Array.isArray(cancel) ? cancel.length : -1, 0);
  check("an empty batch is NO_BATCH", (undoPlan([], at) as UndoRefusedError).reason, "NO_BATCH");
  check("past D2's 30 days: EXPIRED", (undoPlan([e("a", "SOFT_DELETE")], new Date(at.getTime() + 30 * DAY + 1)) as UndoRefusedError).reason, "EXPIRED");
  check("on day 30: allowed", Array.isArray(undoPlan([e("a", "SOFT_DELETE")], new Date(at.getTime() + 30 * DAY))), true);

  section("class B redo: a bounded stack of 20 (D3)");
  const stack = new BoundedRedoStack<number>();
  for (let i = 1; i <= 25; i++) stack.push(i);
  check("depth is 20", stack.depth, 20);
  check("pushing past 20 keeps 20", stack.size, 20);
  check("the newest pops first", stack.pop(), 25);
  check("the oldest five were dropped", (() => { let last = 0; while (stack.size) last = stack.pop()!; return last; })(), 6);
  stack.push(1);
  stack.clear();
  check("a new mutation clears it", stack.pop(), null);

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

  const userId = UserId.from("user_undo_1");
  const other = UserId.from("user_undo_2");
  for (const id of [userId, other]) {
    await db.insert(users).values({ id: id.value, name: "T", email: `${id.value}@example.com`, emailVerified: true, createdAt: at, updatedAt: at });
  }
  const clock = new FixedClock(at);
  const accounts = new DrizzleAccountRepository(db);
  const journal = new DrizzleTransactionRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  await new SeedChartOfAccounts(accounts).execute({ userId });
  const opened = await new OpenAccount(accounts, journal, clock).execute({
    userId, name: "Savings", type: "ASSET", subtype: "BANK",
    openingBalance: Money.fromRupees("100000"), openingBalanceOn: CalendarDate.parse("2026-08-01"),
  });
  if (!opened.ok) throw new Error("setup failed");
  const bank = opened.value.accountId;
  const groceries = (await accounts.findByCode(userId, AccountCode.parse("Expenses:Food:Groceries")))!;
  const record = new RecordTransaction(accounts, journal);
  const spend = async (amount: string, importBatchId?: string): Promise<TransactionId> => {
    const r = await record.execute({
      userId, fromAccountId: bank, toAccountId: groceries.id, amount: Money.fromRupees(amount),
      postedOn: CalendarDate.parse("2026-08-12"), narration: "Groceries",
      ...(importBatchId ? { source: "IMPORT" as const, importBatchId } : {}),
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value.transactionId;
  };
  const asOf = CalendarDate.parse("2026-08-31");
  const bankBalance = async () => (await balances.balanceOf(userId, bank, asOf)).toDecimalString();
  const groceryBalance = async () => (await balances.balanceOf(userId, groceries.id, asOf)).toDecimalString();
  const snapshot = async () => JSON.stringify([
    await bankBalance(),
    (await db.select().from(transactions)).map((t) => [t.id, t.deletedAt?.getTime() ?? null]),
    (await db.select().from(postings)).map((p) => [p.id, p.deletedAt?.getTime() ?? null]),
    (await db.select().from(auditEvents)).length,
  ]);
  const cursors = new InMemoryRedoCursorStore();
  const remove = new RemoveTransactions(journal, clock);
  const undo = new UndoBatch(journal, cursors, clock);
  const redo = new RedoBatch(journal, cursors, clock);
  const session = { userId, sessionId: "s1" };

  section("fifteen removals are one unit");
  const fifteen: TransactionId[] = [];
  for (let i = 1; i <= 15; i++) fifteen.push(await spend(String(i * 10)));
  const withFifteen = await bankBalance();
  const removed = await remove.execute({ userId, transactionIds: fifteen });
  if (!removed.ok) throw new Error(removed.error.message);
  check("fifteen removed", removed.value.removed, 15);
  check("one request id carries fifteen audit events", (await journal.batch(userId, removed.value.requestId)).length, 15);
  check("every leg tombstoned too", (await db.select().from(postings).where(inArray(postings.transactionId, fifteen.map((t) => t.value)))).every((p) => p.deletedAt !== null), true);
  check("the balance lost all fifteen", await bankBalance(), "100000.00");
  const undone = await undo.execute({ ...session, requestId: removed.value.requestId });
  check("one undo restores all fifteen", undone.ok ? undone.value.restored : undone.error.message, 15);
  check("the balance is back", await bankBalance(), withFifteen);
  check("someone else's request id is NO_BATCH", (await journal.invertBatch(other, removed.value.requestId, at).catch((err: UndoRefusedError) => err)) instanceof UndoRefusedError, true);
  const again = await undo.execute({ ...session, requestId: removed.value.requestId });
  check("undoing the same batch twice is SUPERSEDED", !again.ok && (again.error as UndoRefusedError).reason, "SUPERSEDED");

  section("redo: a one-step class A cursor (D3)");
  check("redo is available after an undo", (await redo.state(session)).available, true);
  check("another session has nothing to redo", (await redo.state({ userId, sessionId: "s2" })).available, false);
  const redone = await redo.execute(session);
  check("redo removes the fifteen again", redone.ok ? redone.value.tombstoned : redone.error.message, 15);
  check("the balance follows", await bankBalance(), "100000.00");
  const after = await redo.state(session);
  check("one step only: nothing more to redo", after.available === false && after.reason, "NOTHING_TO_REDO");
  // Undo the redo, then touch one of its rows: the cursor dies, with a reason.
  const redoBatchId = redone.ok ? redone.value.requestId : "";
  const back = await undo.execute({ ...session, requestId: redoBatchId });
  check("the redo itself undoes as one unit", back.ok ? back.value.restored : back.error.message, 15);
  await journal.softDelete(userId, fifteen[3]!, at);
  const stale = await redo.state(session);
  check("a newer mutation on the batch invalidates redo", stale.available === false && stale.reason, "INVALIDATED");
  check("and the disabled redo says why", stale.available === false && stale.message.includes("newer change"), true);
  const refusedRedo = await redo.execute(session);
  check("redo then refuses", !refusedRedo.ok && refusedRedo.error.code, "LEDGER_REDO_NOTHING_TO_REDO");

  section("an edit undoes as one unit: reversal and replacement tombstoned");
  const baseBank = await bankBalance();
  const baseGroceries = await groceryBalance();
  const original = await spend("1000");
  const withOriginal = await bankBalance();
  const groceriesWithOriginal = await groceryBalance();
  const edit = new EditTransaction(accounts, journal, clock);
  const edited = await edit.execute({
    userId, transactionId: original, fromAccountId: bank, toAccountId: groceries.id,
    amount: Money.fromRupees("1500"), postedOn: CalendarDate.parse("2026-08-12"), narration: "Groceries (corrected)",
  });
  if (!edited.ok) throw new Error(edited.error.message);
  check("the edit nets to the new amount", await bankBalance(), (Number(baseBank) - 1500).toFixed(2));
  check("an edit is one batch of two", (await journal.batch(userId, edited.value.requestId)).map((b) => b.action).join(","), "REVERSE,CREATE");
  const undoneEdit = await undo.execute({ ...session, requestId: edited.value.requestId });
  check("undo tombstones both halves", undoneEdit.ok ? undoneEdit.value.tombstoned : undoneEdit.error.message, 2);
  check("the original returns to the bank balance", await bankBalance(), withOriginal);
  check("and to the category balance", await groceryBalance(), groceriesWithOriginal);
  check("the original is live", (await journal.findById(userId, original))?.id.value, original.value);
  check("and no longer counts as reversed", await journal.hasReversal(userId, original), false);
  const hidden = await journal.find(userId, {});
  check("the evidence is hidden by default", hidden.transactions.some((t) => t.id.equals(edited.value.reversalTransactionId)), false);
  const evidence = await journal.find(userId, { removed: "ONLY" });
  check("and behind the filter: the reversal", evidence.transactions.some((t) => t.id.equals(edited.value.reversalTransactionId)), true);
  check("and the replacement", evidence.transactions.some((t) => t.id.equals(edited.value.replacementTransactionId)), true);
  check("INCLUDE shows both live and removed", (await journal.find(userId, { removed: "INCLUDE", limit: Count(1000) })).totalCount > hidden.totalCount, true);
  const redoneEdit = await redo.execute(session);
  check("redo of the edit restores both halves", redoneEdit.ok ? redoneEdit.value.restored : redoneEdit.error.message, 2);
  check("the edited amount is back", await groceryBalance(), (Number(baseGroceries) + 1500).toFixed(2));

  section("reversing a reversal stays blocked");
  const reverse = new ReverseTransaction(journal, clock);
  const target = await spend("50");
  const reversed = await reverse.execute({ userId, transactionId: target });
  if (!reversed.ok) throw new Error(reversed.error.message);
  const twice = await reverse.execute({ userId, transactionId: reversed.value.reversalTransactionId });
  check("reverse-a-reversal is refused", !twice.ok && twice.error.code, "LEDGER_TXN_ALREADY_REVERSED");
  const editReversal = await edit.execute({
    userId, transactionId: reversed.value.reversalTransactionId, fromAccountId: bank, toAccountId: groceries.id,
    amount: Money.fromRupees("1"), postedOn: CalendarDate.parse("2026-08-12"), narration: "x",
  });
  check("editing a reversal is refused too", !editReversal.ok && editReversal.error.code, "LEDGER_TXN_ALREADY_REVERSED");

  section("a whole import is one unit");
  const importId = "batch-undo-1";
  const imported = [await spend("11", importId), await spend("22", importId), await spend("33", importId)];
  const withImport = await bankBalance();
  const count = await journal.softDeleteByImportBatch(userId, importId, at, { requestId: "req-import-undo" });
  check("three tombstoned", count, 3);
  check("under the request id given", (await journal.batch(userId, "req-import-undo")).length, 3);
  check("legs tombstoned with them", (await db.select().from(postings).where(inArray(postings.transactionId, imported.map((t) => t.value)))).every((p) => p.deletedAt !== null), true);
  const undoneImport = await undo.execute({ ...session, requestId: "req-import-undo" });
  check("one undo brings the import back", undoneImport.ok ? undoneImport.value.restored : undoneImport.error.message, 3);
  check("the balance includes it again", await bankBalance(), withImport);

  section("refusals, each leaving the database unchanged");
  const locked = await spend("77", "batch-locked");
  const free = await spend("88", "batch-locked");
  await db.update(postings).set({ status: "RECONCILED" }).where(eq(postings.transactionId, locked.value));
  let s0 = await snapshot();
  const bulk = await remove.execute({ userId, transactionIds: [free, locked] });
  check("a bulk removal touching a reconciled posting is refused (L10)", !bulk.ok && (bulk.error as TombstoneRefusedError).reason, "RECONCILED");
  check("the refusal names the blocking row", !bulk.ok && (bulk.error as TombstoneRefusedError).transactionIds.join(), locked.value);
  check("nothing was removed", await snapshot(), s0);
  const importRefusal = await journal.softDeleteByImportBatch(userId, "batch-locked", at).catch((err: unknown) => err);
  check("undoing an import with a reconciled leg is refused", importRefusal instanceof TombstoneRefusedError && importRefusal.reason, "RECONCILED");
  check("unchanged after the import refusal", await snapshot(), s0);
  const missing = await remove.execute({ userId, transactionIds: [free, TransactionId.from("00000000-0000-4000-8000-0000000000ff")] });
  check("an unknown id refuses the batch", !missing.ok && (missing.error as TombstoneRefusedError).reason, "NOT_FOUND");
  check("unchanged after NOT_FOUND", await snapshot(), s0);

  const pair = [await spend("5"), await spend("6")];
  const removedPair = await remove.execute({ userId, transactionIds: pair });
  if (!removedPair.ok) throw new Error("pair");
  await db.update(postings).set({ status: "RECONCILED" }).where(eq(postings.transactionId, pair[1]!.value));
  s0 = await snapshot();
  const blocked = await undo.execute({ ...session, requestId: removedPair.value.requestId });
  check("an undo that would restore a reconciled row is BLOCKED", !blocked.ok && (blocked.error as UndoRefusedError).reason, "BLOCKED");
  check("with the restore reason inside", !blocked.ok && (blocked.error as UndoRefusedError).blockedBy?.code, "LEDGER_RESTORE_RECONCILED");
  check("the other row was not half-restored", await snapshot(), s0);

  const late = await spend("9");
  const removedLate = await remove.execute({ userId, transactionIds: [late] });
  if (!removedLate.ok) throw new Error("late");
  s0 = await snapshot();
  const expired = await new UndoBatch(journal, cursors, new FixedClock(new Date(at.getTime() + 31 * DAY))).execute({ ...session, requestId: removedLate.value.requestId });
  check("past the 30-day window: EXPIRED", !expired.ok && (expired.error as UndoRefusedError).reason, "EXPIRED");
  check("unchanged after EXPIRED", await snapshot(), s0);
  const unknown = await undo.execute({ ...session, requestId: "no-such-request" });
  check("an unknown request is NO_BATCH", !unknown.ok && (unknown.error as UndoRefusedError).reason, "NO_BATCH");

  client.close();
  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
