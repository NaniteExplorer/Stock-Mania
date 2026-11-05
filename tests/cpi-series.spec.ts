/**
 * CPI series (net-worth-age-chart.md § "CPI series"): exact domain parsing and
 * deflation with explicit refusals, the class-B store with audited writes, and
 * the chart model fed from stored points. Made-up index figures.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { FixedClock, UserId, newUuid } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { LoadCpiSeries, RecordCpiPoint, RemoveCpiPoint } from "@/app/cpi-series.usecases";
import { cpiPoint, deflate, formatCpiIndex, parseCpiIndex, validateCpiSeries } from "@/domain/cpi-series";
import { MUTATION_CLASSES, allows } from "@/domain/mutation-classes";
import * as schema from "@/infra/db/schema";
import { DrizzleCpiSeriesReader, DrizzleCpiSeriesWriter } from "@/infra/cpi-series-store";
import { newRequestContext } from "@/infra/unit-of-work";
import { buildNetWorthAgeView } from "../app/(root)/dashboard/net-worth-age-model";
import { check, checkDeep, checkTrue, done, section, throws, throwsAsync } from "./harness";

const file = `tmp/cpi-series-${newUuid()}.db`;
const client = createClient({ url: `file:${file}` });
const db = drizzle(client, { schema });
const owner = UserId.from("cpi-owner"), other = UserId.from("cpi-other");
const clock = new FixedClock(new Date("2026-11-04T06:00:00Z"));
const count = async (sql: string) => Number((await client.execute(sql)).rows[0].n);
const rupees = (minor: bigint) => Money.fromMinor(minor);
const monthEnd = (month: string, netWorth: Money) => ({ month, on: CalendarDate.parse(`${month}-01`).endOfMonth(), netWorth });
const p = (month: string, index: string, base = month < "2026-01" ? "2012" : "2024") => cpiPoint({ month, base, index, source: "Test fixture" });

async function main() {
  section("domain: exact parsing");
  check("193.4 scales by 10 000", parseCpiIndex("193.4"), 1_934_000n);
  check("four places allowed", parseCpiIndex("100.1234"), 1_001_234n);
  check("round trip drops trailing zeros", formatCpiIndex(1_934_000n), "193.4");
  check("whole number formats bare", formatCpiIndex(1_000_000n), "100");
  throws("five places refused", () => parseCpiIndex("100.12345"), "at most");
  throws("zero refused", () => parseCpiIndex("0"), "greater than zero");
  throws("negative refused", () => parseCpiIndex("-1"), "positive");
  throws("exponent refused", () => parseCpiIndex("1e2"), "positive");
  throws("bad month refused", () => p("2025-13", "100"), "yyyy-mm");
  throws("2024 base before the break refused", () => cpiPoint({ month: "2025-12", base: "2024", index: "100", source: "x" }), "2012 base");
  throws("2012 base after the break refused", () => cpiPoint({ month: "2026-02", base: "2012", index: "100", source: "x" }), "2024 base");
  throws("empty source refused", () => cpiPoint({ month: "2025-01", base: "2012", index: "100", source: "  " }), "source");
  checkDeep("duplicate month reported", validateCpiSeries([p("2025-01", "190"), p("2025-01", "191")]), ["2025-01 is recorded twice."]);

  section("domain: deflate");
  const series = [p("2025-01", "190"), p("2025-06", "200"), p("2026-01", "101.5"), p("2026-03", "103")];
  const moved = deflate(rupees(1_000_000n), "2025-01", "2025-06", series);
  check("₹10 000 of Jan 2025 in Jun 2025 rupees = ×200/190, HALF_UP", moved.ok ? moved.value.minor : null, 1_052_632n);
  const back = deflate(rupees(1_000_000n), "2025-06", "2025-01", series);
  check("and back the other way", back.ok ? back.value.minor : null, 950_000n);
  const same = deflate(rupees(123_457n), "2026-01", "2026-01", series);
  check("same month is identity", same.ok ? same.value.minor : null, 123_457n);
  const huge = deflate(rupees(9_000_000_000_000_000_001n), "2026-01", "2026-03", series);
  check("beyond 2^53 stays exact", huge.ok ? huge.value.minor : null, (9_000_000_000_000_000_001n * 1_030_000n * 2n + 1_015_000n) / (1_015_000n * 2n));
  const gap = deflate(rupees(100n), "2025-03", "2025-06", series);
  checkTrue("missing month refused, not interpolated", !gap.ok && gap.reason.includes("2025-03") && gap.reason.includes("never interpolated"));
  const cross = deflate(rupees(100n), "2025-06", "2026-01", series);
  checkTrue("across the base break refused", !cross.ok && cross.reason.includes("not comparable"));
  const invalid = deflate(rupees(100n), "2025-01", "2025-06", [...series, p("2025-01", "1")]);
  checkTrue("invalid series refused", !invalid.ok && invalid.reason.includes("twice"));

  section("mutation class");
  check("cpi_series is class B", MUTATION_CLASSES.cpi_series.class, "B");
  checkTrue("owner may update and tombstone, never post", allows("cpi_series", "update") && allows("cpi_series", "tombstone") && !allows("cpi_series", "post"));

  section("store: audited, user-scoped, tombstoned");
  await client.execute("PRAGMA foreign_keys=ON");
  const dir = "src/infra/db/migrations";
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${dir}/${name}`, "utf8").split("--> statement-breakpoint")) if (statement.trim()) await client.execute(statement);
  }
  for (const user of [owner, other]) await client.execute({ sql: "INSERT INTO user(id,name,email) VALUES(?,?,?)", args: [user.value, user.value, `${user.value}@example.test`] });
  const reader = new DrizzleCpiSeriesReader(db);
  const writer = new DrizzleCpiSeriesWriter(db, newRequestContext(owner.value, clock, { requestId: "cpi-request" }));
  const record = new RecordCpiPoint(writer), remove = new RemoveCpiPoint(writer), load = new LoadCpiSeries(reader);

  check("empty series loads empty", (await load.execute({ userId: owner })).ok, true);
  for (const [month, index] of [["2025-06", "200"], ["2025-01", "190"], ["2025-07", "201.3"]] as const) {
    const result = await record.execute({ userId: owner, month, base: "2012", index, source: "MoSPI release (fixture)" });
    check(`recorded ${month}`, result.ok, true);
  }
  const bad = await record.execute({ userId: owner, month: "2026-02", base: "2012", index: "100", source: "x" });
  checkTrue("wrong base is a validation error, nothing written", !bad.ok && bad.error.code === "VALIDATION_FAILED");
  const loaded = await load.execute({ userId: owner });
  checkDeep("loaded in month order, exact", loaded.ok ? loaded.value.map((x) => `${x.month}:${x.indexScaled}`) : [], ["2025-01:1900000", "2025-06:2000000", "2025-07:2013000"]);
  check("stored as integer", (await client.execute("SELECT typeof(index_scaled) AS t FROM cpi_series LIMIT 1")).rows[0].t, "integer");

  await record.execute({ userId: owner, month: "2025-07", base: "2012", index: "201.4", source: "Corrected" });
  check("re-recording a month updates the one row", await count("SELECT count(*) AS n FROM cpi_series WHERE month = '2025-07'"), 1);
  check("…to the new value", (await client.execute("SELECT index_scaled AS v FROM cpi_series WHERE month = '2025-07'")).rows[0].v, 2014000);

  check("remove succeeds", (await remove.execute({ userId: owner, month: "2025-07" })).ok, true);
  check("removed month is a tombstone, not a delete", await count("SELECT count(*) AS n FROM cpi_series WHERE month = '2025-07' AND deleted_at IS NOT NULL"), 1);
  check("reads skip the tombstone", (await reader.list(owner)).length, 2);
  check("removing it again is refused", (await remove.execute({ userId: owner, month: "2025-07" })).ok, false);
  await record.execute({ userId: owner, month: "2025-07", base: "2012", index: "201.4", source: "Restored" });
  check("recording again restores it", (await reader.list(owner)).length, 3);

  checkDeep(
    "every write audited: create×3, update, soft delete, restore",
    (await client.execute("SELECT action FROM audit_events WHERE entity_type = 'cpi_series' ORDER BY rowid")).rows.map((r) => r.action),
    ["CREATE", "CREATE", "CREATE", "UPDATE", "SOFT_DELETE", "RESTORE"],
  );
  check("and a ledger event each", await count("SELECT count(*) AS n FROM ledger_events WHERE aggregate_type = 'cpi_series'"), 6);
  check("another owner sees nothing", (await reader.list(other)).length, 0);
  await throwsAsync("a writer cannot record for someone else", () => writer.record(other, p("2025-01", "190")), "owner");
  let rejected = false;
  try { await client.execute("INSERT INTO cpi_series(id,user_id,month,base,index_scaled,source) VALUES('x','cpi-owner','2026-02','2012',100,'s')"); } catch { rejected = true; }
  checkTrue("database CHECK refuses a base that does not match the month", rejected);

  section("chart: stored series drives real mode; gaps refuse");
  const history = ["2025-01", "2025-06", "2025-07"].map((month) => monthEnd(month, rupees(10_000_000n)));
  const stored = await reader.list(owner);
  const cpi = { months: stored.map((x) => ({ month: x.month, base: x.base, index: formatCpiIndex(x.indexScaled) })), linking: null };
  const today = CalendarDate.parse("2025-07-31");
  const real = buildNetWorthAgeView({ history, expenses: [], bornOn: null, today, cpi, requested: "real" });
  checkTrue("real is drawn when every month is covered", "basis" in real && real.basis === "real" && real.realRefusal === null);
  const holey = buildNetWorthAgeView({ history: [...history.slice(0, 1), monthEnd("2025-03", rupees(1n)), ...history.slice(1)], expenses: [], bornOn: null, today, cpi, requested: "real" });
  checkTrue("a missing CPI month falls back to nominal with a reason", "basis" in holey && holey.basis === "nominal" && (holey.realRefusal ?? "").includes("Mar 2025"));
  const none = buildNetWorthAgeView({ history, expenses: [], bornOn: null, today, cpi: null, requested: "real" });
  checkTrue("no series at all: nominal only", "basis" in none && none.basis === "nominal");

  client.close();
  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
