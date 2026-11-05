/**
 * /settings/allocation (financial-health-scoring.md § 3.6 follow-up): exact share totals,
 * rows from holdings plus stored-but-unheld sleeves, the owner-entered band through its
 * use cases and store (no default, 5/25 floor), and the links from the Signals UNKNOWN
 * state and the sidebar. Made-up figures throughout.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { FixedClock, UserId, newUuid } from "@/core/kernel";
import { LoadRebalancingBand, RecordRebalancingBand, RemoveRebalancingBand } from "@/app/target-allocation.usecases";
import * as schema from "@/infra/db/schema";
import { DrizzleRebalancingBandReader, DrizzleRebalancingBandWriter } from "@/infra/target-allocation-store";
import { newRequestContext } from "@/infra/unit-of-work";
import { NAV_ITEMS } from "@/ui/nav";
import { buildSleeveRows, formatScaled, scaledShare, sharesFromForm, sleevesToSubmit, totalOf } from "../app/(root)/settings/allocation/allocation-model";
import { check, checkDeep, checkTrue, done, section } from "./harness";

async function main() {
  section("model: exact totals");
  check("33.333333 parses exactly", scaledShare("33.333333"), 33_333_333n);
  check("seven decimals are not a share", scaledShare("1.0000001"), null);
  check("text is not a share", scaledShare("ten"), null);
  check("format trims trailing zeros", formatScaled(12_500_000n), "12.5");
  const thirds = totalOf([{ id: "a", share: "33.333333" }, { id: "b", share: "33.333333" }, { id: "c", share: "33.333334" }]);
  checkTrue("three thirds that sum exactly are complete", thirds.kind === "total" && thirds.complete);
  const short = totalOf([{ id: "a", share: "60" }, { id: "b", share: "39.999999" }]);
  checkTrue("99.999999 is not complete (no float rounding)", short.kind === "total" && !short.complete && short.text === "99.999999");
  const invalid = totalOf([{ id: "a", share: "x" }, { id: "b", share: "" }]);
  checkTrue("an invalid share is named; blank is ignored", invalid.kind === "invalid" && invalid.ids.join() === "a");
  checkDeep("blank and zero shares are not submitted", sleevesToSubmit([{ id: "a", share: "100" }, { id: "b", share: "" }, { id: "c", share: "0" }]), [{ id: "a", share: "100" }]);
  checkDeep("share fields are read back from the form", sharesFromForm([["share:inst-1", "40"], ["other", "x"], ["share:inst-2", "60"]]), [{ id: "inst-1", share: "40" }, { id: "inst-2", share: "60" }]);
  const rows = buildSleeveRows([{ id: "i1", name: "MADEUP1" }, { id: "i2", name: "MADEUP2" }], [{ id: "i1", share: "70" }, { id: "gone", share: "30" }]);
  checkDeep("holdings first, then a stored sleeve no longer held", rows.map((r) => `${r.id}:${r.share}:${r.held}`), ["i1:70:true", "i2::true", "gone:30:false"]);

  section("band: owner-entered, no default, 5/25 floor, audited store");
  const file = `tmp/allocation-settings-${newUuid()}.db`;
  const client = createClient({ url: `file:${file}` });
  const db = drizzle(client, { schema });
  await client.execute("PRAGMA foreign_keys=ON");
  const dir = "src/infra/db/migrations";
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of readFileSync(`${dir}/${name}`, "utf8").split("--> statement-breakpoint")) if (sql.trim()) await client.execute(sql);
  }
  const owner = UserId.from("band-owner");
  await client.execute({ sql: "INSERT INTO user(id,name,email) VALUES(?,?,?)", args: [owner.value, owner.value, "band-owner@example.test"] });
  const writer = new DrizzleRebalancingBandWriter(db, newRequestContext(owner.value, new FixedClock(new Date("2026-11-05T06:00:00Z")), { requestId: "band-request" }));
  const record = new RecordRebalancingBand(writer), remove = new RemoveRebalancingBand(writer), load = new LoadRebalancingBand(new DrizzleRebalancingBandReader(db));

  const none = await load.execute({ userId: owner });
  checkTrue("nothing stored loads null (no default band)", none.ok && none.value === null);
  for (const [label, absolute, relative] of [["exactly 5/25 refused", "5", "25"], ["absolute 5 refused", "5", "30"], ["relative 25 refused", "6", "25"], ["over 100 refused", "101", "30"]] as const) {
    const r = await record.execute({ userId: owner, absolute, relative });
    checkTrue(label, !r.ok && r.error.code === "VALIDATION_FAILED");
  }
  check("refusals wrote nothing", Number((await client.execute("SELECT count(*) AS n FROM rebalancing_bands")).rows[0].n), 0);
  checkTrue("a wider band is stored", (await record.execute({ userId: owner, absolute: "6", relative: "30" })).ok);
  checkTrue("re-recording replaces in place", (await record.execute({ userId: owner, absolute: "7.5", relative: "40" })).ok);
  const stored = await load.execute({ userId: owner });
  checkTrue("the replaced band loads", stored.ok && stored.value !== null && formatScaled(stored.value.absolute.scaled) === "7.5" && formatScaled(stored.value.relative.scaled) === "40");
  check("one row per user", Number((await client.execute("SELECT count(*) AS n FROM rebalancing_bands")).rows[0].n), 1);
  checkTrue("clearing tombstones it", (await remove.execute({ userId: owner })).ok);
  const cleared = await load.execute({ userId: owner });
  checkTrue("cleared loads null again", cleared.ok && cleared.value === null);
  client.close();

  section("links");
  checkTrue("the sidebar links /settings/allocation", NAV_ITEMS.some((item) => item.href === "/settings/allocation"));
  const view = readFileSync("app/(root)/signals/signals-view.tsx", "utf8");
  const unknownArm = view.slice(view.indexOf('case "unknown"'), view.indexOf('case "refused"'));
  checkTrue("the Signals UNKNOWN allocation state links to the settings screen", unknownArm.includes('href="/settings/allocation"'));
  const page = readFileSync("app/(root)/signals/page.tsx", "utf8");
  checkTrue("the signals page reads the stored band (no hard-coded null)", page.includes("rebalancingBand.load") && !page.includes("band: null"));
  done();
}

main();
