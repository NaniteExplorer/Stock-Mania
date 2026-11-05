/**
 * Task 4.1: the optional date of birth. Real libSQL file, every migration applied.
 */
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import { ownerProfiles, users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId } from "@/core/kernel";
import { CalendarDate } from "@/core/time";
import { SetDateOfBirth, LoadProjectionAssumptions, ageOn } from "@/app/projection.usecases";
import { DrizzleOwnerProfileStore, DrizzleProjectionAssumptionStore } from "@/infra/projection-store";
import { parseBornOn } from "../app/(root)/settings/dob";
import { check, done, section } from "./harness";

const DB_FILE = "./tmp/dob.db";
const d = CalendarDate.parse;

async function main() {
  section("age arithmetic");
  check("day before the birthday", ageOn(d("1990-10-31"), d("2026-10-30")), 35);
  check("on the birthday", ageOn(d("1990-10-30"), d("2026-10-30")), 36);
  check("29 Feb birth, 28 Feb non-leap", ageOn(d("2000-02-29"), d("2026-02-28")), 25);
  check("future birth is null", ageOn(d("2027-01-01"), d("2026-10-30")), null);

  section("form parsing");
  const blank = parseBornOn("");
  check("empty clears", blank.ok ? blank.bornOn : "error", null);
  check("non-string cannot clear DOB", parseBornOn(new Blob(["1990-01-01"])).ok, false);
  check("garbage refused", parseBornOn("15/04/1990").ok, false);
  const iso = parseBornOn("1990-04-15");
  check("ISO accepted", iso.ok ? iso.bornOn?.toString() : "error", "1990-04-15");

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
  const owner = UserId.from("user_dob_1");
  const other = UserId.from("user_dob_2");
  for (const id of [owner, other]) {
    await db.insert(users).values({ id: id.value, name: "T", email: `${id.value}@example.com`, emailVerified: true, createdAt: now, updatedAt: now });
  }
  const clock = new FixedClock(now);
  const profiles = new DrizzleOwnerProfileStore(db);
  const setDob = new SetDateOfBirth(profiles, clock);
  const load = new LoadProjectionAssumptions(new DrizzleProjectionAssumptionStore(db), profiles, clock);

  section("optional, scoped, soft-replaced");
  check("none stored is null", await profiles.bornOn(owner), null);
  check("saves", (await setDob.execute({ userId: owner, bornOn: d("1990-04-15") })).ok, true);
  check("reads back", (await profiles.bornOn(owner))?.toString(), "1990-04-15");
  check("the other user has none", await profiles.bornOn(other), null);
  const loaded = await load.execute({ userId: owner });
  check("derives current age", loaded.ok ? loaded.value.assumptions.get("currentAge").value : -1, 36);
  check("clearing is allowed", (await setDob.execute({ userId: owner, bornOn: null })).ok, true);
  check("cleared reads null", await profiles.bornOn(owner), null);
  const after = await load.execute({ userId: owner });
  check("and the age is unknown again, not guessed", after.ok ? after.value.assumptions.get("currentAge").value : -1, null);
  const rows = await db.select().from(ownerProfiles).where(eq(ownerProfiles.userId, owner.value));
  check("history kept: two rows, A03", rows.length, 2);

  section("refusals");
  check("future date refused", (await setDob.execute({ userId: owner, bornOn: d("2027-01-01") })).ok, false);
  check("age above 120 refused", (await setDob.execute({ userId: owner, bornOn: d("1900-01-01") })).ok, false);
  let rejected = false;
  try {
    await client.execute("INSERT INTO owner_profiles (id, user_id, born_on) VALUES ('x', 'user_dob_2', '1990-02-30')");
  } catch {
    rejected = true;
  }
  check("the database refuses an impossible date", rejected, true);

  client.close();
  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
