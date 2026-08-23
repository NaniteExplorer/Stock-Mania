import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { auditEvents, ledgerAccounts, ledgerEvents, projectionCache, users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { UnitOfWork, newRequestContext, hashRevisionVector } from "@/infra/unit-of-work";
import { FixedClock, newUuid } from "@/core/kernel";
import { CalendarDate } from "@/core/time";
import { check, checkDeep, section, done } from "./harness";

/**
 * The write path: audit trail, event log, revisions and cache invalidation.
 *
 * Invariants A02 (one audit event per mutation) and B04 (a projection is served
 * only if its revision vector still matches) are enforced here, and both are the
 * kind of thing that silently stops working. An audit trail with a hole in it
 * looks exactly like one without.
 */

const DB_FILE = "./tmp/audit.db";
const USER = "user_audit_1";

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

  const now = new Date("2026-08-05T10:00:00Z");
  await db.insert(users).values({
    id: USER,
    name: "Audit Test",
    email: "audit@example.test",
    createdAt: now,
    updatedAt: now,
  });

  const clock = new FixedClock(now);
  const context = newRequestContext(USER, clock, { ipAddress: "203.0.113.7" });
  const uow = new UnitOfWork(db, context);

  /** Opens an account directly, so the test exercises UnitOfWork and not a use case. */
  const openAccount = async (code: string, name: string): Promise<string> => {
    const id = newUuid();
    await uow.mutate({
      action: "CREATE",
      entityType: "Account",
      entityId: id,
      before: null,
      event: {
        type: "AccountOpened",
        aggregateType: "Account",
        aggregateId: id,
        payload: { code, name },
        effectiveOn: null,
      },
      touchedAccountIds: [],
      apply: async (tx) => {
        const row = { id, userId: USER, code, name, type: "ASSET" as const, subtype: "BANK" as const };
        await tx.insert(ledgerAccounts).values(row);
        return { result: id, after: row };
      },
    });
    return id;
  };

  const countAudit = async (): Promise<number> => {
    const rows = await db.all<{ n: number }>(sql`select count(*) as n from audit_events`);
    return Number(rows[0].n);
  };

  section("A02 — exactly one audit event per mutation");

  const hdfc = await openAccount("Assets:Bank:HDFC", "HDFC Savings");
  check("one mutation, one audit event", await countAudit(), 1);

  const icici = await openAccount("Assets:Bank:ICICI", "ICICI Savings");
  check("two mutations, two audit events", await countAudit(), 2);

  const events = await db.select().from(auditEvents).where(eq(auditEvents.entityId, hdfc));
  check("the action is recorded", events[0].action, "CREATE");
  check("the entity type is recorded", events[0].entityType, "Account");
  check("the actor is recorded", events[0].actorId, USER);
  check("the ip is recorded", events[0].ipAddress, "203.0.113.7");
  check("an insert has no before-image", events[0].beforeJson, null);
  check("but does have an after-image", events[0].afterJson !== null, true);
  check(
    "the after-image round-trips to the entity",
    JSON.parse(events[0].afterJson ?? "{}").code,
    "Assets:Bank:HDFC",
  );

  section("one request is one story, however many aggregates it touches");

  // A split expense touching four accounts is four mutations but one request, and
  // the request id is what stitches them back together months later.
  const shared = newRequestContext(USER, clock, { requestId: "req-shared-1" });
  const sharedUow = new UnitOfWork(db, shared);
  for (const code of ["Expenses:Food", "Expenses:Fuel", "Expenses:Rent"]) {
    const id = newUuid();
    await sharedUow.mutate({
      action: "CREATE",
      entityType: "Account",
      entityId: id,
      before: null,
      event: {
        type: "AccountOpened",
        aggregateType: "Account",
        aggregateId: id,
        payload: { code },
        effectiveOn: null,
      },
      touchedAccountIds: [],
      apply: async (tx) => {
        const row = { id, userId: USER, code, name: code, type: "EXPENSE" as const };
        await tx.insert(ledgerAccounts).values(row);
        return { result: id, after: row };
      },
    });
  }
  const grouped = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.requestId, "req-shared-1"));
  check("three mutations share one request id", grouped.length, 3);

  section("a failed mutation writes no audit event");

  const before = await countAudit();
  let threw = false;
  try {
    await uow.mutate({
      action: "CREATE",
      entityType: "Account",
      entityId: "will-fail",
      before: null,
      event: {
        type: "AccountOpened",
        aggregateType: "Account",
        aggregateId: "will-fail",
        payload: {},
        effectiveOn: null,
      },
      touchedAccountIds: [],
      apply: async () => {
        throw new Error("the write failed");
      },
    });
  } catch {
    threw = true;
  }
  check("the mutation threw", threw, true);
  check("and left the audit trail untouched", await countAudit(), before);

  section("the event log is ordered for replay");

  const logged = await db.select().from(ledgerEvents).orderBy(ledgerEvents.seq);
  check("one ledger event per mutation", logged.length, 5);
  check("seq starts at 1", logged[0].seq, 1);
  check(
    "seq is strictly increasing",
    logged.every((e, i) => i === 0 || e.seq > logged[i - 1].seq),
    true,
  );
  check("the payload survives", JSON.parse(logged[0].payloadJson).code, "Assets:Bank:HDFC");

  section("revisions bump only on the accounts a write touches");

  const revisionOf = async (id: string): Promise<number> => {
    const rows = await db
      .select({ revision: ledgerAccounts.revision, minAffectedDate: ledgerAccounts.minAffectedDate })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, id));
    return rows[0].revision;
  };
  const minDateOf = async (id: string): Promise<string | null> => {
    const rows = await db
      .select({ minAffectedDate: ledgerAccounts.minAffectedDate })
      .from(ledgerAccounts)
      .where(eq(ledgerAccounts.id, id));
    return rows[0].minAffectedDate;
  };

  check("a fresh account is at revision 0", await revisionOf(hdfc), 0);

  const post = async (accountId: string, on: string) =>
    uow.mutate({
      action: "CREATE",
      entityType: "Transaction",
      entityId: newUuid(),
      before: null,
      event: {
        type: "TransactionRecorded",
        aggregateType: "Transaction",
        aggregateId: newUuid(),
        payload: { on },
        effectiveOn: CalendarDate.parse(on),
      },
      touchedAccountIds: [accountId],
      apply: async () => ({ result: null, after: { on } }),
    });

  await post(hdfc, "2026-08-05");
  check("the touched account bumps", await revisionOf(hdfc), 1);
  check("an untouched account does not", await revisionOf(icici), 0);
  check("minAffectedDate is set", await minDateOf(hdfc), "2026-08-05");

  // A backdated write must LOWER the boundary; a later one must not raise it.
  await post(hdfc, "2019-03-15");
  check("a backdated write lowers minAffectedDate", await minDateOf(hdfc), "2019-03-15");
  await post(hdfc, "2026-08-06");
  check("a later write leaves it alone", await minDateOf(hdfc), "2019-03-15");
  check("but still bumps the revision", await revisionOf(hdfc), 3);

  section("B04 — cache invalidation, both halves");

  /*
   * This is where the plan of record needed correcting. Its Phase 1f item asks
   * that a backdated 2019 entry not invalidate 2024, which is true for a
   * period-scoped projection and false for a cumulative one — a 2019 opening
   * balance certainly changes a 2024 closing balance. Both directions are
   * asserted, because getting this wrong in the "leave it cached" direction
   * produces a wrong number that nothing detects.
   */
  const seedCache = async () => {
    await db.delete(projectionCache);
    await db.insert(projectionCache).values([
      {
        id: "period-fy2425",
        userId: USER,
        projection: "income_statement",
        scope: "PERIOD",
        periodStart: "2024-04-01",
        periodEnd: "2025-03-31",
        asOf: null,
        revisionVectorHash: "seed",
        payloadJson: "{}",
      },
      {
        id: "cumulative-2024",
        userId: USER,
        projection: "net_worth",
        scope: "CUMULATIVE",
        periodStart: null,
        periodEnd: null,
        asOf: "2024-12-31",
        revisionVectorHash: "seed",
        payloadJson: "{}",
      },
    ]);
  };
  const cachedIds = async (): Promise<string[]> => {
    const rows = await db.select({ id: projectionCache.id }).from(projectionCache);
    return rows.map((r) => r.id).sort();
  };

  await seedCache();
  await post(hdfc, "2019-06-01");
  checkDeep(
    "a backdated 2019 write spares the FY2024-25 income statement, drops the 2024 net worth",
    await cachedIds(),
    ["period-fy2425"],
  );

  await seedCache();
  await post(hdfc, "2024-09-15");
  checkDeep(
    "a write inside the period drops the income statement and the net worth",
    await cachedIds(),
    [],
  );

  await seedCache();
  await post(hdfc, "2026-01-10");
  checkDeep(
    "a write after both leaves both cached",
    await cachedIds(),
    ["cumulative-2024", "period-fy2425"],
  );

  await seedCache();
  await uow.mutate({
    action: "UPDATE",
    entityType: "Account",
    entityId: hdfc,
    before: { name: "HDFC Savings" },
    event: {
      type: "AccountRenamed",
      aggregateType: "Account",
      aggregateId: hdfc,
      payload: { name: "HDFC Primary" },
      effectiveOn: null,
    },
    touchedAccountIds: [hdfc],
    apply: async (tx) => {
      await tx.update(ledgerAccounts).set({ name: "HDFC Primary" }).where(eq(ledgerAccounts.id, hdfc));
      return { result: null, after: { name: "HDFC Primary" } };
    },
  });
  checkDeep(
    "a write with no accounting date invalidates nothing — it changes no balance",
    await cachedIds(),
    ["cumulative-2024", "period-fy2425"],
  );

  section("a rename records both images");

  const renames = await db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.entityId, hdfc), eq(auditEvents.action, "UPDATE")));
  check("the before-image is captured", JSON.parse(renames[0].beforeJson ?? "{}").name, "HDFC Savings");
  check("and the after-image", JSON.parse(renames[0].afterJson ?? "{}").name, "HDFC Primary");

  section("the revision vector hash is order-independent and change-sensitive");

  const a = [
    { id: "acc-b", revision: 2 },
    { id: "acc-a", revision: 1 },
  ];
  const b = [
    { id: "acc-a", revision: 1 },
    { id: "acc-b", revision: 2 },
  ];
  check("query order does not change the key", hashRevisionVector(a), hashRevisionVector(b));
  check(
    "but a revision bump does",
    hashRevisionVector(a) === hashRevisionVector([
      { id: "acc-a", revision: 1 },
      { id: "acc-b", revision: 3 },
    ]),
    false,
  );
  check(
    "and so does a different account set",
    hashRevisionVector(a) === hashRevisionVector([{ id: "acc-a", revision: 1 }]),
    false,
  );

  const live = await uow.revisionVectorHash([hdfc, icici]);
  check("a live vector is a 16-character hex key", /^[0-9a-f]{16}$/.test(live), true);

  client.close();
  done();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
