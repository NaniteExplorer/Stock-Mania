/**
 * Bar storage, proved twice.
 *
 * One assertion block, run against the in-memory double **and** against the real
 * libSQL store through the real migrations — the pattern
 * `providers-conformance.spec.ts` uses, and for the same reason: an interface
 * whose only implementation is the one the tests use is not an interface, and a
 * double that quietly permits what the database refuses lets a test pass against
 * behaviour production forbids.
 *
 * What the conformance block asserts is the contract Phase 8 needs: append-only,
 * bitemporal (a correction is a new row pointing at the old one), granularity as
 * an argument rather than a property of the store, and coverage so a backfill
 * resumes rather than restarting.
 */

import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { instruments, ledgerAccounts, users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { UserId } from "@/core/kernel";
import { Currency } from "@/core/money";
import { UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { makeBar, type Bar, type BarRepository } from "@/domain/analysis";
import { DrizzleBarRepository } from "@/infra/repositories";
import { InMemoryBarRepository } from "./doubles";
import { check, checkTrue, done, section, throwsAsync } from "./harness";

const DB_FILE = "./tmp/bars.spec.db";
const INSTRUMENT = "instrument-bars";
const price = (value: string) => UnitPrice.of(value, Currency.INR);
const on = (value: string) => CalendarDate.parse(value);

function bar(
  asOf: string,
  values: { open: string; high: string; low: string; close: string; volume?: bigint | null },
  options: { granularity?: "DAY" | "WEEK" | "MONTH"; ingestedAt?: string; providerId?: string } = {},
): Bar {
  return makeBar({
    instrumentId: INSTRUMENT,
    asOf: on(asOf),
    granularity: options.granularity ?? "DAY",
    open: price(values.open),
    high: price(values.high),
    low: price(values.low),
    close: price(values.close),
    // `?? ` would turn an explicit null into the default, which is the distinction
    // the "unpublished volume stays null" assertion is about.
    volume: values.volume === undefined ? 1_000_000n : values.volume,
    currency: Currency.INR,
    providerId: options.providerId ?? "nse",
    ingestedAt: new Date(options.ingestedAt ?? "2026-02-01T00:00:00Z"),
  });
}

/**
 * The contract, once. Both implementations answer it identically or one of them
 * is wrong.
 */
async function conformance(label: string, bars: BarRepository): Promise<void> {
  section(`${label}: the bar repository contract`);

  await bars.append([
    bar("2026-01-05", { open: "100", high: "104", low: "99", close: "103" }),
    bar("2026-01-06", { open: "103", high: "108", low: "102.5", close: "107" }),
    bar("2026-01-07", { open: "107", high: "107", low: "101", close: "102", volume: null }),
  ]);

  const week = await bars.findRange(INSTRUMENT, "DAY", DateRange.of(on("2026-01-01"), on("2026-01-31")));
  check(`${label}: three bars stored`, week.length, 3);
  check(`${label}: in date order`, week.map((row) => row.asOf.toISO()).join(","), "2026-01-05,2026-01-06,2026-01-07");
  check(`${label}: prices survive the round-trip exactly`, week[1].high.toDecimalString(), "108");
  check(`${label}: and a fractional low`, week[1].low.toDecimalString(), "102.5");
  check(`${label}: an unpublished volume stays null, not zero`, week[2].volume, null);
  check(`${label}: a published volume is a bigint count`, week[0].volume, 1000000n);
  check(`${label}: the currency comes back`, week[0].currency.code, "INR");

  const narrow = await bars.findRange(INSTRUMENT, "DAY", DateRange.of(on("2026-01-06"), on("2026-01-06")));
  check(`${label}: a range query is inclusive and narrow`, narrow.length, 1);

  section(`${label}: granularity routes the query, not the store`);

  await bars.append([
    bar("2026-01-01", { open: "100", high: "110", low: "95", close: "107" }, { granularity: "MONTH" }),
  ]);
  const monthly = await bars.findRange(INSTRUMENT, "MONTH", DateRange.of(on("2026-01-01"), on("2026-01-31")));
  check(`${label}: the month bar is found under MONTH`, monthly.length, 1);
  const daily = await bars.findRange(INSTRUMENT, "DAY", DateRange.of(on("2026-01-01"), on("2026-01-31")));
  check(`${label}: and does not leak into DAY`, daily.length, 3);

  const coverage = await bars.coverage(INSTRUMENT, "DAY");
  check(`${label}: coverage starts at the first bar`, coverage?.from.toISO(), "2026-01-05");
  check(`${label}: and ends at the last`, coverage?.through.toISO(), "2026-01-07");
  check(`${label}: with a count, so a gap is visible`, coverage?.count, 3);
  check(`${label}: an instrument with no bars has no coverage`, await bars.coverage("nobody", "DAY"), null);

  section(`${label}: a correction is a new row, not an overwrite`);

  /*
   * The bitemporal rule. A vendor restating Tuesday's high does not erase what we
   * believed on Tuesday — it adds a row and points the old one at it, so a
   * backtest can still ask what was known on the day rather than what is known
   * now.
   */
  await bars.append([
    bar(
      "2026-01-06",
      { open: "103", high: "109", low: "102.5", close: "107" },
      { ingestedAt: "2026-02-05T00:00:00Z", providerId: "nse-restated" },
    ),
  ]);
  const bothBeliefs = await bars.findRange(INSTRUMENT, "DAY", DateRange.of(on("2026-01-06"), on("2026-01-06")));
  check(`${label}: both beliefs are kept`, bothBeliefs.length, 2);
  checkTrue(
    `${label}: and they differ, which is the point`,
    bothBeliefs[0].high.toDecimalString() !== bothBeliefs[1].high.toDecimalString(),
  );

  section(`${label}: an impossible bar is refused`);

  await throwsAsync(
    `${label}: a high below the low never reaches the store`,
    () =>
      bars.append([
        {
          instrumentId: INSTRUMENT,
          asOf: on("2026-01-08"),
          granularity: "DAY",
          open: price("100"),
          high: price("99"),
          low: price("101"),
          close: price("100"),
          volume: null,
          currency: Currency.INR,
          providerId: "nse",
          ingestedAt: new Date("2026-02-01T00:00:00Z"),
        },
      ]),
    "is not a bar",
  );
  const afterRefusal = await bars.findRange(INSTRUMENT, "DAY", DateRange.of(on("2026-01-08"), on("2026-01-08")));
  check(`${label}: and nothing was written`, afterRefusal.length, 0);
}

async function main() {
  await conformance("in-memory", new InMemoryBarRepository());

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

  const userId = UserId.from("user_bars_1");
  const now = new Date("2026-02-01T00:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "bars@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(ledgerAccounts).values({
    id: "account-bars",
    userId: userId.value,
    code: "Assets:Investments:Bars",
    name: "Bars",
    type: "ASSET",
    subtype: "BROKERAGE",
    currency: "INR",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(instruments).values({
    id: INSTRUMENT,
    userId: userId.value,
    symbol: "BARS",
    name: "Bar Test",
    kind: "EQUITY",
    instrumentClass: "LISTED_EQUITY",
    taxAssetClass: "LISTED_EQUITY",
    currency: "INR",
    assetAccountId: "account-bars",
    createdAt: now,
    updatedAt: now,
  });

  await conformance("libSQL", new DrizzleBarRepository(db));

  section("the database refuses an impossible bar even without the domain guard");

  /*
   * Belt and braces, deliberately. `makeBar` gives a readable message; the check
   * constraint is the guarantee — it holds against a raw insert, a future
   * importer, or a migration script that never imports the domain at all.
   */
  let rejected = "no";
  try {
    await client.execute(
      `insert into price_bars (id, instrument_id, granularity, as_of, open_scaled, high_scaled, ` +
        `low_scaled, close_scaled, volume, currency, provider_id, ingested_at) values ` +
        `('raw-1', '${INSTRUMENT}', 'DAY', '2026-03-01', 10000000000, 9900000000, 10100000000, ` +
        `10000000000, 0, 'INR', 'raw', 1)`,
    );
  } catch {
    rejected = "yes";
  }
  check("a raw insert with high < low is rejected by the constraint", rejected, "yes");

  let negativeVolume = "no";
  try {
    await client.execute(
      `insert into price_bars (id, instrument_id, granularity, as_of, open_scaled, high_scaled, ` +
        `low_scaled, close_scaled, volume, currency, provider_id, ingested_at) values ` +
        `('raw-2', '${INSTRUMENT}', 'DAY', '2026-03-02', 10000000000, 10100000000, 9900000000, ` +
        `10000000000, -5, 'INR', 'raw', 1)`,
    );
  } catch {
    negativeVolume = "yes";
  }
  check("and a negative volume", negativeVolume, "yes");

  const superseded = await db.select().from(schema.priceBars).limit(1);
  const repository = new DrizzleBarRepository(db);
  await repository.supersede(superseded[0].id, "some-later-bar");
  const remaining = await repository.findRange(
    INSTRUMENT,
    "DAY",
    DateRange.of(on("2026-01-01"), on("2026-01-31")),
  );
  checkTrue(
    "a superseded bar drops out of the current view but stays in the table",
    remaining.every((row) => row.asOf.toISO() !== superseded[0].asOf) ||
      remaining.length < 4,
  );
  const allRows = await db.select().from(schema.priceBars);
  checkTrue("nothing was deleted", allRows.length >= 5);

  done();
}

void main();
