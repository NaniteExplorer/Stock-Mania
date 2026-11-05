/**
 * Tier history (support for task 3.4): the previous tier is persisted, at most
 * one row per user per day, written only by the explicit `RecordStandingTier`
 * use case through `mutateAtomic`, and read back as "the latest record strictly
 * before today" so `/standing` can run demotion hysteresis. Made-up figures.
 */
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { FixedClock, Ok, UserId, newUuid } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Ratio } from "@/core/units";
import { StandingMeasurements, type StandingMeasurementsOutput, type StandingSources } from "@/app/standing.usecases";
import { RecordStandingTier } from "@/app/standing-tier.usecases";
import type { Measurement } from "@/domain/scoring/composite";
import { INDICATORS } from "@/domain/scoring/indicators";
import { scoreCard } from "@/domain/scoring/score-card";
import { tierRecord, type TierHistoryReader, type TierHistoryWriter, type TierRecord } from "@/domain/scoring/tier-history";
import { tierFor } from "@/domain/scoring/tiers";
import * as schema from "@/infra/db/schema";
import { DrizzleTierHistoryReader, DrizzleTierHistoryWriter } from "@/infra/tier-history-store";
import { newRequestContext } from "@/infra/unit-of-work";
import { check, checkDeep, checkTrue, done, section, throwsAsync } from "./harness";

const file = `tmp/tier-history-${newUuid()}.db`;
const client = createClient({ url: `file:${file}` });
const db = drizzle(client, { schema });
const owner = UserId.from("tier-owner"), other = UserId.from("tier-other");
const clock = new FixedClock(new Date("2026-11-03T06:00:00Z"));
const on = CalendarDate.parse;
const facts = { healthCover: "covered", foir: null } as const;
const count = async (sql: string) => Number((await client.execute(sql)).rows[0].n);

/** Every indicator measured at `value`: a composite that scores, whatever it scores. */
const allMeasured = (value: number): ReadonlyMap<string, Measurement> =>
  new Map(INDICATORS.map((indicator) => [indicator.id, { state: "measured", value: value as never } as Measurement]));

async function main() {
  await client.execute("PRAGMA foreign_keys=ON");
  const dir = "src/infra/db/migrations";
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${dir}/${name}`, "utf8").split("--> statement-breakpoint")) if (statement.trim()) await client.execute(statement);
  }
  for (const user of [owner, other]) await client.execute({ sql: "INSERT INTO user(id,name,email) VALUES(?,?,?)", args: [user.value, user.value, `${user.value}@example.test`] });

  const reader = new DrizzleTierHistoryReader(db);
  const writer = new DrizzleTierHistoryWriter(db, newRequestContext(owner.value, clock, { requestId: "tier-request" }));
  const upper = tierFor(Ratio(0.85), facts, null);
  const middle = tierFor(Ratio(0.55), facts, null);

  section("store: one row per day, latest strictly before, audited");
  check("no history reads as null", await reader.latestBefore(owner, on("2026-11-03")), null);
  await writer.record(owner, tierRecord(on("2026-11-01"), upper, Ratio(0.85)));
  await writer.record(owner, tierRecord(on("2026-11-02"), middle, Ratio(0.55)));
  const before3 = await reader.latestBefore(owner, on("2026-11-03"));
  check("latest before the 3rd is the 2nd", before3?.on.toISO(), "2026-11-02");
  check("…with the tier shown", before3?.tier, "MIDDLE");
  check("…the earned tier", before3?.earned, "MIDDLE");
  check("…and the score to six places", before3?.score, 0.55);
  check("strictly before: the 2nd's own record does not answer for the 2nd", (await reader.latestBefore(owner, on("2026-11-02")))?.on.toISO(), "2026-11-01");
  check("nothing before the first record", await reader.latestBefore(owner, on("2026-11-01")), null);

  await writer.record(owner, tierRecord(on("2026-11-02"), upper, Ratio(0.812345678)));
  check("a second record the same day keeps one row", await count("SELECT count(*) AS n FROM tier_history WHERE user_id = 'tier-owner' AND recorded_on = '2026-11-02'"), 1);
  const replaced = await reader.latestBefore(owner, on("2026-11-03"));
  check("…and replaces it", replaced?.tier, "UPPER");
  check("score stored as an integer × 1e6, rounded", (await client.execute("SELECT score_scaled AS s, typeof(score_scaled) AS t FROM tier_history WHERE recorded_on = '2026-11-02'")).rows.map((r) => `${r.s}:${r.t}`)[0], "812346:integer");
  check("three writes, three audit events", await count("SELECT count(*) AS n FROM audit_events WHERE entity_type = 'tier_history'"), 3);
  checkDeep("…create, create, update", (await client.execute("SELECT action FROM audit_events WHERE entity_type = 'tier_history' ORDER BY rowid")).rows.map((r) => r.action), ["CREATE", "CREATE", "UPDATE"]);
  check("and a ledger event each", await count("SELECT count(*) AS n FROM ledger_events WHERE event_type = 'tier_history.recorded'"), 3);
  check("another owner's history is invisible", await reader.latestBefore(other, on("2026-11-03")), null);
  await client.execute("UPDATE tier_history SET deleted_at = 1 WHERE user_id = 'tier-owner' AND recorded_on = '2026-11-02'");
  check("a tombstoned day is ignored by the read", (await reader.latestBefore(owner, on("2026-11-03")))?.on.toISO(), "2026-11-01");
  await writer.record(owner, tierRecord(on("2026-11-02"), upper, Ratio(0.812345678)));
  check("recording that day again revives the one row", await count("SELECT count(*) AS n FROM tier_history WHERE user_id = 'tier-owner' AND recorded_on = '2026-11-02' AND deleted_at IS NULL"), 1);

  section("store refuses what the domain would never write");
  await throwsAsync("a writer cannot record for someone else", () => writer.record(other, tierRecord(on("2026-11-02"), upper, Ratio(0.85))), "owner");
  check("the refusal wrote nothing", await count("SELECT count(*) AS n FROM tier_history WHERE user_id = 'tier-other'"), 0);
  const beforeInvalid = await count("SELECT count(*) AS n FROM tier_history");
  for (const score of [-0.0000001, 1.0000001]) {
    await throwsAsync(`unrounded score ${score} refused by public writer`, () => writer.record(owner, { on: on("2026-11-04"), tier: "UPPER", earned: "UPPER", score: Ratio(score) }), "fraction");
  }
  check("invalid scores did not create rows", await count("SELECT count(*) AS n FROM tier_history"), beforeInvalid);
  let refused = false;
  try { tierRecord(on("2026-11-02"), upper, Ratio(1.2)); } catch { refused = true; }
  check("a score above 1 is not a composite", refused, true);
  let checkFired = false;
  try { await client.execute("INSERT INTO tier_history(id,user_id,recorded_on,tier,earned_tier,score_scaled) VALUES('x','tier-owner','2026-10-01','TOP','UPPER',1)"); } catch { checkFired = true; }
  check("the CHECK refuses an unknown tier", checkFired, true);
  checkFired = false;
  try { await client.execute("INSERT INTO tier_history(id,user_id,recorded_on,tier,earned_tier,score_scaled) VALUES('y','tier-owner','2026-02-30','UPPER','UPPER',1)"); } catch { checkFired = true; }
  check("…and an impossible date", checkFired, true);

  section("read side: StandingMeasurements returns the previous tier");
  const empty: StandingSources = {
    balances: {
      async monthlyFlows() { return []; },
      async balanceSheet() { return []; },
    } as unknown as StandingSources["balances"],
    async liquidAssets() { return Money.zero(); },
    async monthlyService() { return new Map(); },
    insurance: { async list() { return []; }, async declarations() { return []; } },
    commitments: { async list() { return []; } },
  };
  const read = async (sources: StandingSources, today: string) => {
    const result = await new StandingMeasurements(sources).execute({ userId: owner, today: on(today) });
    if (!result.ok) throw new Error(result.error.message);
    return result.value.previous;
  };
  check("no reader wired: previous stays null", await read(empty, "2026-11-03"), null);
  check("with the store: the tier recorded before today", await read({ ...empty, tierHistory: reader }, "2026-11-03"), "UPPER");
  check("on the 2nd it is the 1st's tier", await read({ ...empty, tierHistory: reader }, "2026-11-02"), "UPPER");
  check("before any record: null", await read({ ...empty, tierHistory: reader }, "2026-11-01"), null);
  const asked: string[] = [];
  const spy: TierHistoryReader = { async latestBefore(_user, before) { asked.push(before.toISO()); return null; } };
  await read({ ...empty, tierHistory: spy }, "2026-11-03");
  checkDeep("the read asks for records strictly before today", asked, ["2026-11-03"]);

  section("RecordStandingTier: the only write path, explicit, server-action-free");
  const written: TierRecord[] = [];
  const memory: TierHistoryWriter = { async record(_user, record) { written.push(record); } };
  const fakeMeasurements = (measurements: ReadonlyMap<string, Measurement>, previous: StandingMeasurementsOutput["previous"]) => ({
    async execute() { return Ok({ measurements, facts, previous, oldestInput: null, limitations: [] } satisfies StandingMeasurementsOutput); },
  });

  const refusedRun = await new RecordStandingTier(fakeMeasurements(new Map(), null), memory).execute({ userId: owner, today: on("2026-11-03") });
  checkTrue("a refused composite is not recorded", refusedRun.ok && refusedRun.value.state === "not-recorded");
  check("…and nothing was written", written.length, 0);

  const scored = allMeasured(1);
  const expected = scoreCard(scored, facts, "UPPER");
  checkTrue("fixture: the composite scores", expected.composite.state === "scored" && expected.tier !== null);
  const run = await new RecordStandingTier(fakeMeasurements(scored, "UPPER"), memory).execute({ userId: owner, today: on("2026-11-03") });
  checkTrue("a scored composite is recorded", run.ok && run.value.state === "recorded");
  check("one record written", written.length, 1);
  check("…dated today", written[0]?.on.toISO(), "2026-11-03");
  check("…with the tier the page shows (same scoreCard, same previous)", written[0]?.tier, expected.tier?.tier);
  check("…and the composite score", written[0]?.score, expected.composite.state === "scored" ? expected.composite.score : -1);

  const dbRun = await new RecordStandingTier(fakeMeasurements(scored, null), writer).execute({ userId: owner, today: on("2026-11-03") });
  checkTrue("through the Drizzle writer too", dbRun.ok && dbRun.value.state === "recorded");
  check("today's row exists once", await count("SELECT count(*) AS n FROM tier_history WHERE user_id = 'tier-owner' AND recorded_on = '2026-11-03'"), 1);
  check("and does not answer for today", (await reader.latestBefore(owner, on("2026-11-03")))?.on.toISO(), "2026-11-02");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    client.close();
    for (const suffix of ["", "-shm", "-wal"]) {
      try { rmSync(file + suffix, { force: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; }
    }
    if (process.exitCode !== 1) done();
  });
