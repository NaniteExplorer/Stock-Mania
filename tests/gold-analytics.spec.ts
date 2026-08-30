/**
 * Where the gold profit came from — the split, end to end.
 *
 * The claim under test is the one the screen makes: **lease profit plus price
 * profit is the total profit, exactly, and a sale moves all three.** It is easy
 * to state and easy to get wrong, because the lease grams arrive as an ordinary
 * lot and stop looking like lease grams the moment they land.
 *
 * Run against a real libSQL file through the real migrations, so the lot rows,
 * the trade rows and the quote ladder are the ones the app actually reads.
 */

import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { InstrumentId, type PriceLookup } from "@/domain/instruments";
import { OpenAccount, SeedChartOfAccounts } from "@/app/ledger.usecases";
import { AddInstrument, RecordBuy, RecordSell } from "@/app/investing.usecases";
import { UpdateInstrument } from "@/app/instrument-admin.usecases";
import { AccrueLeaseInterest, OpenGoldLease } from "@/app/leasing.usecases";
import { RegisterInstitution, UpdateInstitution } from "@/app/institutions.usecases";
import { GoldHoldingAnalytics } from "@/app/gold-analytics.usecases";
import {
  DrizzleAccountRepository,
  DrizzleGoldLeaseRepository,
  DrizzleInstitutionRepository,
  DrizzleInstrumentRepository,
  DrizzleLotRepository,
  DrizzleQuoteRepository,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/gold-analytics.spec.db";
const on = (value: string) => CalendarDate.parse(value);
const grams = (value: string) => Quantity.fromString(value);
const rupees = (value: string) => Money.fromRupees(value, Currency.INR);

class ScriptedPrices implements PriceLookup {
  constructor(private readonly byDate: Record<string, string | null>) {}

  async priceOn(_ref: Parameters<PriceLookup["priceOn"]>[0], asOf: CalendarDate) {
    const value = this.byDate[asOf.toISO()] ?? null;
    return {
      price: value === null ? null : UnitPrice.of(value, Currency.INR),
      pricedOn: value === null ? null : asOf,
      isStale: false,
      rung: value === null ? "UNAVAILABLE" : "EXACT",
    };
  }
}

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

  const userId = UserId.from("user_gold_analytics_1");
  const now = new Date("2026-08-30T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "gold-analytics@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const accounts = new DrizzleAccountRepository(db);
  const journal = new DrizzleTransactionRepository(db);
  const instruments = new DrizzleInstrumentRepository(db);
  const lots = new DrizzleLotRepository(db);
  const leaseRepo = new DrizzleGoldLeaseRepository(db);
  const quotes = new DrizzleQuoteRepository(db);
  const platforms = new DrizzleInstitutionRepository(db);
  const clock = new FixedClock(now);

  await new SeedChartOfAccounts(accounts).execute({ userId });
  const openAccount = new OpenAccount(accounts, journal, clock);

  const bank = await openAccount.execute({
    userId,
    name: "Savings",
    type: "ASSET",
    subtype: "SAVINGS",
    openingBalance: rupees("500000"),
    openingBalanceOn: on("2025-01-01"),
  });
  if (!bank.ok) throw new Error(bank.error.message);

  const added = await new AddInstrument(accounts, instruments, openAccount, platforms).execute({
    userId,
    symbol: "SGOLD",
    name: "SafeGold 24k",
    kind: "DIGITAL_GOLD",
  });
  if (!added.ok) throw new Error(added.error.message);
  const goldId: InstrumentId = added.value.instrumentId;

  // 10g at ₹10,000/g plus ₹300 of GST and charges — the tax-inclusive cost.
  const bought = await new RecordBuy(accounts, instruments, journal, lots).execute({
    userId,
    instrumentId: goldId,
    fromAccountId: bank.value.accountId,
    quantity: grams("10"),
    pricePerUnit: rupees("10000"),
    charges: rupees("300"),
    tradedOn: on("2025-01-15"),
  });
  if (!bought.ok) throw new Error(bought.error.message);

  const analytics = new GoldHoldingAnalytics(instruments, lots, leaseRepo, quotes, platforms);

  section("without a price nothing is invented");

  const unpriced = await analytics.execute({ userId, instrumentId: goldId, asOf: on("2026-08-30") });
  checkTrue("the analytics load", unpriced.ok);
  if (!unpriced.ok) return;
  check("no market value", unpriced.value.marketValue, null);
  check("and no profit — not zero", unpriced.value.totalProfit, null);
  checkTrue("with a reason given", (unpriced.value.unpricedReason ?? "").includes("SGOLD"));
  check(
    "the tax-inclusive cost is what was actually paid",
    unpriced.value.investedCost.toDecimalString(),
    "100300.00",
  );
  check(
    "so a gram cost more than its price",
    unpriced.value.effectiveCostPerGram?.toDecimalString(),
    "10030",
  );

  section("the split over cash paid");

  await quotes.append([
    {
      instrumentId: goldId.value,
      asOf: on("2025-01-31"),
      quoteType: "CLOSE",
      price: UnitPrice.of("10100", Currency.INR),
      providerId: "test",
      sourceType: "MANUAL",
      ingestedAt: now,
    },
    {
      instrumentId: goldId.value,
      asOf: on("2026-08-30"),
      quoteType: "CLOSE",
      price: UnitPrice.of("12000", Currency.INR),
      providerId: "test",
      sourceType: "MANUAL",
      ingestedAt: now,
    },
  ]);

  const priced = await analytics.execute({ userId, instrumentId: goldId, asOf: on("2026-08-30") });
  if (!priced.ok) return;
  check("10g at ₹12,000", priced.value.marketValue?.toDecimalString(), "120000.00");
  check("no lease grams yet", priced.value.leaseGrams.toDecimalString(), "0");
  check("so all the profit is the price", priced.value.priceProfit?.toDecimalString(), "19700.00");
  check("and the lease made none", priced.value.leaseProfit?.toDecimalString(), "0.00");
  check("total is the sum", priced.value.totalProfit?.toDecimalString(), "19700.00");

  section("lease grams are free grams, and all of their value is profit");

  const opened = await new OpenGoldLease(instruments, leaseRepo, lots).execute({
    userId,
    instrumentId: goldId,
    platform: "SafeGold",
    quantity: grams("10"),
    startOn: on("2025-02-01"),
    closesOn: on("2027-02-01"),
    annualRate: Percentage.of("12"),
  });
  if (!opened.ok) throw new Error(opened.error.message);
  const lease = (await leaseRepo.findByReference(userId, opened.value.reference))!;

  const accrued = await new AccrueLeaseInterest(
    accounts,
    instruments,
    leaseRepo,
    journal,
    lots,
    new ScriptedPrices({ "2026-02-01": "11000" }),
  ).execute({ userId, leaseId: lease.id, asOf: on("2026-02-01") });
  checkTrue("the accrual booked grams", accrued.ok);
  if (!accrued.ok) return;
  // 10g × 12% × 12/12 = 1.2g gross, less 10% TDS = 1.08g net into the holding.
  check("net grams credited", accrued.value.postedGrams.toDecimalString(), "1.08");

  const withLease = await analytics.execute({ userId, instrumentId: goldId, asOf: on("2026-08-30") });
  if (!withLease.ok) return;
  check("the holding grew", withLease.value.totalGrams.toDecimalString(), "11.08");
  check("of which bought", withLease.value.purchasedGrams.toDecimalString(), "10");
  check("and credited by the lease", withLease.value.leaseGrams.toDecimalString(), "1.08");
  check("lease profit is the whole value of those grams", withLease.value.leaseProfit?.toDecimalString(), "12960.00");
  check("price profit is unchanged", withLease.value.priceProfit?.toDecimalString(), "19700.00");
  check("and the two add to the total", withLease.value.totalProfit?.toDecimalString(), "32660.00");
  check(
    "which is market value less cash paid",
    withLease.value.marketValue?.minus(withLease.value.investedCost).toDecimalString(),
    "32660.00",
  );
  checkTrue(
    "the lease lots reconcile with what the leases say they credited",
    withLease.value.leaseGramsReconcile === null,
  );
  check(
    "the book figure is the accounting one, and is smaller",
    withLease.value.unrealisedAgainstBook?.toDecimalString(),
    "20780.00",
  );

  section("selling gold adjusts every figure without a special case");

  const sold = await new RecordSell(accounts, instruments, journal, lots).execute({
    userId,
    instrumentId: goldId,
    toAccountId: bank.value.accountId,
    quantity: grams("5"),
    pricePerUnit: rupees("12000"),
    tradedOn: on("2026-08-20"),
  });
  if (!sold.ok) throw new Error(sold.error.message);

  const afterSale = await analytics.execute({ userId, instrumentId: goldId, asOf: on("2026-08-30") });
  if (!afterSale.ok) return;
  check("half the gold is gone", afterSale.value.totalGrams.toDecimalString(), "6.08");
  check(
    "FIFO took it from the bought lot, so the lease grams survive",
    afterSale.value.leaseGrams.toDecimalString(),
    "1.08",
  );
  check("and none of the lease grams left", afterSale.value.leaseGramsDisposed.toDecimalString(), "0");
  check(
    "the cost carried is only what is still held",
    afterSale.value.investedCost.toDecimalString(),
    "50150.00",
  );
  check(
    "the split still reconciles",
    afterSale.value.leaseProfit!.plus(afterSale.value.priceProfit!).toDecimalString(),
    afterSale.value.totalProfit!.toDecimalString(),
  );

  section("the chart series");

  checkTrue("there are month-end points", afterSale.value.history.length > 0);
  const last = afterSale.value.history[afterSale.value.history.length - 1];
  check("ending on the as-of month", last.month, "2026-08");
  check("with the grams still held", last.grams.toDecimalString(), "6.08");
  checkTrue(
    "and every priced point's split adds up",
    afterSale.value.history
      .filter((point) => point.totalProfit !== null)
      .every(
        (point) =>
          point.leaseProfit!.plus(point.priceProfit!).toDecimalString() ===
          point.totalProfit!.toDecimalString(),
      ),
  );

  section("the platform's sell spread is what you could actually realise");

  const registered = await new RegisterInstitution(platforms).execute({
    userId,
    name: "SafeGold Vault",
    kind: "BULLION",
  });
  if (!registered.ok) throw new Error(registered.error.message);

  const linked = await new UpdateInstrument(instruments).execute({
    userId,
    instrumentId: goldId,
    institutionId: registered.value.institutionId,
  });
  if (!linked.ok) throw new Error(linked.error.message);

  const beforeSpread = await analytics.execute({ userId, instrumentId: goldId, asOf: on("2026-08-30") });
  if (!beforeSpread.ok) return;
  check(
    "a platform with no spread recorded values at the benchmark",
    beforeSpread.value.marketValue?.toDecimalString(),
    beforeSpread.value.benchmarkValue?.toDecimalString(),
  );
  check("and the spread costs nothing", beforeSpread.value.spreadCost?.toDecimalString(), "0.00");

  const spread = await new UpdateInstitution(platforms).execute({
    userId,
    institutionId: registered.value.institutionId,
    sellSpread: Percentage.of("4"),
  });
  if (!spread.ok) throw new Error(spread.error.message);

  const withSpread = await analytics.execute({ userId, instrumentId: goldId, asOf: on("2026-08-30") });
  if (!withSpread.ok) return;
  check("the benchmark is unchanged", withSpread.value.benchmarkPricePerGram?.toDecimalString(), "12000");
  check("but gold is valued at the buy-back rate", withSpread.value.pricePerGram?.toDecimalString(), "11520");
  check(
    "so the holding is worth 4% less than the benchmark says",
    withSpread.value.spreadCost?.toDecimalString(),
    "2918.40",
  );
  check(
    "and the profit falls by exactly that",
    beforeSpread.value.totalProfit!.minus(withSpread.value.totalProfit!).toDecimalString(),
    "2918.40",
  );
  checkTrue(
    "the split still reconciles at the discounted price",
    withSpread.value.leaseProfit!.plus(withSpread.value.priceProfit!).toDecimalString() ===
      withSpread.value.totalProfit!.toDecimalString(),
  );
  checkTrue(
    "and the chart is discounted too, not just the headline",
    withSpread.value.history
      .filter((point) => point.pricePerGram !== null)
      .every((point) => point.pricePerGram!.compareTo(UnitPrice.of("12000", Currency.INR)) < 0),
  );

  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
