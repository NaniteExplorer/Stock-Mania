import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq, sql } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { auditEvents, ledgerAccounts, ledgerEvents, projectionCache, users } from "@/infra/db/schema";
import { FixedClock, newUuid } from "@/core/kernel";
import { CalendarDate } from "@/core/time";
import { UnitOfWork, newRequestContext, type AtomicMutation } from "@/infra/unit-of-work";
import { check, checkDeep, done, section } from "./harness";

async function main() {
  // File-backed: libSQL's independent in-memory transaction connection is unsuitable here.
  const file = `./tmp/unit-of-work-atomic-${newUuid()}.db`;
  const client = createClient({ url: `file:${file}` });
  const db = drizzle(client, { schema });
  try {
    for (const file of readdirSync("./src/infra/db/migrations").filter((f) => f.endsWith(".sql")).sort()) {
      for (const statement of readFileSync(`./src/infra/db/migrations/${file}`, "utf8").split("--> statement-breakpoint")) {
        if (statement.trim()) await client.execute(statement.trim());
      }
    }
    const now = new Date("2026-10-30T10:00:00Z");
    await db.insert(users).values(["atomic-owner", "atomic-other"].map((id) => ({
      id, name: id, email: `${id}@example.test`, createdAt: now, updatedAt: now,
    })));
    await db.insert(ledgerAccounts).values([
      { id: "own", userId: "atomic-owner", code: "Assets:Own", name: "Original", type: "ASSET", subtype: "BANK" },
      { id: "foreign", userId: "atomic-other", code: "Assets:Other", name: "Foreign", type: "ASSET", subtype: "BANK" },
    ]);
    const seedCache = async () => {
      await db.delete(projectionCache);
      await db.insert(projectionCache).values(["atomic-owner", "atomic-other"].map((userId) => ({
        id: `cache-${userId}`, userId, projection: "balance_sheet", scope: "CUMULATIVE" as const,
        asOf: "2026-10-30", revisionVectorHash: "seed", payloadJson: "{}",
      })));
    };
    await seedCache();
    const context = newRequestContext("atomic-owner", new FixedClock(now), { requestId: "atomic-request" });
    const uow = new UnitOfWork(db, context);
    const mutation = (id: string, failApply = false): AtomicMutation<string> => ({
      action: "UPDATE", entityType: "AtomicExample", entityId: id,
      before: { name: "Original" },
      event: { type: "AtomicChanged", aggregateType: "Account", aggregateId: "own", payload: { minor: 9007199254740993n }, effectiveOn: CalendarDate.parse("2026-10-01") },
      touchedAccountIds: ["own", "foreign"],
      apply: async (tx) => {
        await tx.update(ledgerAccounts).set({ name: id }).where(eq(ledgerAccounts.id, "own"));
        await tx.insert(ledgerAccounts).values({ id, userId: "atomic-owner", code: `Assets:${id}`, name: id, type: "ASSET", subtype: "BANK" });
        if (failApply) throw new Error("injected apply failure");
        return { result: id, after: { name: id, minor: 9007199254740993n } };
      },
    });
    const state = async () => ({
      accounts: await db.select().from(ledgerAccounts).orderBy(ledgerAccounts.id),
      audit: await db.select().from(auditEvents).orderBy(auditEvents.id),
      events: await db.select().from(ledgerEvents).orderBy(ledgerEvents.seq),
      cache: await db.select().from(projectionCache).orderBy(projectionCache.id),
    });

    section("Every atomic stage rolls back the complete write");
    for (const stage of ["apply", "audit", "event", "revision", "cache"] as const) {
      const triggerTarget = {
        audit: "BEFORE INSERT ON audit_events", event: "BEFORE INSERT ON ledger_events",
        revision: "BEFORE UPDATE OF revision ON ledger_accounts", cache: "BEFORE DELETE ON projection_cache",
      };
      if (stage !== "apply") await client.execute(`CREATE TRIGGER fail_atomic ${triggerTarget[stage]} BEGIN SELECT RAISE(ABORT, 'injected ${stage} failure'); END`);
      const before = await state();
      let failure: unknown;
      try {
        await uow.mutateAtomic(mutation(`failed-${stage}`, stage === "apply"));
      } catch (error) {
        failure = error;
      }
      // Drizzle wraps SQL errors; the original trigger refusal is retained as its cause.
      const messages: string[] = [];
      let cause = failure;
      while (cause instanceof Error) {
        messages.push(cause.message);
        cause = cause.cause;
      }
      check(`${stage} failure propagates its original cause`, messages.some((message) => message.includes(`injected ${stage} failure`)), true);
      checkDeep(`${stage} failure preserves every account, audit, event and cache row`, await state(), before);
      if (stage !== "apply") await client.execute("DROP TRIGGER fail_atomic");
    }

    section("Success commits multirow data and exactly one audit/event");
    check("returns apply result", await uow.mutateAtomic(mutation("committed")), "committed");
    const committed = await state();
    check("both aggregate writes committed", committed.accounts.find((a) => a.id === "own")?.name, "committed");
    check("child row committed", committed.accounts.some((a) => a.id === "committed"), true);
    check("one audit", committed.audit.length, 1);
    check("one event", committed.events.length, 1);
    check("request identity audit", committed.audit[0].requestId, context.requestId);
    check("request identity event", committed.events[0].requestId, context.requestId);
    check("audit owner", committed.audit[0].userId, "atomic-owner");
    check("before image", JSON.parse(committed.audit[0].beforeJson!).name, "Original");
    check("exact bigint snapshot", JSON.parse(committed.audit[0].afterJson!).minor, "9007199254740993n");
    check("exact bigint event", JSON.parse(committed.events[0].payloadJson).minor, "9007199254740993n");
    check("owner revision bumped", committed.accounts.find((a) => a.id === "own")?.revision, 1);
    check("effective date propagated", committed.accounts.find((a) => a.id === "own")?.minAffectedDate, "2026-10-01");
    check("foreign account revision isolated", committed.accounts.find((a) => a.id === "foreign")?.revision, 0);
    check("foreign account name isolated", committed.accounts.find((a) => a.id === "foreign")?.name, "Foreign");
    checkDeep("only foreign projection survives", committed.cache.map((c) => c.userId), ["atomic-other"]);

    section("Null accounting date keeps cache and minimum date");
    await seedCache();
    const noDate = mutation("no-date");
    await uow.mutateAtomic({ ...noDate, event: { ...noDate.event, effectiveOn: null } });
    check("undated change still bumps owner revision", (await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, "own")))[0].revision, 2);
    check("undated change retains minimum", (await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, "own")))[0].minAffectedDate, "2026-10-01");
    check("undated change keeps both projections", (await db.select().from(projectionCache)).length, 2);
    check("foreign revision remains unchanged", (await db.all<{ revision: number }>(sql`SELECT revision FROM ledger_accounts WHERE id = 'foreign'`))[0].revision, 0);
    done();
  } finally {
    client.close();
    for (const suffix of ["", "-shm", "-wal"]) {
      try { rmSync(file + suffix); } catch (error) {
        // Windows can retain a just-closed SQLite handle; keep only that synthetic artifact.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" && (error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      }
    }
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
