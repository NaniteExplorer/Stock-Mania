/**
 * Pricing, against a real database.
 *
 * What only a database can prove:
 *
 *   - **Two providers can disagree on one date and both rows survive.** That is
 *     1e's stated gate for the bitemporal schema, and it is a claim about a unique
 *     index, not about a class.
 *   - **A vendor correction inserts and points back**, so the earlier belief is
 *     still readable — the property that makes a filed tax report reproducible.
 *   - **A backfill resumes**, because `coverage()` is a `MIN`/`MAX` over stored
 *     rows rather than something the caller remembers.
 *
 * The providers are fixtures, so this test needs no network — only SQLite.
 */

import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { instruments, ledgerAccounts, users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { FxBook, InstrumentRef, PriceBook } from "@/domain/pricing";
import { DrizzleFxRateRepository, DrizzleQuoteRepository } from "@/infra/repositories";
import { EcbFxProvider, MfApiNavProvider, YahooQuoteProvider } from "@/infra/providers";
import { AssertFxRate, BackfillInstrumentHistory, RefreshPrices } from "@/app/pricing.usecases";
import { FixtureHttpClient, VirtualRuntime, ecbBody, mfapiBody, yahooBody } from "./doubles";
import { check, checkTrue, done } from "./harness";

const DB_FILE = "./tmp/pricing.db";
const INR = Currency.reporting;
const USD = Currency.of("USD");
const on = (value: string) => CalendarDate.parse(value);

async function main() {
  for (const suffix of ["", "-shm", "-wal"]) {
    try { rmSync(DB_FILE + suffix); } catch { /* not there */ }
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
  console.log("migrations applied\n");

  const userId = UserId.from("user_pricing_int");
  const now = new Date("2026-08-24T04:00:00Z");
  await db.insert(users).values({
    id: userId.value, name: "Test", email: "pricing@example.com",
    emailVerified: true, createdAt: now, updatedAt: now,
  });
  await db.insert(ledgerAccounts).values({
    id: "acct_broker", userId: userId.value, code: "Assets:Broker", name: "Broker",
    type: "ASSET", subtype: "BROKERAGE", currency: "INR",
  });
  await db.insert(instruments).values([
    {
      id: "FUND", userId: userId.value, symbol: "TESTFUND", name: "Test Flexi Cap",
      kind: "MUTUAL_FUND", taxAssetClass: "EQUITY_MUTUAL_FUND", assetAccountId: "acct_broker",
    },
    {
      id: "INFY", userId: userId.value, symbol: "INFY", name: "Infosys",
      kind: "EQUITY", taxAssetClass: "LISTED_EQUITY", exchange: "XNSE", assetAccountId: "acct_broker",
    },
  ]);

  const clock = new FixedClock(now);
  const quotes = new DrizzleQuoteRepository(db);
  const fxRepo = new DrizzleFxRateRepository(db);

  const fund: InstrumentRef = {
    instrumentId: "FUND", symbol: "TESTFUND", assetClass: "MUTUAL_FUND",
    currency: INR, identifierType: "SCHEME_CODE", providerRefs: { mfapi: "120503" },
  };
  const infy: InstrumentRef = {
    instrumentId: "INFY", symbol: "INFY", assetClass: "EQUITY",
    currency: INR, identifierType: "TICKER", providerRefs: { yahoo: "INFY.NS" },
  };

  /* ── Bitemporality: two providers, one date, both rows ─────────────── */

  console.log("-- two providers disagree on one date, and both rows survive --");
  // NSE says 1543.25, Yahoo says 1600.00 for 21 August. 56.75 / 1543.25 = 3.6773%,
  // so this is a recorded divergence, not a rounding difference.
  await quotes.append([
    {
      instrumentId: "INFY", asOf: on("2026-08-21"), quoteType: "CLOSE",
      price: UnitPrice.of("1543.25"), providerId: "nse", sourceType: "PROVIDER",
      ingestedAt: new Date("2026-08-21T12:00:00Z"),
    },
    {
      instrumentId: "INFY", asOf: on("2026-08-21"), quoteType: "CLOSE",
      price: UnitPrice.of("1600.00"), providerId: "yahoo", sourceType: "PROVIDER",
      ingestedAt: new Date("2026-08-21T12:05:00Z"),
    },
  ]);

  const bothRows = await quotes.findLatestOnOrBefore("INFY", "CLOSE", on("2026-08-21"), 10);
  check("both providers' rows are stored for the same date", bothRows.length, 2);
  check(
    "...and are distinguishable",
    [...bothRows].map((row) => row.providerId).sort().join(","),
    "nse,yahoo",
  );

  // Priority decides which one is used. NSE first: the exchange beats a scraped
  // internal endpoint.
  const priced = new PriceBook([{ id: "nse" } as never, { id: "yahoo" } as never], quotes);
  const resolution = await priced.priceOn(infy, on("2026-08-21"));
  check("the higher-priority provider is the golden record", resolution.providerId, "nse");
  check("...and its price is what the app shows", resolution.price?.toDecimalString(), "1543.25");

  /* ── A vendor correction inserts, and never overwrites ─────────────── */

  console.log("\n-- a correction is a new row; the old belief stays readable --");
  await quotes.append([
    {
      instrumentId: "INFY", asOf: on("2026-08-21"), quoteType: "CLOSE",
      // NSE restates the close two days later.
      price: UnitPrice.of("1547.80"), providerId: "nse", sourceType: "PROVIDER",
      ingestedAt: new Date("2026-08-23T09:00:00Z"),
    },
  ]);

  const afterCorrection = await quotes.findLatestOnOrBefore("INFY", "CLOSE", on("2026-08-21"), 10);
  check("the correction is a third row, not an overwrite", afterCorrection.length, 3);
  const nseRows = afterCorrection.filter((row) => row.providerId === "nse");
  check("both NSE beliefs survive", nseRows.length, 2);
  check(
    "newest belief first, which is the order the ladder walks",
    nseRows[0].price.toDecimalString(),
    "1547.8",
  );
  check("...and the original is still there", nseRows[1].price.toDecimalString(), "1543.25");
  const corrected = await priced.priceOn(infy, on("2026-08-21"));
  check("today the app uses the corrected price", corrected.price?.toDecimalString(), "1547.8");
  // This is the whole point of the second time axis: what we believed on 22 August,
  // using only what we knew then, is still answerable.
  const believedThen = afterCorrection.filter(
    (row) => row.providerId === "nse" && row.ingestedAt < new Date("2026-08-22T00:00:00Z"),
  );
  check("what we believed on 22 August is still answerable", believedThen[0].price.toDecimalString(), "1543.25");

  /* ── Backfill on add, and resumption ──────────────────────────────── */

  console.log("\n-- backfill on add: history predating signup, and resumable --");
  const navRows = [
    // Deliberately spanning years, so "predates signup" is a real claim.
    { date: "01-04-2019", nav: "31.4500" },
    { date: "01-04-2020", nav: "24.8800" },
    { date: "01-04-2021", nav: "42.1700" },
    { date: "01-04-2022", nav: "51.0300" },
    { date: "01-04-2023", nav: "58.9100" },
    { date: "01-04-2024", nav: "70.2200" },
    { date: "03-04-2025", nav: "78.4400" },
    { date: "21-08-2026", nav: "84.5612" },
  ];
  const http = new FixtureHttpClient([
    { match: "api.mfapi.in", body: mfapiBody(navRows) },
    { match: "query2.finance.yahoo.com", body: yahooBody([{ date: "2026-08-21", close: 1543.25 }]) },
    {
      match: "eurofxref",
      body: ecbBody([{ date: "2026-08-21", rates: { USD: 1.09, INR: 91.56 } }]),
    },
  ]);
  const runtime = new VirtualRuntime(http, { startMillis: now.getTime() });
  const prices = new PriceBook([new MfApiNavProvider(runtime), new YahooQuoteProvider(runtime)], quotes);
  const backfill = new BackfillInstrumentHistory(prices, quotes, clock);

  const first = await backfill.execute({ instrument: fund });
  check("the backfill succeeded", first.ok, true);
  check("...and stored the whole history", first.ok && first.value.persisted, navRows.length);

  const coverage = await quotes.coverage("FUND", "NAV");
  check("coverage starts in 2019", coverage?.from.toISO(), "2019-04-01");
  check("...and runs to the latest NAV", coverage?.through.toISO(), "2026-08-21");

  // The gate: a valuation for a date years before the user signed up.
  const beforeSignup = await prices.priceOn(fund, on("2021-04-01"), "NAV");
  check("a price predating signup resolves exactly", beforeSignup.rung, "EXACT");
  check("...at the published NAV", beforeSignup.price?.toDecimalString(), "42.17");
  // 1,000 units at ₹42.17 = ₹42,170.00 — the value XIRR needs for that date.
  const valued = await prices.valueOn(fund, Quantity.fromString("1000"), on("2021-04-01"), "NAV");
  check("...and values a holding on that date", valued.value?.toDecimalString(), "42170.00");
  checkTrue(
    "so a return over a period predating signup is computable",
    (await prices.priceOn(fund, on("2019-04-01"), "NAV")).price !== null,
  );

  // Resuming: the second run asks only for the days after what is stored, which is
  // 22–24 August — and the fund has published no NAV in that window, so it stores
  // nothing. Nothing stored is the *correct* outcome here, and it is distinguished
  // from failure by the provider having answered.
  const requestsBefore = http.requests.length;
  const second = await backfill.execute({ instrument: fund });
  check("a second backfill asks only for the tail", second.ok && second.value.range?.start.toISO(), "2026-08-22");
  check("...stores nothing, because there is nothing new", second.ok && second.value.persisted, 0);
  check("...and makes one request, not twenty years of them", http.requests.length - requestsBefore, 1);
  check("...and is a success, not a failure", second.ok, true);

  // Once coverage reaches today, the backfill skips entirely and says why.
  await quotes.append([
    {
      instrumentId: "FUND", asOf: on("2026-08-24"), quoteType: "NAV",
      price: UnitPrice.of("84.9000"), providerId: "mfapi", sourceType: "PROVIDER",
      ingestedAt: new Date("2026-08-24T02:00:00Z"),
    },
  ]);
  const requestsBeforeSkip = http.requests.length;
  const covered = await backfill.execute({ instrument: fund, years: 1 });
  check(
    "a covered range is skipped, and says so",
    covered.ok && (covered.value.skippedReason ?? "").startsWith("Already have"),
    true,
  );
  check("...without touching a provider at all", http.requests.length - requestsBeforeSkip, 0);

  // `force` overrides the resumption, for when a vendor has restated history.
  const forced = await backfill.execute({ instrument: fund, force: true });
  check("force re-fetches regardless of coverage", forced.ok && forced.value.range !== null, true);

  /* ── Q01 is also a database constraint ────────────────────────────── */

  console.log("\n-- a non-positive price is refused by the database too --");
  let dbRejected = "accepted";
  try {
    await db.insert(schema.priceQuotes).values({
      id: "bad", instrumentId: "INFY", asOf: "2026-08-21", quoteType: "CLOSE",
      priceScaled: 0, currency: "INR", providerId: "yahoo", sourceType: "PROVIDER",
      ingestedAt: new Date("2026-08-21T12:00:00Z"),
    });
  } catch (error) {
    dbRejected = /constraint/i.test(String((error as Error).message) + String((error as { cause?: Error }).cause?.message))
      ? "rejected"
      : String((error as Error).message);
  }
  check("Q01 holds in the schema, not only in the validator", dbRejected, "rejected");

  /* ── FX: the provider rate, and the user's own ────────────────────── */

  console.log("\n-- FX rates: the provider's, and the one the user actually got --");
  const fx = new FxBook([new EcbFxProvider(runtime)], fxRepo, clock);
  const ecbRates = await new EcbFxProvider(runtime).fetchRates({
    base: "USD",
    quotes: ["INR"],
    range: DateRange.of(on("2026-08-17"), on("2026-08-21")),
  });
  check("the ECB feed parsed", ecbRates.ok, true);
  if (ecbRates.ok) await fxRepo.append(ecbRates.value);

  // 91.56 ÷ 1.09 = 84.00.
  const providerRate = await fx.rateOn("USD", "INR", on("2026-08-21"));
  check("the derived provider rate", providerRate.rate?.toDecimalString(), "84");
  check("...recorded as derived", providerRate.sourceType, "DERIVED");

  const assert = new AssertFxRate(fx);
  const asserted = await assert.execute({
    userId, base: "USD", quote: "INR", asOf: on("2026-08-21"), rate: Quantity.fromString("84.40"),
  });
  check("the user's rate is recorded", asserted.ok, true);

  const forUser = await fx.rateOn("USD", "INR", on("2026-08-21"), userId);
  check("the user's rate wins for that user", forUser.rate?.toDecimalString(), "84.4");
  check("...and is marked as theirs", forUser.userAsserted, true);
  const forEveryoneElse = await fx.rateOn("USD", "INR", on("2026-08-21"));
  check("everyone else still sees the provider's", forEveryoneElse.rate?.toDecimalString(), "84");

  // $1,100 at the user's 84.40 = ₹92,840.00 — the number their return is assessed on.
  const converted = await fx.convert(Money.fromRupees("1100", USD), INR, on("2026-08-21"), userId);
  check("conversion for tax uses the asserted rate", converted.ok && converted.value.amount.toDecimalString(), "92840.00");
  const zeroRate = await assert.execute({
    userId, base: "USD", quote: "INR", asOf: on("2026-08-21"), rate: Quantity.ZERO,
  });
  check("a zero rate is refused", !zeroRate.ok, true);

  /* ── The scheduled refresh ────────────────────────────────────────── */

  console.log("\n-- the scheduled refresh groups by quote type --");
  const refresh = new RefreshPrices(prices, clock);
  const refreshed = await refresh.execute({ instruments: [fund, infy] });
  check("the refresh ran", refreshed.ok, true);
  check(
    "a fund asks for a NAV and an equity for a close, separately",
    refreshed.ok && refreshed.value.reports.length,
    2,
  );
  check("both were priced", refreshed.ok && refreshed.value.persisted >= 2, true);

  client.close();
  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
