/**
 * Stored target allocation (financial-health-scoring.md § 3.6 persistence): the
 * class-B store with audited whole-allocation replacement, validation through the
 * domain's `targetAllocation()`, and the signals board reading it. Made-up figures.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { FixedClock, UserId, newUuid } from "@/core/kernel";
import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { LoadTargetAllocation, RecordTargetAllocation, RemoveTargetAllocation } from "@/app/target-allocation.usecases";
import { sleevesFromTarget } from "@/app/signals.usecases";
import { MUTATION_CLASSES, allows } from "@/domain/mutation-classes";
import { targetAllocation } from "@/domain/portfolio";
import * as schema from "@/infra/db/schema";
import { DrizzleTargetAllocationReader, DrizzleTargetAllocationWriter } from "@/infra/target-allocation-store";
import { newRequestContext } from "@/infra/unit-of-work";
import { check, checkDeep, checkTrue, done, section, throwsAsync } from "./harness";

const file = `tmp/target-allocation-${newUuid()}.db`;
const client = createClient({ url: `file:${file}` });
const db = drizzle(client, { schema });
const owner = UserId.from("ta-owner"), other = UserId.from("ta-other");
const clock = new FixedClock(new Date("2026-11-04T06:00:00Z"));
const count = async (sql: string) => Number((await client.execute(sql)).rows[0].n);
const shares = (r: { ok: boolean; value?: unknown }) =>
  r.ok && r.value ? (r.value as { shares: readonly { id: string; share: Percentage }[] }).shares.map((s) => `${s.id}:${s.share.scaled}`) : null;

async function main() {
  section("mutation class");
  check("target_allocations is class B", MUTATION_CLASSES.target_allocations.class, "B");
  checkTrue("owner may update and tombstone, never post", allows("target_allocations", "update") && allows("target_allocations", "tombstone") && !allows("target_allocations", "post"));

  section("store: audited, user-scoped, replaced whole, tombstoned");
  await client.execute("PRAGMA foreign_keys=ON");
  const dir = "src/infra/db/migrations";
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${dir}/${name}`, "utf8").split("--> statement-breakpoint")) if (statement.trim()) await client.execute(statement);
  }
  for (const user of [owner, other]) await client.execute({ sql: "INSERT INTO user(id,name,email) VALUES(?,?,?)", args: [user.value, user.value, `${user.value}@example.test`] });
  const reader = new DrizzleTargetAllocationReader(db);
  const writer = new DrizzleTargetAllocationWriter(db, newRequestContext(owner.value, clock, { requestId: "ta-request" }));
  const record = new RecordTargetAllocation(writer), remove = new RemoveTargetAllocation(writer), load = new LoadTargetAllocation(reader);

  const empty = await load.execute({ userId: owner });
  checkTrue("nothing stored loads null", empty.ok && empty.value === null);

  for (const [label, sleeves, reason] of [
    ["99.999999% refused", [{ id: "equity", share: "50" }, { id: "debt", share: "49.999999" }], "not 100%"],
    ["over 100% refused", [{ id: "equity", share: "60" }, { id: "debt", share: "41" }], "not 100%"],
    ["seven decimals refused", [{ id: "equity", share: "50.0000001" }, { id: "debt", share: "49.9999999" }], "at most"],
    ["duplicate id refused", [{ id: "equity", share: "50" }, { id: "equity", share: "50" }], "twice"],
    ["zero share refused", [{ id: "equity", share: "100" }, { id: "debt", share: "0" }], "positive"],
    ["empty refused", [], "no sleeves"],
  ] as const) {
    const r = await record.execute({ userId: owner, sleeves });
    checkTrue(label, !r.ok && r.error.code === "VALIDATION_FAILED" && r.error.message.includes(reason));
  }
  check("refusals wrote nothing", await count("SELECT count(*) AS n FROM target_allocations"), 0);

  const first = await record.execute({ userId: owner, sleeves: [{ id: "equity", share: "60" }, { id: "debt", share: "30.5" }, { id: "gold", share: "9.5" }] });
  check("recorded", first.ok, true);
  checkDeep("loaded exact, ordered by sleeve id", shares(await load.execute({ userId: owner })), ["debt:30500000", "equity:60000000", "gold:9500000"]);
  check("stored as integer", (await client.execute("SELECT typeof(share_scaled) AS t FROM target_allocations LIMIT 1")).rows[0].t, "integer");

  await record.execute({ userId: owner, sleeves: [{ id: "equity", share: "70" }, { id: "debt", share: "30" }] });
  checkDeep("replace swaps the whole allocation", shares(await load.execute({ userId: owner })), ["debt:30000000", "equity:70000000"]);
  check("the dropped sleeve is a tombstone, not a delete", await count("SELECT count(*) AS n FROM target_allocations WHERE sleeve_id = 'gold' AND deleted_at IS NOT NULL"), 1);

  check("remove succeeds", (await remove.execute({ userId: owner })).ok, true);
  checkTrue("removed loads null", (await reader.load(owner)) === null);
  check("every sleeve tombstoned", await count("SELECT count(*) AS n FROM target_allocations WHERE deleted_at IS NULL"), 0);
  check("removing again is refused", (await remove.execute({ userId: owner })).ok, false);
  await record.execute({ userId: owner, sleeves: [{ id: "gold", share: "100" }] });
  checkDeep("recording again restores", shares(await load.execute({ userId: owner })), ["gold:100000000"]);
  check("revived in place, no duplicate rows", await count("SELECT count(*) AS n FROM target_allocations WHERE sleeve_id = 'gold'"), 1);

  checkDeep(
    "every write audited: create, update, soft delete, restore",
    (await client.execute("SELECT action FROM audit_events WHERE entity_type = 'target_allocations' ORDER BY rowid")).rows.map((r) => r.action),
    ["CREATE", "UPDATE", "SOFT_DELETE", "RESTORE"],
  );
  check("and a ledger event each", await count("SELECT count(*) AS n FROM ledger_events WHERE aggregate_type = 'target_allocations'"), 4);
  checkTrue("another owner sees nothing", (await reader.load(other)) === null);
  await throwsAsync("a writer cannot record for someone else", () => writer.replace(other, targetAllocation([{ id: "x", share: Percentage.of("100") }])), "owner");
  await throwsAsync("a forged allocation is re-validated", () => writer.replace(owner, { shares: [{ id: "x", share: Percentage.of("90") }] } as never), "not 100%");
  let rejected = false;
  try { await client.execute("INSERT INTO target_allocations(id,user_id,sleeve_id,share_scaled) VALUES('x','ta-owner','y',0)"); } catch { rejected = true; }
  checkTrue("database CHECK refuses a zero share", rejected);
  rejected = false;
  try { await client.execute("INSERT INTO target_allocations(id,user_id,sleeve_id,share_scaled) VALUES('z','ta-owner','y','10.5')"); } catch { rejected = true; }
  checkTrue("database CHECK refuses a non-integer share", rejected);

  section("concurrency: interleaved replaces leave exactly one whole allocation (QA FAIL 2026-11-05)");
  {
    const raceOwner = UserId.from("ta-race");
    await client.execute({ sql: "INSERT INTO user(id,name,email) VALUES(?,?,?)", args: [raceOwner.value, "race", "race@example.test"] });
    const ctx = () => newRequestContext(raceOwner.value, clock);
    await new DrizzleTargetAllocationWriter(db, ctx()).replace(raceOwner, targetAllocation([{ id: "original", share: Percentage.of("100") }]));
    const interleaved = new DrizzleTargetAllocationWriter(db, ctx());
    // The pending request's database runs the other replace to completion just before
    // its own transaction opens: the ordering that left first 100% + second 100% live.
    let fired = false;
    const racingDb = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "transaction") {
          return async (...args: unknown[]) => {
            if (!fired) { fired = true; await interleaved.replace(raceOwner, targetAllocation([{ id: "second", share: Percentage.of("100") }])); }
            return (target.transaction as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });
    await new DrizzleTargetAllocationWriter(racingDb, ctx()).replace(raceOwner, targetAllocation([{ id: "first", share: Percentage.of("100") }]));
    checkTrue("the interleaving actually happened", fired);
    checkDeep(
      "only the last replacement is live",
      (await client.execute({ sql: "SELECT sleeve_id FROM target_allocations WHERE user_id = ? AND deleted_at IS NULL", args: [raceOwner.value] })).rows.map((r) => r.sleeve_id),
      ["first"],
    );
    checkDeep("and it loads as 100%", (await reader.load(raceOwner))?.shares.map((x) => `${x.id}:${x.share.scaled}`), ["first:100000000"]);
    const lastAudit = (await client.execute({ sql: "SELECT action, before_json FROM audit_events WHERE entity_type = 'target_allocations' AND entity_id = ? ORDER BY rowid DESC LIMIT 1", args: [raceOwner.value] })).rows[0];
    check("the audit before-image is the state it replaced, not a stale read", lastAudit.before_json, JSON.stringify([{ sleeveId: "second", shareScaled: 100_000_000 }]));
    check("and the action is UPDATE", lastAudit.action, "UPDATE");
    const both = await Promise.allSettled([
      new DrizzleTargetAllocationWriter(db, ctx()).replace(raceOwner, targetAllocation([{ id: "p", share: Percentage.of("100") }])),
      new DrizzleTargetAllocationWriter(db, ctx()).replace(raceOwner, targetAllocation([{ id: "q", share: Percentage.of("100") }])),
    ]);
    checkTrue("concurrent replaces settle", both.some((r) => r.status === "fulfilled"));
    check("concurrent replaces leave one 100% sleeve", await count(`SELECT count(*) AS n FROM target_allocations WHERE user_id = 'ta-race' AND deleted_at IS NULL`), 1);
  }

  section("signals: stored target becomes band sleeves, refusing what it cannot place");
  const target = targetAllocation([{ id: "inst-a", share: Percentage.of("60") }, { id: "inst-b", share: Percentage.of("40") }]);
  const a = { id: "inst-a", name: "AAA", value: Money.fromMinor(6_000_00n) };
  const mapped = sleevesFromTarget(target, [a]);
  checkTrue("a target sleeve with no holding is a zero-value sleeve", "sleeves" in mapped && mapped.sleeves[1]!.value.isZero && mapped.sleeves[1]!.target.scaled === 40_000_000n);
  const extra = sleevesFromTarget(target, [a, { id: "inst-c", name: "CCC", value: Money.fromMinor(1n) }]);
  checkTrue("a holding with no target sleeve is refused", "state" in extra && extra.state === "REFUSED" && extra.reason.includes("CCC"));
  const unpriced = sleevesFromTarget(target, [{ ...a, value: null }]);
  checkTrue("an unvalued holding makes it unknown", "state" in unpriced && unpriced.state === "UNKNOWN" && unpriced.reason.includes("AAA"));

  client.close();
  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
