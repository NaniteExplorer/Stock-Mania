/**
 * Projection AssumptionSet persistence: real libSQL file, every migration applied.
 * Round-trips through AssumptionSet.with(); null stays unknown; scoped per user;
 * replacing a value tombstones (A03) rather than deletes.
 */
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { projectionAssumptions, users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Count, Ratio, Years } from "@/core/units";
import { projectionGate } from "@/domain/projection/gate";
import {
  LoadProjectionAssumptions,
  SaveProjectionAssumptions,
  SetDateOfBirth,
  hydrate,
  decodeValue,
  encodeValue,
} from "@/app/projection.usecases";
import { DrizzleOwnerProfileStore, DrizzleProjectionAssumptionStore } from "@/infra/projection-store";
import { parseAssumptionsForm } from "../app/(root)/projection/assumptions-form";
import { buildProjectionView, NO_SAVED_ASSUMPTIONS } from "../app/(root)/projection/projection-model";
import { check, checkDeep, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/projection-assumptions-store.db";

async function main() {
  section("codec");
  check("money round-trips exactly", decodeValue("monthlyContribution", encodeValue("monthlyContribution", Money.fromRupees("25000.50")))?.toDecimalString(), "25000.50");
  check("a ratio round-trips", decodeValue("inflation", encodeValue("inflation", Ratio(0.065))), 0.065);
  check("null stays null", encodeValue("inflation", null), null);

  section("invalid stored facts remain unknown");
  const invalid = hydrate([{ key: "withdrawalRate", stated: "0", source: '{"kind":"OWNER"}', verifiedOn: null }], null, CalendarDate.parse("2026-11-03"));
  check("invalid persisted rate does not regain cited default", invalid.assumptions.get("withdrawalRate").value, null);
  check("invalid persisted rate is reported", invalid.dropped.length, 1);
  const aged = hydrate([], CalendarDate.parse("1905-11-03"), CalendarDate.parse("2026-11-03"));
  check("age beyond supported horizon is unknown", aged.assumptions.get("currentAge").value, null);
  check("age beyond supported horizon is reported", aged.dropped.length, 1);
  section("form parsing");
  check("non-string assumption cannot clear it", parseAssumptionsForm({ inflation: new Blob(["6"]) }).ok, false);
  check("non-string verification date refused", parseAssumptionsForm({ npsVerifiedOn: new Blob(["date"]) }).ok, false);
  const parsed = parseAssumptionsForm({ retirementAge: "60", horizonAge: "", inflation: "6.5", monthlyContribution: "abc" });
  check("a bad amount is a field error", parsed.ok ? "" : parsed.fieldErrors.monthlyContribution?.[0], "Enter an amount like 25000 or 25000.50.");
  const good = parseAssumptionsForm({ retirementAge: "60", inflation: "6.5", npsAnnuityShareGovt: "40", npsVerifiedOn: "2026-10-01" });
  checkTrue("a good form parses", good.ok);
  if (good.ok) {
    check("6.5% becomes 0.065", good.changes.find((c) => c.key === "inflation")?.value, 0.065);
    check("an empty field is unknown, not zero", good.changes.find((c) => c.key === "equityShare")?.value, null);
    check("the verification date rides on regulatory keys", good.changes.find((c) => c.key === "npsAnnuityShareGovt")?.verifiedOn?.toString(), "2026-10-01");
  }

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
  const now = new Date("2026-10-30T06:00:00Z");
  const owner = UserId.from("user_pa_1");
  const other = UserId.from("user_pa_2");
  for (const id of [owner, other]) {
    await db.insert(users).values({ id: id.value, name: "T", email: `${id.value}@example.com`, emailVerified: true, createdAt: now, updatedAt: now });
  }
  const clock = new FixedClock(now);
  const store = new DrizzleProjectionAssumptionStore(db);
  const profiles = new DrizzleOwnerProfileStore(db);
  const load = new LoadProjectionAssumptions(store, profiles, clock);
  const save = new SaveProjectionAssumptions(store, profiles, clock);
  const setDob = new SetDateOfBirth(profiles, clock);

  section("nothing stored: the initial set, unsaved");
  const empty = await load.execute({ userId: owner });
  if (!empty.ok) throw empty.error;
  check("not saved", empty.value.saved, false);
  check("inflation unknown", empty.value.assumptions.get("inflation").value, null);
  check("current age unknown without a DOB", empty.value.assumptions.get("currentAge").value, null);
  const refused = buildProjectionView({ assumptions: empty.value.assumptions, assumptionsSaved: false, gate: null, hasInvestments: true, startWealth: null, returns: [], target: null, assumptionsChanged: false });
  checkTrue("the page still refuses, naming unsaved assumptions", refused.kind === "refused" && refused.reasons.includes(NO_SAVED_ASSUMPTIONS));

  section("save and round-trip");
  await setDob.execute({ userId: owner, bornOn: CalendarDate.parse("1990-11-15") });
  const saved = await save.execute({
    userId: owner,
    changes: [
      { key: "horizonAge", value: Years(90) },
      { key: "retirementAge", value: Years(60) },
      { key: "inflation", value: Ratio(0.06) },
      { key: "monthlyContribution", value: Money.fromRupees("30000") },
      { key: "equityShare", value: Ratio(0.7) },
      { key: "withdrawalRate", value: Ratio(0.03) },
      { key: "blockYears", value: Count(4) },
      { key: "npsAnnuityShareNonGovt", value: Ratio(0.2), verifiedOn: CalendarDate.parse("2026-10-01") },
      { key: "npsAnnuityShareGovt", value: Ratio(0.4), verifiedOn: CalendarDate.parse("2026-10-01") },
    ],
  });
  checkTrue("saved", saved.ok);
  const back = await load.execute({ userId: owner });
  if (!back.ok) throw back.error;
  const a = back.value.assumptions;
  check("saved flag", back.value.saved, true);
  check("current age derived from DOB (35 before the Nov birthday)", a.get("currentAge").value, 35);
  check("the age source names the DOB", a.get("currentAge").source?.kind, "OWN_HISTORY");
  check("retirement age", a.get("retirementAge").value, 60);
  check("contribution exact", a.get("monthlyContribution").value?.toDecimalString(), "30000.00");
  check("owner-typed value is OWNER", a.get("inflation").source?.kind, "OWNER");
  check("re-stating the cited 3% keeps the citation", a.get("withdrawalRate").source?.kind, "CITED");
  check("NPS verification persisted", a.get("npsAnnuityShareGovt").verifiedOn?.toString(), "2026-10-01");
  checkDeep("no assumption blockers left", a.blockers({ holdsNps: true }), []);
  const gate = projectionGate({ historyMonths: Count(3), categorisedShare: null, minimumCoverage: Ratio(0.8), unresolvedHoldings: [], holdsNps: false }, a);
  checkTrue("unmeasured gate inputs still refuse", gate.state === "refused" && gate.reasons.length === 2);

  section("null clears to unknown; replacement tombstones");
  await save.execute({ userId: owner, changes: [{ key: "inflation", value: null }] });
  const cleared = await load.execute({ userId: owner });
  if (!cleared.ok) throw cleared.error;
  check("inflation unknown again", cleared.value.assumptions.get("inflation").value, null);
  checkTrue("the gate names it", cleared.value.assumptions.blockers({ holdsNps: false }).includes("Inflation is not set."));
  const inflationRows = await db.select().from(projectionAssumptions).where(and(eq(projectionAssumptions.userId, owner.value), eq(projectionAssumptions.assumptionKey, "inflation")));
  check("two rows: one tombstoned, one live", inflationRows.length, 2);
  const live = await db.select().from(projectionAssumptions).where(and(eq(projectionAssumptions.assumptionKey, "inflation"), isNull(projectionAssumptions.deletedAt)));
  check("one live row", live.length, 1);

  section("an edit is not a verification");
  await save.execute({ userId: owner, changes: [{ key: "npsAnnuityShareGovt", value: Ratio(0.4) }] });
  const unverified = await load.execute({ userId: owner });
  if (!unverified.ok) throw unverified.error;
  check("verification dropped", unverified.value.assumptions.get("npsAnnuityShareGovt").verifiedOn, null);

  section("refusals are values");
  const bad = await save.execute({ userId: owner, changes: [{ key: "horizonAge", value: Years(55) }] });
  check("plan-to age below retirement is refused", bad.ok ? "" : bad.error.message, "The plan must run past the retirement age.");
  const typed = await save.execute({ userId: owner, changes: [{ key: "currentAge", value: Years(40) }] });
  check("current age cannot be typed", typed.ok, false);
  const future = await save.execute({ userId: owner, changes: [{ key: "npsAnnuityShareGovt", value: Ratio(0.4), verifiedOn: CalendarDate.parse("2027-01-01") }] });
  check("a future verification date is refused", future.ok, false);
  const raised = await save.execute({ userId: owner, changes: [{ key: "retirementAge", value: Years(95) }, { key: "horizonAge", value: Years(100) }] });
  checkTrue("raising both ages together is accepted", raised.ok);

  section("scoped per user");
  const theirs = await load.execute({ userId: other });
  if (!theirs.ok) throw theirs.error;
  check("the other user sees nothing saved", theirs.value.saved, false);
  check("and no age", theirs.value.assumptions.get("currentAge").value, null);
  check("and none of the owner's values", theirs.value.assumptions.get("retirementAge").value, null);

  section("a stored value that no longer fits is dropped, named");
  await setDob.execute({ userId: owner, bornOn: CalendarDate.parse("1925-01-01") });
  const old = await load.execute({ userId: owner });
  if (!old.ok) throw old.error;
  check("retirement age 95 below current age 101 is dropped", old.value.assumptions.get("retirementAge").value, null);
  check("and named", old.value.dropped.length >= 1, true);

  client.close();
  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
