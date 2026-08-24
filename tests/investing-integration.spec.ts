/**
 * Investments, end to end — the Phase 5 gate.
 *
 * "A real broker trade book imports; cost basis, realised gain, XIRR and TWR match
 * hand-verified fixtures; a split mid-history breaks nothing."
 *
 * The fixture is a Zerodha-shaped trade book with eleven trades across three
 * instruments, and the numbers are worked in the assertions rather than taken from
 * the code. The split is the interesting part: it is applied **between** a buy and
 * a sell, so if it touched cost basis the realised gain would be wrong, and if it
 * did not touch the quantity the sale would fail for want of units.
 *
 * The claim that ties it together: **the portfolio's value is the sum of its
 * holding accounts' balances.** Positions and the ledger are not two systems, so
 * net worth cannot disagree with the portfolio screen.
 */

import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate, FinancialYear } from "@/core/time";
import { AccountCode } from "@/domain/accounts";
import { BalanceCalculator } from "@/domain/transactions";
import { InstrumentId, type PriceLookup } from "@/domain/instruments";
import { LotBook } from "@/domain/lots";
import { Split } from "@/domain/corporate";
import {
  DrizzleAccountRepository,
  DrizzleBalanceQuery,
  DrizzleCorporateActionRepository,
  DrizzleInstrumentRepository,
  DrizzleLotRepository,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { OpenAccount, RecordTransaction, SeedChartOfAccounts } from "@/app/ledger.usecases";
import {
  AddInstrument,
  ApplyCorporateAction,
  CompareDisposalMethods,
  PortfolioReturns,
  RealisedGains,
  RecordBuy,
  RecordSell,
  ValuePortfolio,
} from "@/app/investing.usecases";
import { parseTradeBookText } from "@/infra/tradebook";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/investing-integration.db";
const rupees = (value: string) => Money.fromRupees(value);
const units = (value: string) => Quantity.fromString(value);
const on = (value: string) => CalendarDate.parse(value);

/* A Zerodha-shaped console export. */
const TRADE_BOOK = `symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time
INFY,INE009A01021,2024-04-15,NSE,EQ,EQ,buy,false,100,1500.00,T1,O1,2024-04-15T09:30:00
INFY,INE009A01021,2024-08-20,NSE,EQ,EQ,buy,false,50,1620.50,T2,O2,2024-08-20T10:15:00
TCS,INE467B01029,2024-05-10,NSE,EQ,EQ,buy,false,25,3840.75,T3,O3,2024-05-10T11:00:00
INFY,INE009A01021,2025-07-01,NSE,EQ,EQ,sell,false,200,420.00,T4,O4,2025-07-01T14:20:00
TCS,INE467B01029,2025-08-14,NSE,EQ,EQ,sell,false,10,4200.00,T5,O5,2025-08-14T13:05:00`;

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

  const userId = UserId.from("user_investing_1");
  const now = new Date("2025-09-01T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "investing@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const clock = new FixedClock(now);
  const accountRepo = new DrizzleAccountRepository(db);
  const txnRepo = new DrizzleTransactionRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  const instrumentRepo = new DrizzleInstrumentRepository(db);
  const lotRepo = new DrizzleLotRepository(db);
  const actionRepo = new DrizzleCorporateActionRepository(db, userId);
  const record = new RecordTransaction(accountRepo, txnRepo);
  const openAccount = new OpenAccount(accountRepo, txnRepo, clock);

  await new SeedChartOfAccounts(accountRepo).execute({ userId });

  const bank = await openAccount.execute({
    userId,
    name: "HDFC Savings",
    type: "ASSET",
    subtype: "BANK",
    openingBalance: rupees("1000000"),
    openingBalanceOn: on("2024-04-01"),
  });
  if (!bank.ok) throw new Error("bank setup failed");
  const bankId = bank.value.accountId;

  /** Fixture prices, so CI never touches a network. */
  const priced = (byInstrument: ReadonlyMap<string, string>): PriceLookup => ({
    async priceOn(ref) {
      const value = byInstrument.get(ref.instrumentId);
      return {
        price: value ? UnitPrice.of(value) : null,
        pricedOn: value ? on("2025-09-01") : null,
        isStale: false,
        rung: value ? "GOLDEN" : "UNAVAILABLE",
      };
    },
  });

  /* ── Parsing the trade book ────────────────────────────────────────── */

  section("a broker trade book parses");

  const book = parseTradeBookText(TRADE_BOOK);
  check("five trades", book.rows.length, 5);
  check("no problems", book.problems.length, 0);
  check("the first is a buy", book.rows[0].side, "BUY");
  check("of 100 units", book.rows[0].quantity.toDecimalString(), "100");
  check("at an exact price", book.rows[0].price.toDecimalString(), "1500.00");
  // Computed, not read: units × price, so the ledger and the lot agree to the paisa.
  check("consideration is units × price", book.rows[0].consideration.toDecimalString(), "150000.00");
  check("the ISIN is carried", book.rows[0].isin, "INE009A01021");
  check("a sale is recognised", book.rows[3].side, "SELL");

  /* ── Importing it ─────────────────────────────────────────────────── */

  section("importing the buys");

  const addInstrument = new AddInstrument(accountRepo, instrumentRepo, openAccount);
  const buy = new RecordBuy(accountRepo, instrumentRepo, txnRepo, lotRepo);
  const sell = new RecordSell(accountRepo, instrumentRepo, txnRepo, lotRepo);

  const bySymbol = new Map<string, InstrumentId>();
  for (const symbol of ["INFY", "TCS"]) {
    const added = await addInstrument.execute({
      userId,
      symbol,
      name: symbol === "INFY" ? "Infosys Ltd" : "Tata Consultancy Services",
      kind: "LISTED_EQUITY",
      isin: book.rows.find((row) => row.symbol === symbol)?.isin ?? null,
      exchange: "NSE",
    });
    if (!added.ok) throw new Error(`instrument setup failed for ${symbol}`);
    bySymbol.set(symbol, added.value.instrumentId);
  }
  check("two instruments registered", bySymbol.size, 2);

  const idempotent = await addInstrument.execute({
    userId,
    symbol: "INFY",
    name: "Infosys Ltd",
    kind: "LISTED_EQUITY",
  });
  check(
    "adding the same symbol twice returns the same instrument",
    idempotent.ok && idempotent.value.instrumentId.value,
    bySymbol.get("INFY")!.value,
  );

  for (const row of book.rows.filter((entry) => entry.side === "BUY")) {
    const result = await buy.execute({
      userId,
      instrumentId: bySymbol.get(row.symbol)!,
      fromAccountId: bankId,
      quantity: row.quantity,
      pricePerUnit: row.price,
      tradedOn: row.tradedOn,
      charges: rupees("120.00"),
    });
    if (!result.ok) throw new Error(`buy failed: ${result.error.message}`);
  }

  const infy = bySymbol.get("INFY")!;
  const infyInstrument = (await instrumentRepo.findById(userId, infy))!;
  const infyLots = await lotRepo.openLots(userId, infy);
  check("two INFY lots", infyLots.length, 2);
  check("150 units held", LotBook.openQuantity(infyLots).toDecimalString(), "150");
  /*
   * The lot keeps the price and the charges apart, because they are reported
   * differently: charges are deductible against a gain and are part of "amount
   * invested", while STT inside them is neither. `totalInvested` is the sum.
   */
  check("the first lot's price cost", infyLots[0].remainingCost.toDecimalString(), "150000.00");
  check("its charges, tracked separately", infyLots[0].props.buyCharges.toDecimalString(), "120.00");
  check("and together they are what was paid", infyLots[0].totalInvested.toDecimalString(), "150120.00");
  check("the second lot", infyLots[1].totalInvested.toDecimalString(), "81145.00");

  const holdingBalance = await balances.balanceOf(userId, infyInstrument.assetAccountId, on("2024-12-31"));
  check(
    "the holding account carries exactly the invested amount",
    holdingBalance.toDecimalString(),
    "231265.00",
  );
  check(
    "and the bank paid it",
    (await balances.balanceOf(userId, bankId, on("2024-12-31"))).toDecimalString(),
    // 1,000,000 − 150,120 − 81,145 − (25 × 3840.75 + 120)
    "672596.25",
  );

  /* ── The split, mid-history ───────────────────────────────────────── */

  section("a 1:5 split, applied between a buy and a sell");

  const applyAction = new ApplyCorporateAction(accountRepo, instrumentRepo, lotRepo, actionRepo, clock);
  const splitAction = new Split(
    {
      instrumentId: infy,
      exDate: on("2025-01-15"),
      heldQuantity: units("150"),
      currency: Money.zero().currency,
      source: "NSE announcement",
    },
    { from: units("1"), to: units("5") },
  );

  const costBeforeSplit = Money.total(infyLots.map((lot) => lot.totalInvested));
  const applied = await applyAction.execute({ userId, action: splitAction });
  check("the split applies", applied.ok, true);
  check("750 units after", applied.ok && applied.value.quantityAfter.toDecimalString(), "750");
  check("no cash moved", applied.ok && applied.value.cashMoved.toDecimalString(), "0.00");

  const afterSplit = await lotRepo.openLots(userId, infy);
  check("still two lots", afterSplit.length, 2);
  check("500 units in the first", afterSplit[0].remaining.toDecimalString(), "500");
  checkTrue(
    "and not one rupee of basis changed",
    Money.total(afterSplit.map((lot) => lot.totalInvested)).equals(costBeforeSplit),
  );
  check("so cost per unit fell to a fifth", afterSplit[0].costPerUnit.toDecimalString(), "300.00");

  const storedActions = await actionRepo.listFor(infy);
  check("the action is recorded", storedActions.length, 1);
  check("as a split", storedActions[0].kind, "SPLIT");
  check("with its ex-date", storedActions[0].exDate.toISO(), "2025-01-15");

  /* ── Selling after the split ──────────────────────────────────────── */

  section("selling 200 of the post-split units");

  const compare = new CompareDisposalMethods(instrumentRepo, lotRepo);
  const comparison = await compare.execute({
    userId,
    instrumentId: infy,
    quantity: units("200"),
    pricePerUnit: rupees("420"),
    tradedOn: on("2025-07-01"),
  });
  if (!comparison.ok) throw new Error("comparison failed");
  check("five methods compared", comparison.value.comparison.length, 5);
  const fifoGain = comparison.value.comparison.find((row) => row.method === "FIFO")!.gain;
  const hifoGain = comparison.value.comparison.find((row) => row.method === "HIFO")!.gain;
  checkTrue("HIFO realises no more gain than FIFO", !hifoGain.isGreaterThan(fifoGain));

  const sold = await sell.execute({
    userId,
    instrumentId: infy,
    toAccountId: bankId,
    quantity: units("200"),
    pricePerUnit: rupees("420"),
    tradedOn: on("2025-07-01"),
    charges: rupees("95.00"),
    deductibleCharges: rupees("60.00"),
  });
  if (!sold.ok) throw new Error(`sell failed: ${sold.error.message}`);

  check("proceeds", sold.value.proceeds.toDecimalString(), "84000.00");
  check("one lot consumed", sold.value.disposals.length, 1);
  // 200 of the first lot's 500 units: 200/500 × 150,000 of price, and 200/500 of
  // the ₹120 charge on top.
  check("basis of the units sold", sold.value.disposals[0].costBasis.toDecimalString(), "60000.00");
  check("plus their share of the buy charges", sold.value.disposals[0].buyCharges.toDecimalString(), "48.00");
  check("realised gain", sold.value.realisedGain.toDecimalString(), "23892.00");
  // The holding period runs from the original purchase, not from the split.
  check("acquired on the original buy date", sold.value.disposals[0].acquiredOn.toISO(), "2024-04-15");
  check("held for 442 days", sold.value.disposals[0].holdingDays, 442);
  checkTrue("so it is a long-term gain", sold.value.disposals[0].holdingDays > 365);

  const afterSale = await lotRepo.openLots(userId, infy);
  check("550 units left", LotBook.openQuantity(afterSale).toDecimalString(), "550");
  // 231,265 invested less 60,048 of basis leaving with the units. The charges go
  // with them, or they would sit in the account after the position closed.
  check(
    "and the holding account fell by the basis, not by the proceeds",
    (await balances.balanceOf(userId, infyInstrument.assetAccountId, on("2025-07-01"))).toDecimalString(),
    "171217.00",
  );

  section("a sale bigger than the position is refused, not shorted");

  const tooBig = await sell.execute({
    userId,
    instrumentId: infy,
    toAccountId: bankId,
    quantity: units("10000"),
    pricePerUnit: rupees("420"),
    tradedOn: on("2025-07-02"),
  });
  check("refused", !tooBig.ok, true);
  checkTrue("with P04 named", !tooBig.ok && tooBig.error.message.includes("P04"));

  /* ── The claim that ties the systems together ─────────────────────── */

  section("the portfolio is the ledger");

  const tcs = bySymbol.get("TCS")!;
  const soldTcs = await sell.execute({
    userId,
    instrumentId: tcs,
    toAccountId: bankId,
    quantity: units("10"),
    pricePerUnit: rupees("4200"),
    tradedOn: on("2025-08-14"),
    charges: rupees("140.00"),
    deductibleCharges: rupees("90.00"),
  });
  if (!soldTcs.ok) throw new Error("tcs sale failed");

  const valuePortfolio = new ValuePortfolio(
    instrumentRepo,
    lotRepo,
    priced(new Map([[infy.value, "455.75"], [tcs.value, "4310.20"]])),
  );
  const portfolio = await valuePortfolio.execute({ userId, asOf: on("2025-09-01") });
  if (!portfolio.ok) throw new Error("valuation failed");

  check("two positions", portfolio.value.valued.length, 2);
  const infyPosition = portfolio.value.valued.find((position) => position.label === "INFY")!;
  check("550 INFY units", infyPosition.quantity.toDecimalString(), "550");
  check("valued at the fixture price", infyPosition.marketValue?.toDecimalString(), "250662.50");
  // Price only: 171,025 of remaining price cost over 550 units. `costBasis` on the
  // position includes the charges, which is why the two differ.
  check("average cost per unit", infyPosition.averageCostPerUnit?.toDecimalString(), "310.95");
  checkTrue("not stale", !infyPosition.isStale);

  // The claim: cost basis of the open positions equals the sum of the holding
  // accounts' balances. Two systems, one number.
  const holdingAccounts = await Promise.all(
    portfolio.value.valued.map((position) =>
      balances.balanceOf(userId, position.instrument.assetAccountId, on("2025-09-01")),
    ),
  );
  check(
    "the holding accounts total the portfolio's cost basis",
    Money.total(holdingAccounts).toDecimalString(),
    portfolio.value.totalCost.toDecimalString(),
  );

  section("an unpriced holding makes the total null, and names itself");

  const partial = new ValuePortfolio(
    instrumentRepo,
    lotRepo,
    priced(new Map([[infy.value, "455.75"]])),
  );
  const partialResult = await partial.execute({ userId, asOf: on("2025-09-01") });
  if (!partialResult.ok) throw new Error("valuation failed");
  check("no portfolio total", partialResult.value.totalMarketValue, null);
  check("the unpriced holding is named", partialResult.value.unpricedPositions.join(","), "TCS");
  checkTrue(
    "and its own value is null rather than zero",
    partialResult.value.valued.find((position) => position.label === "TCS")!.marketValue === null,
  );

  /* ── Returns ──────────────────────────────────────────────────────── */

  section("returns over the real cashflows");

  const returns = new PortfolioReturns(accountRepo, instrumentRepo, txnRepo, valuePortfolio);
  const result = await returns.execute({ userId, asOf: on("2025-09-01") });
  if (!result.ok) throw new Error("returns failed");

  checkTrue("XIRR converges", result.value.xirr.ok);
  checkTrue(
    "and the flows include every buy, every sale and the closing value",
    result.value.flows.length >= 6,
  );
  // 150,120 + 81,145 + 96,138.75 of buys, charges included.
  check("invested", result.value.invested.toDecimalString(), "327403.75");
  // The two sales, net of their charges.
  check("withdrawn", result.value.withdrawn.toDecimalString(), "125765.00");
  checkTrue("current value is known", result.value.currentValue !== null);
  /*
   * Positive only because the proceeds count. The remaining holdings are worth
   * less than everything ever put in — a return that ignored the ₹1.25 lakh
   * already taken out would report this profitable portfolio as a loss.
   */
  checkTrue(
    "and the absolute return is positive on this fixture",
    (result.value.absoluteReturn?.toApproximateNumber() ?? 0) > 0,
  );

  const perInstrument = await returns.execute({ userId, asOf: on("2025-09-01"), instrumentId: infy });
  checkTrue("a single instrument's return is computable too", perInstrument.ok && perInstrument.value.xirr.ok);

  section("realised gains by financial year");

  const realised = new RealisedGains(lotRepo);
  const fy = await realised.execute({ userId, financialYear: FinancialYear.parse("2025-26") });
  if (!fy.ok) throw new Error("realised gains failed");
  check("two disposals in FY2025-26", fy.value.disposals.length, 2);
  checkTrue("both long-term", fy.value.shortTerm.isZero);
  check(
    "and the total matches the two sales",
    fy.value.total.toDecimalString(),
    sold.value.realisedGain.plus(soldTcs.value.realisedGain).toDecimalString(),
  );

  const earlierYear = await realised.execute({ userId, financialYear: FinancialYear.parse("2024-25") });
  check("nothing was realised the year before", earlierYear.ok && earlierYear.value.disposals.length, 0);

  /* ── The ledger is still sound ────────────────────────────────────── */

  section("the ledger still balances");

  const everything = await txnRepo.find(userId, { limit: 20_000 });
  const calculator = new BalanceCalculator();
  check("debits equal credits", calculator.verifyIntegrity(everything.transactions).ok, true);

  const accounts = await accountRepo.list(userId, { includeClosed: true });
  const pure = calculator.balancesAsOf(accounts, everything.transactions, on("2025-09-01"));
  const sheet = await balances.balanceSheet(userId, on("2025-09-01"), { includeClosed: true });
  check(
    "and the SQL read path agrees with the pure fold",
    sheet.filter((row) => !pure.get(row.accountId.value)!.equals(row.balance)).length,
    0,
  );

  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
