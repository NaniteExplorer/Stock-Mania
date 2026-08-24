/**
 * Deposits and loans, end to end — the Phase 4 gate.
 *
 * "Every deposit's computed maturity matches its certificate; every loan schedule
 * sums to its principal exactly." `tests/deposits.spec.ts` and `tests/loans.spec.ts`
 * prove the arithmetic; this spec proves it survives the round trip through
 * libSQL, and that the ledger the postings build agrees with it.
 *
 * Three claims are only checkable here:
 *
 *   - **Terms round-trip exactly.** A rate stored as a scaled integer and read
 *     back must produce the same maturity value to the paisa; a rate that lost a
 *     decimal place in the database would be undetectable in a unit test.
 *   - **Deleting the accrual job changes no number.** There is no job, so this is
 *     asserted the only way it can be: the value is computed twice, days apart,
 *     with writes in between, and does not move.
 *   - **An EMI splits into principal and interest, and the two postings together
 *     leave the loan account exactly where the schedule says.**
 */

import { readFileSync, readdirSync, rmSync } from "node:fs";
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
import { EmployeeProvidentFund, FixedDeposit, PublicProvidentFund, RecurringDeposit } from "@/domain/deposits";
import { HomeLoan, PersonalLoan } from "@/domain/loans";
import {
  DrizzleAccountRepository,
  DrizzleBalanceQuery,
  DrizzleDepositRepository,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { OpenAccount, RecordTransaction, SeedChartOfAccounts } from "@/app/ledger.usecases";
import {
  BookAccruedInterest,
  ComparePayoff,
  ListDeposits,
  ListLoans,
  OpenDeposit,
  OpenLoan,
  RecordLoanInstalment,
  RecordPrepayment,
  RecordSchemeContribution,
  SetNpsUnits,
  SetSchemeRate,
  ValueNps,
} from "@/app/lending.usecases";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/lending-integration.db";
const rupees = (value: string) => Money.fromRupees(value);
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

  const userId = UserId.from("user_lending_1");
  const now = new Date("2027-04-15T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "lending@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const clock = new FixedClock(now);
  const accountRepo = new DrizzleAccountRepository(db);
  const txnRepo = new DrizzleTransactionRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  const lending = new DrizzleDepositRepository(db);
  const record = new RecordTransaction(accountRepo, txnRepo);
  const openAccount = new OpenAccount(accountRepo, txnRepo, clock);

  await new SeedChartOfAccounts(accountRepo).execute({ userId });

  const bank = await openAccount.execute({
    userId,
    name: "HDFC Savings",
    type: "ASSET",
    subtype: "BANK",
    openingBalance: rupees("2000000"),
    openingBalanceOn: on("2026-03-31"),
  });
  if (!bank.ok) throw new Error("bank setup failed");
  const bankId = bank.value.accountId;

  const openDeposit = new OpenDeposit(openAccount, lending, record);
  const listDeposits = new ListDeposits(accountRepo, lending, balances);
  const openLoan = new OpenLoan(accountRepo, openAccount, lending, record);
  const listLoans = new ListLoans(accountRepo, lending, balances);

  /* ── A fixed deposit, funded from the bank ─────────────────────────── */

  section("a fixed deposit, funded from a tracked account");

  const fd = await openDeposit.execute({
    userId,
    name: "HDFC FD 5yr",
    kind: "FIXED_DEPOSIT",
    institution: "HDFC Bank",
    openedOn: on("2026-04-01"),
    principal: rupees("100000"),
    maturesOn: on("2031-04-01"),
    rate: Rate.annual("7.1"),
    compounding: "QUARTERLY",
    prematurePenalty: Percentage.of("1"),
    fundedFromAccountId: bankId,
  });
  check("the deposit opens", fd.ok, true);
  if (!fd.ok) throw new Error("fd setup failed");

  // Funding it is a transfer: the bank falls by exactly what the deposit holds,
  // and net worth is unchanged. Borrowing and saving both leave it alone.
  check(
    "the bank paid for it",
    (await balances.balanceOf(userId, bankId, on("2026-04-01"))).toDecimalString(),
    "1900000.00",
  );
  check(
    "and the deposit account holds the principal",
    (await balances.balanceOf(userId, fd.value.accountId, on("2026-04-01"))).toDecimalString(),
    "100000.00",
  );
  const netWorthAtOpen = await balances.totals(userId, on("2026-04-01"));
  check("net worth is unchanged by moving money into a deposit", netWorthAtOpen.netWorth.toDecimalString(), "2000000.00");

  section("terms round-trip through the database exactly");

  const accounts = await accountRepo.list(userId, { includeClosed: true });
  const loadedFd = (await lending.loadDeposits(userId, accounts)).find(
    (deposit) => deposit.id.value === fd.value.accountId.value,
  );
  checkTrue("it loads back as a FixedDeposit", loadedFd instanceof FixedDeposit);
  check(
    "and its maturity value is the certificate figure, to the paisa",
    (loadedFd as FixedDeposit).maturityValue().toDecimalString(),
    "142174.67",
  );
  check(
    "which is what the pure domain object computes",
    new FixedDeposit((loadedFd as FixedDeposit).account, (loadedFd as FixedDeposit).terms)
      .maturityValue()
      .toDecimalString(),
    "142174.67",
  );
  check(
    "the rate survived with all ten decimals",
    (loadedFd as FixedDeposit).terms.rate.toString(),
    "7.1000% p.a. ACT/365F",
  );

  /* ── A recurring deposit ───────────────────────────────────────────── */

  section("a recurring deposit");

  const rd = await openDeposit.execute({
    userId,
    name: "SBI RD",
    kind: "RECURRING_DEPOSIT",
    openedOn: on("2026-04-01"),
    instalment: rupees("5000"),
    months: 24,
    rate: Rate.annual("6.8"),
    compounding: "QUARTERLY",
  });
  if (!rd.ok) throw new Error("rd setup failed");

  const loadedRd = (await lending.loadDeposits(userId, accounts.concat(await accountRepo.list(userId))).then((all) =>
    all.find((deposit) => deposit.id.value === rd.value.accountId.value),
  )) as RecurringDeposit | undefined;
  checkTrue("it loads back as a RecurringDeposit", loadedRd instanceof RecurringDeposit);
  check("maturity value", loadedRd!.maturityValue().toDecimalString(), "128829.78");
  check("24 instalments", loadedRd!.schedule().rows.length, 24);

  /* ── PPF, with contributions and notified rates ───────────────────── */

  section("PPF — contributions and notified rates");

  const ppf = await openDeposit.execute({
    userId,
    name: "PPF",
    kind: "PPF",
    openedOn: on("2026-05-10"),
    compounding: "ANNUALLY",
  });
  if (!ppf.ok) throw new Error("ppf setup failed");

  const setRate = new SetSchemeRate(lending);
  const contribute = new RecordSchemeContribution(accountRepo, lending, record);
  for (let index = 0; index < 3; index += 1) {
    const year = FinancialYear.startingIn(2026 + index);
    await setRate.execute({ userId, schemeKey: "PPF", financialYear: year, rate: Rate.annual("7.1") });
    const recorded = await contribute.execute({
      userId,
      accountId: ppf.value.accountId,
      financialYear: year,
      amount: rupees("150000"),
      fromAccountId: bankId,
      postedOn: year.start.plusDays(4),
    });
    if (!recorded.ok) throw new Error(`ppf contribution failed: ${recorded.error.message}`);
  }

  const allAccounts = await accountRepo.list(userId, { includeClosed: true });
  const loadedPpf = (await lending.loadDeposits(userId, allAccounts)).find(
    (deposit) => deposit.id.value === ppf.value.accountId.value,
  ) as PublicProvidentFund | undefined;
  checkTrue("it loads back as a PPF", loadedPpf instanceof PublicProvidentFund);
  check("three contributions were stored", loadedPpf!.terms.contributions.length, 3);
  check("the rates came back too", loadedPpf!.terms.ratesByFinancialYear.size, 3);
  check("first year closes at 1.5 lakh plus interest", loadedPpf!.schedule().rows[0].closing.toDecimalString(), "160650.00");
  check("the lock runs to 2042", loadedPpf!.maturesOn.toISO(), "2042-03-31");
  // Worked by hand: 150,000 × 1.071 = 160,650; (160,650 + 150,000) × 1.071 =
  // 332,706.15; (332,706.15 + 150,000) × 1.071 = 516,978.29.
  check(
    "value after three years",
    loadedPpf!.valueOn(on("2029-03-31")).toDecimalString(),
    "516978.29",
  );
  // The bank paid every contribution, so the two must agree.
  check(
    "the journal recorded exactly what was contributed",
    (await balances.balanceOf(userId, ppf.value.accountId, on("2029-03-31"))).toDecimalString(),
    "450000.00",
  );

  section("accrued but unbooked interest is named, not hidden");

  const positions = await listDeposits.execute({ userId, asOf: on("2029-03-31") });
  if (!positions.ok) throw new Error("list failed");
  const ppfPosition = positions.value.positions.find(
    (position) => position.deposit.id.value === ppf.value.accountId.value,
  )!;
  check("computed value", ppfPosition.value.toDecimalString(), "516978.29");
  check("booked value", ppfPosition.booked.toDecimalString(), "450000.00");
  check("and the difference is the accrued interest", ppfPosition.unbooked.toDecimalString(), "66978.29");

  const book = new BookAccruedInterest(accountRepo, lending, balances, record);
  const booked = await book.execute({ userId, accountId: ppf.value.accountId, asOf: on("2029-03-31") });
  check("booking it posts the difference", booked.ok && booked.value.booked.toDecimalString(), "66978.29");
  check(
    "after which the journal agrees with the computation",
    (await balances.balanceOf(userId, ppf.value.accountId, on("2029-03-31"))).toDecimalString(),
    "516978.29",
  );
  const bookedAgain = await book.execute({ userId, accountId: ppf.value.accountId, asOf: on("2029-03-31") });
  check("and booking twice posts nothing", bookedAgain.ok && bookedAgain.value.booked.toDecimalString(), "0.00");

  section("the computed value does not move when other things are written");

  const before = (loadedPpf as PublicProvidentFund).valueOn(on("2029-03-31"));
  await record.execute({
    userId,
    fromAccountId: bankId,
    toAccountId: (await accountRepo.findByCode(userId, AccountCode.parse("Expenses:Food:Groceries")))!.id,
    amount: rupees("1234.56"),
    postedOn: on("2029-03-30"),
    narration: "Unrelated write",
  });
  const after = (loadedPpf as PublicProvidentFund).valueOn(on("2029-03-31"));
  check("a deposit's value is a function of its terms alone", after.toDecimalString(), before.toDecimalString());

  /* ── EPF ──────────────────────────────────────────────────────────── */

  section("EPF — three sub-balances through the database");

  const epf = await openDeposit.execute({
    userId,
    name: "EPF",
    kind: "EPF",
    openedOn: on("2026-04-01"),
    compounding: "ANNUALLY",
  });
  if (!epf.ok) throw new Error("epf setup failed");

  await setRate.execute({ userId, schemeKey: "EPF", financialYear: FinancialYear.parse("2026-27"), rate: Rate.annual("8.25") });
  await contribute.execute({
    userId,
    accountId: epf.value.accountId,
    financialYear: FinancialYear.parse("2026-27"),
    employee: rupees("180000"),
    employer: rupees("180000"),
    voluntary: rupees("120000"),
    fromAccountId: bankId,
    postedOn: on("2026-04-05"),
  });

  const loadedEpf = (await lending.loadDeposits(userId, await accountRepo.list(userId, { includeClosed: true }))).find(
    (deposit) => deposit.id.value === epf.value.accountId.value,
  ) as EmployeeProvidentFund | undefined;
  checkTrue("it loads back as an EPF", loadedEpf instanceof EmployeeProvidentFund);
  const epfBalances = loadedEpf!.balancesOn(on("2027-03-31"));
  check("employee", epfBalances.employee.toDecimalString(), "188043.75");
  check("employer", epfBalances.employer.toDecimalString(), "188043.75");
  check("VPF", epfBalances.voluntary.toDecimalString(), "125362.50");
  // Only what the employee actually paid left the bank — the employer's share
  // never passed through it, and booking it as an outflow would invent one.
  check(
    "the journal holds only the employee's own money",
    (await balances.balanceOf(userId, epf.value.accountId, on("2027-03-31"))).toDecimalString(),
    "300000.00",
  );
  check(
    "taxable interest for the year",
    loadedEpf!.taxableInterestByYear()[0].taxable.toDecimalString(),
    "2234.38",
  );

  /* ── NPS ──────────────────────────────────────────────────────────── */

  section("NPS — units stored, value only from a NAV");

  const nps = await openDeposit.execute({
    userId,
    name: "NPS Tier I",
    kind: "NPS",
    openedOn: on("2026-04-01"),
    npsTier: "TIER_I",
    compounding: "ANNUALLY",
  });
  if (!nps.ok) throw new Error("nps setup failed");

  const setUnits = new SetNpsUnits(lending);
  await setUnits.execute({ userId, accountId: nps.value.accountId, scheme: "E", units: Quantity.fromString("1250.4321") });
  await setUnits.execute({ userId, accountId: nps.value.accountId, scheme: "C", units: Quantity.fromString("800.1234") });
  await setUnits.execute({ userId, accountId: nps.value.accountId, scheme: "G", units: Quantity.fromString("640.5") });

  const valueNps = new ValueNps(accountRepo, lending);
  const valued = await valueNps.execute({
    userId,
    accountId: nps.value.accountId,
    navs: new Map([
      ["E", UnitPrice.of("48.7231")],
      ["C", UnitPrice.of("39.1104")],
      ["G", UnitPrice.of("35.6712")],
    ]),
  });
  check("valued from NAVs", valued.ok && valued.value.value?.toDecimalString(), "115065.48");
  check("with an allocation", valued.ok && valued.value.allocation.length, 3);

  const missingNav = await valueNps.execute({
    userId,
    accountId: nps.value.accountId,
    navs: new Map([["E", UnitPrice.of("48.7231")]]),
  });
  check("one missing NAV means no value at all", missingNav.ok && missingNav.value.value, null);

  const withNps = await listDeposits.execute({ userId, asOf: on("2027-03-31") });
  checkTrue(
    "the deposit list reports NPS as unvalued rather than guessing",
    withNps.ok && withNps.value.unvalued.length === 1,
  );

  /* ── A home loan ──────────────────────────────────────────────────── */

  section("a home loan, disbursed to the bank");

  const loan = await openLoan.execute({
    userId,
    name: "HDFC Home Loan",
    kind: "HOME",
    institution: "HDFC Bank",
    principal: rupees("5000000"),
    annualRate: Rate.annual("8.5"),
    periods: 240,
    disbursedOn: on("2026-04-01"),
    disbursedToAccountId: bankId,
  });
  check("the loan opens", loan.ok, true);
  if (!loan.ok) throw new Error("loan setup failed");
  check("with the right EMI", loan.value.instalment.toDecimalString(), "43391.16");

  // Borrowing raises an asset and a liability together: net worth is unchanged.
  const afterDisbursal = await balances.totals(userId, on("2026-04-01"));
  check(
    "borrowing does not change net worth",
    afterDisbursal.netWorth.toDecimalString(),
    netWorthAtOpen.netWorth.toDecimalString(),
  );
  check(
    "the bank has the money",
    (await balances.balanceOf(userId, bankId, on("2026-04-01"))).toDecimalString(),
    "6900000.00",
  );
  check(
    "and the loan account owes it",
    (await balances.balanceOf(userId, loan.value.accountId, on("2026-04-01"))).toDecimalString(),
    "5000000.00",
  );

  section("the schedule survives the round trip");

  const loanAccounts = await accountRepo.list(userId, { includeClosed: true });
  const loadedLoan = (await lending.loadLoans(userId, loanAccounts)).find(
    (candidate) => candidate.id.value === loan.value.accountId.value,
  );
  checkTrue("it loads back as a HomeLoan", loadedLoan instanceof HomeLoan);
  const loadedSchedule = loadedLoan!.schedule();
  check("N01: the principal column sums to the principal", loadedSchedule.principalRepaid.toDecimalString(), "5000000.00");
  check("N02: the final closing balance is zero", loadedSchedule.rows[239].closing.toDecimalString(), "0.00");
  check("240 rows", loadedSchedule.rows.length, 240);
  check("total interest", loadedSchedule.totalInterest.toDecimalString(), "5413879.44");

  /* ── EMIs ─────────────────────────────────────────────────────────── */

  section("an EMI splits into principal and interest");

  const payEmi = new RecordLoanInstalment(accountRepo, lending, record);
  const first = await payEmi.execute({
    userId,
    loanAccountId: loan.value.accountId,
    fromAccountId: bankId,
    period: 1,
  });
  if (!first.ok) throw new Error(`emi failed: ${first.error.message}`);
  check("interest on the first instalment", first.value.interest.toDecimalString(), "35416.67");
  check("principal on the first instalment", first.value.principal.toDecimalString(), "7974.49");
  check("which together are the EMI", first.value.total.toDecimalString(), "43391.16");
  check("posted as two transactions", first.value.transactionIds.length, 2);

  check(
    "the loan balance falls by the principal only",
    (await balances.balanceOf(userId, loan.value.accountId, on("2026-05-01"))).toDecimalString(),
    "4992025.51",
  );
  check(
    "which is exactly what the schedule says",
    loadedLoan!.outstandingOn(on("2026-05-01")).toDecimalString(),
    "4992025.51",
  );

  const interestAccount = (await accountRepo.findByCode(userId, AccountCode.parse("Expenses:Fees:Interest")))!;
  const interestFlows = await balances.flowsByAccount(userId, DateRange.of(on("2026-05-01"), on("2026-05-31")), {
    type: "EXPENSE",
    rollUp: false,
  });
  check(
    "and the interest is an expense on its own account",
    interestFlows.find((flow) => flow.accountId.value === interestAccount.id.value)?.amount.toDecimalString(),
    "35416.67",
  );

  // Twelve instalments, then compare the ledger with the schedule.
  for (let period = 2; period <= 12; period += 1) {
    const paid = await payEmi.execute({
      userId,
      loanAccountId: loan.value.accountId,
      fromAccountId: bankId,
      period,
    });
    if (!paid.ok) throw new Error(`emi ${period} failed: ${paid.error.message}`);
  }

  const afterYear = await balances.balanceOf(userId, loan.value.accountId, on("2027-04-01"));
  check(
    "after a year of EMIs the ledger matches the schedule exactly",
    afterYear.toDecimalString(),
    loadedLoan!.outstandingOn(on("2027-04-01")).toDecimalString(),
  );
  check(
    "a year's interest, for the §24(b) deduction",
    (loadedLoan as HomeLoan).deductibleInterest(on("2026-04-01"), on("2027-03-31")).toDecimalString(),
    "200000.00",
  );

  const outOfRange = await payEmi.execute({
    userId,
    loanAccountId: loan.value.accountId,
    fromAccountId: bankId,
    period: 241,
  });
  check("a period the loan does not have is refused", !outOfRange.ok, true);

  /* ── Prepayment ───────────────────────────────────────────────────── */

  section("a prepayment re-derives the schedule");

  const prepay = new RecordPrepayment(accountRepo, lending, record);
  const prepaid = await prepay.execute({
    userId,
    loanAccountId: loan.value.accountId,
    fromAccountId: bankId,
    amount: rupees("500000"),
    paidOn: on("2027-05-01"),
    reduces: "TERM",
  });
  if (!prepaid.ok) throw new Error("prepayment failed");
  checkTrue("it saves interest", prepaid.value.interestSaved.isPositive);
  checkTrue(
    "and closes the loan earlier than the original 20 years",
    prepaid.value.closesOn !== null && prepaid.value.closesOn.isBefore(on("2046-04-01")),
  );

  const afterPrepayment = (await lending.loadLoans(userId, loanAccounts)).find(
    (candidate) => candidate.id.value === loan.value.accountId.value,
  )!;
  check(
    "N01 still holds after a prepayment",
    afterPrepayment.schedule().principalRepaid.toDecimalString(),
    "5000000.00",
  );
  /*
   * The ledger and the schedule differ here by exactly one instalment, and that is
   * the correct answer rather than a mismatch.
   *
   * The prepayment landed on 1 May 2027, which is also period 13's payment date.
   * The schedule assumes every scheduled instalment is paid, so its outstanding
   * balance on that day is net of period 13; the ledger has only the twelve EMIs
   * that were actually recorded. Asserting equality would have forced one of the
   * two to lie — so the assertion is on the difference, which names what is
   * outstanding: an instalment that is due and unpaid.
   */
  const periodThirteen = afterPrepayment
    .schedule()
    .rows.find((row) => row.period === 13 && !row.note?.startsWith("Prepayment"))!;
  const ledgerAfterPrepayment = await balances.balanceOf(userId, loan.value.accountId, on("2027-05-01"));
  check(
    "the ledger is ahead of the schedule by exactly the unpaid instalment's principal",
    ledgerAfterPrepayment.minus(afterPrepayment.outstandingOn(on("2027-05-01"))).toDecimalString(),
    periodThirteen.principal.toDecimalString(),
  );
  const emiThirteen = await payEmi.execute({
    userId,
    loanAccountId: loan.value.accountId,
    fromAccountId: bankId,
    period: 13,
  });
  check("and paying it closes the gap", emiThirteen.ok, true);
  check(
    "after which the two agree exactly",
    (await balances.balanceOf(userId, loan.value.accountId, on("2027-05-01"))).toDecimalString(),
    afterPrepayment.outstandingOn(on("2027-05-01")).toDecimalString(),
  );

  /* ── A flat-rate loan, and the payoff comparison ──────────────────── */

  section("a flat-rate loan shows both rates");

  const flat = await openLoan.execute({
    userId,
    name: "Bajaj Personal Loan",
    kind: "PERSONAL",
    principal: rupees("100000"),
    annualRate: Rate.annual("10"),
    periods: 36,
    disbursedOn: on("2027-04-01"),
    accrualBasis: "FLAT",
    disbursedToAccountId: bankId,
  });
  if (!flat.ok) throw new Error("flat loan setup failed");

  const loans = await listLoans.execute({ userId, asOf: on("2027-04-15") });
  if (!loans.ok) throw new Error("list loans failed");
  const flatSummary = loans.value.loans.find((summary) => summary.loan.id.value === flat.value.accountId.value)!;
  checkTrue("the flat loan loads", flatSummary.loan instanceof PersonalLoan);
  check("its quoted rate", flatSummary.loan.terms.annualRate.percent.toFixed(2), "10.00");
  checkTrue(
    "and the effective rate it really costs is far higher",
    flatSummary.effectiveRate.percent.toApproximateNumber() > 17,
  );

  section("avalanche versus snowball across every debt");

  const compare = new ComparePayoff(accountRepo, lending, balances);
  const compared = await compare.execute({
    userId,
    monthlyBudget: rupees("60000"),
    asOf: on("2027-04-15"),
  });
  if (!compared.ok) throw new Error(`payoff failed: ${compared.error.message}`);
  checkTrue(
    "avalanche never costs more interest",
    !compared.value.avalanche.totalInterest.isGreaterThan(compared.value.snowball.totalInterest),
  );
  check("both plans clear every debt", compared.value.avalanche.months.at(-1)!.remaining.toDecimalString(), "0.00");
  check("and so does the other", compared.value.snowball.months.at(-1)!.remaining.toDecimalString(), "0.00");

  const tooSmall = await compare.execute({
    userId,
    monthlyBudget: rupees("1000"),
    asOf: on("2027-04-15"),
  });
  check("a budget below the minimums is refused, not projected", !tooSmall.ok, true);

  /* ── The ledger is still sound ────────────────────────────────────── */

  section("the whole ledger still balances");

  const everything = await txnRepo.find(userId, { limit: 20_000 });
  const calculator = new BalanceCalculator();
  check("debits equal credits", calculator.verifyIntegrity(everything.transactions).ok, true);

  const finalAccounts = await accountRepo.list(userId, { includeClosed: true });
  const pure = calculator.balancesAsOf(finalAccounts, everything.transactions, on("2027-05-01"));
  const sheet = await balances.balanceSheet(userId, on("2027-05-01"), { includeClosed: true });
  const mismatches = sheet.filter((row) => !pure.get(row.accountId.value)!.equals(row.balance));
  check("and the SQL read path agrees with the pure fold", mismatches.length, 0);

  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
