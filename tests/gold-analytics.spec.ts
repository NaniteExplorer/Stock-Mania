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
  // One purchase and no terminal value is one flow, and one flow has no rate.
  check("the return is undefined, not zero", unpriced.value.xirr.ok, false);
  check(
    "and it says which kind of undefined",
    unpriced.value.xirr.ok ? "" : unpriced.value.xirr.reason,
    "TOO_FEW_FLOWS",
  );
  checkTrue(
    "with a sentence a screen can render in place of the number",
    (unpriced.value.xirr.ok ? "" : unpriced.value.xirr.because).length > 20,
  );
  check("GST is not invented out of a fused charges figure", unpriced.value.gstPaid, null);
  checkTrue(
    "and the blank explains itself",
    (unpriced.value.gstPaidReason ?? "").includes("tax-inclusive"),
  );
  check("the threshold comes from the regime", unpriced.value.taxThresholdDays, 730);
  check("for the instrument's own category", unpriced.value.taxCategory, "GOLD");

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
  /*
   * 10g × 12% × 12/12 = 1.2g, and all 1.2g lands: `DEFAULT_TDS_RATE` is zero, so
   * a lease that was never told a withholding rate accrues gross. The TDS
   * arithmetic is not gone — a lease with a rate set still splits gross from net
   * — it is simply no longer presumed. Every gram figure below is the gross one.
   */
  check("net grams credited", accrued.value.postedGrams.toDecimalString(), "1.2");

  const withLease = await analytics.execute({ userId, instrumentId: goldId, asOf: on("2026-08-30") });
  if (!withLease.ok) return;
  check("the holding grew", withLease.value.totalGrams.toDecimalString(), "11.2");
  check("of which bought", withLease.value.purchasedGrams.toDecimalString(), "10");
  check("and credited by the lease", withLease.value.leaseGrams.toDecimalString(), "1.2");
  check("lease profit is the whole value of those grams", withLease.value.leaseProfit?.toDecimalString(), "14400.00");
  check("price profit is unchanged", withLease.value.priceProfit?.toDecimalString(), "19700.00");
  check("and the two add to the total", withLease.value.totalProfit?.toDecimalString(), "34100.00");
  check(
    "which is market value less cash paid",
    withLease.value.marketValue?.minus(withLease.value.investedCost).toDecimalString(),
    "34100.00",
  );
  checkTrue(
    "the lease lots reconcile with what the leases say they credited",
    withLease.value.leaseGramsReconcile === null,
  );
  check(
    "the book figure is the accounting one, and is smaller",
    withLease.value.unrealisedAgainstBook?.toDecimalString(),
    "20900.00",
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
  check("half the gold is gone", afterSale.value.totalGrams.toDecimalString(), "6.2");
  check(
    "FIFO took it from the bought lot, so the lease grams survive",
    afterSale.value.leaseGrams.toDecimalString(),
    "1.2",
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
  check("with the grams still held", last.grams.toDecimalString(), "6.2");
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
    "2976.00",
  );
  check(
    "and the profit falls by exactly that",
    beforeSpread.value.totalProfit!.minus(withSpread.value.totalProfit!).toDecimalString(),
    "2976.00",
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

  section("the money-weighted return, and what the lease adds to it");

  const returns = await analytics.execute({ userId, instrumentId: goldId, asOf: on("2026-08-30") });
  if (!returns.ok) return;
  checkTrue("a rate is defined once there is a terminal value", returns.value.xirr.ok);
  checkTrue("and for the price-only series too", returns.value.priceXirr.ok);
  checkTrue(
    "price-only sits strictly below blended — the gap is the rent",
    returns.value.xirr.ok &&
      returns.value.priceXirr.ok &&
      returns.value.priceXirr.rate.percent.compareTo(returns.value.xirr.rate.percent) < 0,
  );
  checkTrue(
    "the lease credit is not a cashflow: only settled trades are",
    returns.value.xirr.ok &&
      returns.value.xirr.flows.filter((flow) => flow.note?.startsWith("Bought")).length === 1,
  );
  checkTrue(
    "and the series closes on the as-of date at the realisable value",
    returns.value.xirr.ok &&
      returns.value.xirr.flows[returns.value.xirr.flows.length - 1].amount.toDecimalString() ===
        returns.value.marketValue!.toDecimalString(),
  );

  section("break-even is a target, and the benchmark has to clear the spread to reach it");

  check(
    "break-even is cash paid spread over every gram held",
    returns.value.breakEvenPricePerGram?.toDecimalString(),
    returns.value.blendedCostPerGram?.toDecimalString(),
  );
  checkTrue(
    "the benchmark has to print higher, because the platform pays less than it",
    returns.value.benchmarkBreakEvenPricePerGram!.compareTo(
      returns.value.breakEvenPricePerGram!,
    ) > 0,
  );
  checkTrue(
    "and discounting that benchmark by the spread lands back at break-even",
    (await platforms.findById(userId, registered.value.institutionId))!
      .realisablePrice(returns.value.benchmarkBreakEvenPricePerGram!)
      .compareTo(returns.value.breakEvenPricePerGram!) >= 0,
  );

  section("the lot ladder, and the day each lot turns long-term");

  const ladder = returns.value.lotLadder;
  checkTrue("there is a row per open lot, oldest first", ladder.length === 2);
  check("the oldest is the purchase", ladder[0].origin, "PURCHASE");
  check("acquired when it was bought", ladder[0].acquiredOn.toISO(), "2025-01-15");
  check("carrying what is left of it", ladder[0].grams.toDecimalString(), "5");
  check("at the cash it cost", ladder[0].investedCost.toDecimalString(), "50150.00");
  check("the second row is the lease credit", ladder[1].origin, "LEASE_CREDIT");
  check("which cost nothing", ladder[1].investedCost.toDecimalString(), "0.00");
  check("so it has no cost per gram — null, not zero", ladder[1].costPerGram, null);
  check(
    "and its whole value is unrealised profit",
    ladder[1].unrealised?.toDecimalString(),
    ladder[1].marketValue?.toDecimalString(),
  );
  check(
    "the rows sum to the cash invested",
    Money.total(ladder.map((row) => row.investedCost), Currency.INR).toDecimalString(),
    returns.value.investedCost.toDecimalString(),
  );
  check(
    "and to the profit over cash",
    Money.total(ladder.map((row) => row.unrealised!), Currency.INR).toDecimalString(),
    returns.value.totalProfit!.toDecimalString(),
  );
  check(
    "the eligibility date is the day after the threshold, not the threshold",
    ladder[0].longTermOn?.toISO(),
    "2027-01-16",
  );
  checkTrue("and nothing is long-term yet", ladder.every((row) => !row.isLongTerm));

  const atThreshold = await analytics.execute({
    userId,
    instrumentId: goldId,
    asOf: on("2027-01-15"),
  });
  if (!atThreshold.ok) return;
  check("held exactly 730 days", atThreshold.value.lotLadder[0].holdingDays, 730);
  check(
    "is still short-term — the rule is strictly greater",
    atThreshold.value.lotLadder[0].isLongTerm,
    false,
  );
  check("with one day left to go", atThreshold.value.lotLadder[0].daysToLongTerm, 1);

  const dayAfter = await analytics.execute({
    userId,
    instrumentId: goldId,
    asOf: on("2027-01-16"),
  });
  if (!dayAfter.ok) return;
  check("one more day makes it long-term", dayAfter.value.lotLadder[0].isLongTerm, true);
  check("and the countdown stops at zero", dayAfter.value.lotLadder[0].daysToLongTerm, 0);

  section("lease income lands in the financial year it was credited");

  await quotes.append([
    {
      instrumentId: goldId.value,
      asOf: on("2026-05-01"),
      quoteType: "CLOSE",
      price: UnitPrice.of("11500", Currency.INR),
      providerId: "test",
      sourceType: "MANUAL",
      ingestedAt: now,
    },
  ]);

  const second = await new AccrueLeaseInterest(
    accounts,
    instruments,
    leaseRepo,
    journal,
    lots,
    new ScriptedPrices({ "2026-05-01": "11500" }),
  ).execute({ userId, leaseId: lease.id, asOf: on("2026-05-01") });
  checkTrue("a second accrual posts", second.ok);
  if (!second.ok) return;

  const filed = await analytics.execute({ userId, instrumentId: goldId, asOf: on("2026-08-30") });
  if (!filed.ok) return;
  const years = filed.value.leaseIncomeByFinancialYear;
  check("two credits, two financial years", years.length, 2);
  check("1 Feb 2026 is FY2025-26", years[0].financialYear, "2025-26");
  check("1 May 2026 is the next year, not the same one", years[1].financialYear, "2026-27");
  checkTrue("oldest first", years[0].financialYear < years[1].financialYear);
  check(
    "a credit on a day with no quote of its own carries the last one",
    years[0].pricedFrom,
    "CARRIED",
  );
  check("a credit on a quoted day says so", years[1].pricedFrom, "QUOTE");
  check(
    "valued at the buy-back rate of the credit date, not today's",
    years[1].value.toDecimalString(),
    // ₹11,500 published, less the platform's 4% spread = ₹11,040 realisable.
    UnitPrice.of("11040", Currency.INR).times(years[1].grams).toDecimalString(),
  );
  check(
    "and the grams are the ones credited",
    years[0].grams.plus(years[1].grams).toDecimalString(),
    filed.value.creditedGramsEver.minus(filed.value.tdsGrams).toDecimalString(),
  );

  section("a holding that is nothing but lease credits still reports honestly");

  const soldOut = await new RecordSell(accounts, instruments, journal, lots).execute({
    userId,
    instrumentId: goldId,
    toAccountId: bank.value.accountId,
    quantity: grams("5"),
    pricePerUnit: rupees("12000"),
    tradedOn: on("2026-08-25"),
  });
  if (!soldOut.ok) throw new Error(soldOut.error.message);

  const leaseOnly = await analytics.execute({ userId, instrumentId: goldId, asOf: on("2026-08-30") });
  if (!leaseOnly.ok) return;
  check("no bought grams are left", leaseOnly.value.purchasedGrams.toDecimalString(), "0");
  check("only lease grams remain", leaseOnly.value.totalGrams.toDecimalString(), leaseOnly.value.leaseGrams.toDecimalString());
  check("nothing is invested in them", leaseOnly.value.investedCost.toDecimalString(), "0.00");
  check("so there is no cost per bought gram", leaseOnly.value.effectiveCostPerGram, null);
  checkTrue(
    "every ladder row is a lease credit with no cost basis",
    leaseOnly.value.lotLadder.length > 0 &&
      leaseOnly.value.lotLadder.every(
        (row) => row.origin === "LEASE_CREDIT" && row.costPerGram === null,
      ),
  );
  check(
    "all of the remaining value is lease profit",
    leaseOnly.value.leaseProfit?.toDecimalString(),
    leaseOnly.value.marketValue?.toDecimalString(),
  );
  checkTrue(
    "the price-only return is still below the blended one, having no gold left to price",
    leaseOnly.value.xirr.ok &&
      leaseOnly.value.priceXirr.ok &&
      leaseOnly.value.priceXirr.rate.percent.compareTo(leaseOnly.value.xirr.rate.percent) < 0,
  );

  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
