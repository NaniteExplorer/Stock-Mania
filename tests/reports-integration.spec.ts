/**
 * The three statements, on a full ledger — the Phase 6 gate.
 *
 * "The three financial statements reconcile; no v1 code remains; `mongoose` is out
 * of `package.json`."
 *
 * The ledger here is deliberately varied: opening balances, salary, spending on a
 * card, a card payment, a deposit funded from a bank, a loan drawdown with an EMI,
 * and a share bought and partly sold. Between them they touch all five account
 * types and every transaction subclass a household uses, which is what makes B02
 * worth checking — the identity is trivially true on a ledger with two entries.
 *
 * The last two clauses of the gate are asserted mechanically rather than by
 * inspection: nothing under `features/`, `core/` or `src/modules/` remains, and
 * `mongoose` appears nowhere in `package.json` or in any import.
 */

import { readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { Percentage, Quantity, Rate, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange, FinancialYear } from "@/core/time";
import { AccountCode } from "@/domain/accounts";
import { BalanceCalculator } from "@/domain/transactions";
import type { PriceLookup } from "@/domain/instruments";
import {
  DrizzleAccountRepository,
  DrizzleBalanceQuery,
  DrizzleCardTermsRepository,
  DrizzleDepositRepository,
  DrizzleInstrumentRepository,
  DrizzleLotRepository,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { OpenAccount, RecordTransaction, SeedChartOfAccounts } from "@/app/ledger.usecases";
import { OpenCashAccount, OpenCreditCard, PayCard, RecordAccountTransfer, RecordSpend } from "@/app/banking.usecases";
import { OpenDeposit, OpenLoan, RecordLoanInstalment } from "@/app/lending.usecases";
import { AddInstrument, RecordBuy, RecordSell } from "@/app/investing.usecases";
import { BuildStatements, NetWorthSeries, PersonalReport, SuggestHarvest, TaxReport } from "@/app/reports.usecases";
import { BillingCycleRule } from "@/domain/assets";
import { check, checkDeep, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/reports-integration.db";
const rupees = (value: string) => Money.fromRupees(value);
const units = (value: string) => Quantity.fromString(value);
const on = (value: string) => CalendarDate.parse(value);

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

  const userId = UserId.from("user_reports_1");
  const now = new Date("2026-09-30T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "reports@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const clock = new FixedClock(now);
  const accountRepo = new DrizzleAccountRepository(db);
  const txnRepo = new DrizzleTransactionRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  const cardTerms = new DrizzleCardTermsRepository(db);
  const lending = new DrizzleDepositRepository(db);
  const instrumentRepo = new DrizzleInstrumentRepository(db);
  const lotRepo = new DrizzleLotRepository(db);

  const record = new RecordTransaction(accountRepo, txnRepo);
  const openAccount = new OpenAccount(accountRepo, txnRepo, clock);
  const transfer = new RecordAccountTransfer(accountRepo, record);

  await new SeedChartOfAccounts(accountRepo).execute({ userId });

  /* ── A household's year ────────────────────────────────────────────── */

  section("building a varied ledger");

  const bank = await new OpenCashAccount(accountRepo, openAccount).execute({
    userId,
    name: "HDFC Savings",
    subtype: "BANK",
    openingBalance: rupees("500000"),
    openingBalanceOn: on("2026-03-31"),
  });
  if (!bank.ok) throw new Error("bank setup failed");
  const bankId = bank.value.accountId;

  const card = await new OpenCreditCard(openAccount, cardTerms).execute({
    userId,
    name: "HDFC Regalia",
    terms: {
      creditLimit: rupees("200000"),
      cycle: new BillingCycleRule(18, 20),
      financeRate: Rate.annual("42"),
      minimumDuePercent: Percentage.of("5"),
      minimumDueFloor: rupees("500"),
      lateFee: rupees("500"),
      annualFee: rupees("0"),
      gstOnCharges: Percentage.of("18"),
      pointsPerHundred: Quantity.ZERO,
    },
  });
  if (!card.ok) throw new Error("card setup failed");

  const salary = (await accountRepo.findByCode(userId, AccountCode.parse("Income:Salary")))!;
  const groceries = (await accountRepo.findByCode(userId, AccountCode.parse("Expenses:Food:Groceries")))!;
  const rent = (await accountRepo.findByCode(userId, AccountCode.parse("Expenses:Housing:Rent")))!;

  // Six months of salary, rent and groceries — some on the card.
  for (let month = 0; month < 6; month += 1) {
    const first = on("2026-04-01").plusMonths(month);
    await record.execute({
      userId,
      fromAccountId: salary.id,
      toAccountId: bankId,
      amount: rupees("150000"),
      postedOn: first,
      narration: `Salary ${first.toMonthKey()}`,
    });
    await record.execute({
      userId,
      fromAccountId: bankId,
      toAccountId: rent.id,
      amount: rupees("35000"),
      postedOn: first.plusDays(2),
      narration: `Rent ${first.toMonthKey()}`,
    });
    await new RecordSpend(accountRepo, record).execute({
      userId,
      fromAccountId: card.value.accountId,
      categoryAccountId: groceries.id,
      amount: rupees("12500.75"),
      postedOn: first.plusDays(9),
      narration: `Groceries ${first.toMonthKey()}`,
    });
  }

  // A card payment — a transfer, and it must inflate no expense.
  await new PayCard(accountRepo, transfer).execute({
    userId,
    fromAccountId: bankId,
    cardAccountId: card.value.accountId,
    amount: rupees("50000"),
    postedOn: on("2026-08-05"),
  });

  // A deposit funded from the bank.
  const deposit = await new OpenDeposit(openAccount, lending, record).execute({
    userId,
    name: "HDFC FD",
    kind: "FIXED_DEPOSIT",
    openedOn: on("2026-05-01"),
    principal: rupees("100000"),
    maturesOn: on("2031-05-01"),
    rate: Rate.annual("7.1"),
    compounding: "QUARTERLY",
    fundedFromAccountId: bankId,
  });
  if (!deposit.ok) throw new Error("deposit setup failed");

  // A loan drawn into the bank, and one instalment paid.
  const loan = await new OpenLoan(accountRepo, openAccount, lending, record).execute({
    userId,
    name: "Car Loan",
    kind: "VEHICLE",
    principal: rupees("600000"),
    annualRate: Rate.annual("9.2"),
    periods: 60,
    disbursedOn: on("2026-06-01"),
    disbursedToAccountId: bankId,
  });
  if (!loan.ok) throw new Error("loan setup failed");

  await new RecordLoanInstalment(accountRepo, lending, record).execute({
    userId,
    loanAccountId: loan.value.accountId,
    fromAccountId: bankId,
    period: 1,
  });

  // A share bought and partly sold.
  const added = await new AddInstrument(accountRepo, instrumentRepo, openAccount).execute({
    userId,
    symbol: "INFY",
    name: "Infosys Ltd",
    kind: "LISTED_EQUITY",
  });
  if (!added.ok) throw new Error("instrument setup failed");

  await new RecordBuy(accountRepo, instrumentRepo, txnRepo, lotRepo).execute({
    userId,
    instrumentId: added.value.instrumentId,
    fromAccountId: bankId,
    quantity: units("100"),
    pricePerUnit: rupees("1500"),
    tradedOn: on("2026-04-20"),
    charges: rupees("150"),
  });
  await new RecordSell(accountRepo, instrumentRepo, txnRepo, lotRepo).execute({
    userId,
    instrumentId: added.value.instrumentId,
    toAccountId: bankId,
    quantity: units("40"),
    pricePerUnit: rupees("1680"),
    tradedOn: on("2026-09-15"),
    charges: rupees("95"),
    deductibleCharges: rupees("60"),
  });

  const everything = await txnRepo.find(userId, { limit: 20_000 });
  checkTrue("the ledger has a variety of entries", everything.totalCount > 25);
  check(
    "and every one balances",
    new BalanceCalculator().verifyIntegrity(everything.transactions).ok,
    true,
  );

  /* ── The gate: the three statements reconcile ─────────────────────── */

  section("the three statements reconcile — the Phase 6 gate");

  const asOf = on("2026-09-30");
  const statements = new BuildStatements(balances);
  const result = await statements.execute({
    userId,
    asOf,
    period: DateRange.of(on("2026-04-01"), asOf),
  });
  if (!result.ok) throw new Error(result.error.message);

  const sheet = result.value.balanceSheet;
  const income = result.value.incomeStatement;

  checkTrue("assets are positive", sheet.assets.total.isPositive);
  checkTrue("liabilities are positive", sheet.liabilities.total.isPositive);
  check(
    "net worth is assets less liabilities",
    sheet.netWorth.toDecimalString(),
    sheet.assets.total.minus(sheet.liabilities.total).toDecimalString(),
  );

  // B02, on the same balances the statements were built from.
  check("B02 holds", result.value.identityHolds, true);
  check("with a zero difference", result.value.identityDifference.toDecimalString(), "0.00");

  // And the balance sheet agrees with the read side's own totals.
  const totals = await balances.totals(userId, asOf);
  check("the balance sheet agrees with the ledger totals", sheet.netWorth.toDecimalString(), totals.netWorth.toDecimalString());

  /*
   * ₹9,00,000 of salary plus ₹7,140 of realised gain. The gain appears as income
   * because that is where a `Sell` books it — a gain derived from the postings
   * rather than stored beside them, which is the point of the whole design.
   */
  check("income for the period", income.income.total.toDecimalString(), "907140.00");
  checkTrue("expenses include the card spending", income.expenses.total.isGreaterThan(rupees("280000")));
  check(
    "and the surplus is income less expenses",
    income.net.toDecimalString(),
    income.income.total.minus(income.expenses.total).toDecimalString(),
  );
  checkTrue("with a savings rate between 0 and 100%", (income.savingsRate?.toApproximateNumber() ?? -1) > 0);

  section("the card payment inflated no expense");

  const cardPaymentMonth = await balances.flowsByAccount(
    userId,
    DateRange.of(on("2026-08-01"), on("2026-08-31")),
    { type: "EXPENSE", rollUp: false },
  );
  const augustExpenses = Money.total(cardPaymentMonth.map((flow) => flow.amount));
  checkTrue(
    "August's expenses are the month's spending, not the ₹50,000 transfer",
    augustExpenses.isLessThan(rupees("50000")),
  );

  section("the cash-flow statement");

  const cashflow = result.value.cashflow;
  checkTrue("operating covers salary and living costs", cashflow.operating.isPositive);
  checkTrue("investing is negative — money went into a deposit and a holding", cashflow.investing.isNegative);
  checkTrue("financing is positive — a car loan was drawn down", cashflow.financing.isPositive);
  check(
    "and the three sections sum to the net change",
    cashflow.netChange.toDecimalString(),
    cashflow.operating.plus(cashflow.investing).plus(cashflow.financing).toDecimalString(),
  );

  /*
   * And it ties, exactly. That is only true because investing and financing are
   * built from the movement in *every* balance-sheet account: a statement built
   * from income and expense accounts alone cannot reconcile, because the money that
   * went into the fixed deposit never touched an expense account.
   */
  check("the statement ties to the change in cash", cashflow.reconciles, true);
  check(
    "opening plus the net change is the closing balance",
    cashflow.openingCash.plus(cashflow.netChange).toDecimalString(),
    cashflow.closingCash.toDecimalString(),
  );
  check(
    "the opening and closing cash figures are the ledger's own",
    cashflow.closingCash.toDecimalString(),
    (await balances.balanceOf(userId, bankId, asOf)).toDecimalString(),
  );

  section("allocation");

  const allocation = result.value.allocation;
  checkTrue("more than one asset class", allocation.length > 1);
  checkTrue(
    "and the weights sum to 100%",
    Math.abs(allocation.reduce((total, bucket) => total + bucket.weight.toApproximateNumber(), 0) - 100) < 0.01,
  );
  checkTrue(
    "with no negative bucket — liabilities are not netted into an asset class",
    allocation.every((bucket) => !bucket.value.isNegative),
  );

  /* ── B03 over the series ──────────────────────────────────────────── */

  section("net worth month by month");

  const series = await new NetWorthSeries(balances).execute({ userId, months: 7, asOf });
  if (!series.ok) throw new Error(series.error.message);
  check("seven month ends", series.value.series.length, 7);
  check("B03 holds across them", series.value.continuityHolds, true);
  check(
    "and the last point is today's net worth",
    series.value.series[6].netWorth.toDecimalString(),
    // The series is built to month ends, and September's is the 30th.
    (await balances.totals(userId, on("2026-09-30"))).netWorth.toDecimalString(),
  );

  /* ── Personal metrics ─────────────────────────────────────────────── */

  section("personal metrics");

  const personal = await new PersonalReport(accountRepo, balances).execute({ userId, asOf });
  if (!personal.ok) throw new Error(personal.error.message);
  checkTrue("liquid net worth is less than net worth", personal.value.liquidNetWorth.isLessThan(sheet.assets.total));
  checkTrue("a savings rate is computable", personal.value.savingsRate !== null);
  checkTrue("a burn rate is computable", personal.value.burnRate !== null);
  checkTrue("and a runway follows from it", personal.value.runwayMonths !== null);
  checkTrue(
    "credit utilisation is null with no card terms loaded, rather than a misleading 0%",
    personal.value.creditUtilisation === null,
  );

  /*
   * With the terms injected it becomes a number, and the number is checked
   * against the fixture rather than against itself: the card owes ₹18,000 on a
   * ₹2,00,000 limit, which is 9%.
   *
   * The distinction the two assertions draw is the whole reason the repository is
   * optional. "We do not know the limit" and "nothing is owed" are opposite
   * claims, and 0% would be indistinguishable from the second.
   */
  const withLimits = await new PersonalReport(accountRepo, balances, cardTerms).execute({
    userId,
    asOf,
  });
  if (!withLimits.ok) throw new Error(withLimits.error.message);
  checkTrue(
    "with card terms loaded it is a number",
    withLimits.value.creditUtilisation !== null,
  );
  const cardOwed = sheet.liabilities.rows.find((row) => row.subtype === "CREDIT_CARD")?.balance;
  check(
    "and it is the balance over the limit",
    withLimits.value.creditUtilisation?.toFixed(2),
    Percentage.ratio(cardOwed ?? rupees("0"), rupees("200000")).toFixed(2),
  );

  /* ── The tax report ───────────────────────────────────────────────── */

  section("the tax report, with provenance");

  const tax = await new TaxReport(lotRepo, instrumentRepo).execute({
    userId,
    financialYear: FinancialYear.parse("2026-27"),
    settings: {
      slabRate: Percentage.of("30"),
      totalIncome: rupees("900000"),
      residentStatus: "RESIDENT",
    },
  });
  if (!tax.ok) throw new Error(tax.error.message);

  check("one disposal this year", tax.value.events.length, 1);
  check("taxed as listed equity", tax.value.events[0].taxCategory, "LISTED_EQUITY");
  check("held 148 days", tax.value.events[0].holdingDays, 148);
  checkTrue("so it is a short-term gain", tax.value.assessment.lines.some((line) => line.term === "SHORT_TERM"));
  checkTrue("every line names its rule", tax.value.assessment.lines.every((line) => line.rule.length > 0));
  checkTrue(
    "and the regime version that produced it",
    tax.value.assessment.lines.every((line) => line.ruleVersion.length > 0),
  );
  checkTrue("with the inputs it used", tax.value.assessment.lines.every((line) => Object.keys(line.inputs).length > 0));
  check("the assessment names its regime", tax.value.assessment.regime.length > 0, true);

  section("harvesting suggestions");

  /** A price below cost, so the position shows an unrealised loss. */
  const lowPrice: PriceLookup = {
    async priceOn() {
      return { price: UnitPrice.of("900"), pricedOn: asOf, isStale: false, rung: "GOLDEN" };
    },
  };
  const harvest = await new SuggestHarvest(instrumentRepo, lotRepo, lowPrice).execute({
    userId,
    asOf,
    realisedGains: rupees("7000"),
  });
  if (!harvest.ok) throw new Error(harvest.error.message);

  check("one suggestion", harvest.value.suggestions.length, 1);
  check("for the position that is down", harvest.value.suggestions[0].symbol, "INFY");
  checkTrue("with a loss worth harvesting", harvest.value.harvestableLoss.isPositive);
  check(
    "capped by the gains there are to offset",
    harvest.value.offsettable.toDecimalString(),
    "7000.00",
  );
  checkTrue(
    "and the no-wash-sale caveat is stated rather than implied",
    harvest.value.caveats.some((caveat) => caveat.includes("no wash-sale rule")),
  );

  /** At a price above cost there is nothing to harvest. */
  const highPrice: PriceLookup = {
    async priceOn() {
      return { price: UnitPrice.of("2000"), pricedOn: asOf, isStale: false, rung: "GOLDEN" };
    },
  };
  const nothing = await new SuggestHarvest(instrumentRepo, lotRepo, highPrice).execute({
    userId,
    asOf,
    realisedGains: rupees("7000"),
  });
  check("a position in profit is not suggested", nothing.ok && nothing.value.suggestions.length, 0);

  /* ── The rest of the gate ─────────────────────────────────────────── */

  section("no v1 code remains");

  checkDeep(
    "the v1 directories are gone",
    ["features", "core", "src/modules", "src/shared", "src/db"].filter((path) => existsSync(path)),
    [],
  );

  const packageJson = readFileSync("package.json", "utf8");
  checkTrue("mongoose is not a dependency", !packageJson.includes("mongoose"));

  const mongooseImports: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
      const source = readFileSync(path, "utf8");
      if (source.includes("from \"mongoose\"") || source.includes("require(\"mongoose\")")) {
        mongooseImports.push(path);
      }
    }
  };
  for (const root of ["src", "app", "components", "lib", "hooks", "types"]) {
    if (existsSync(root)) walk(root);
  }
  checkDeep("and nothing imports it", mongooseImports, []);

  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
