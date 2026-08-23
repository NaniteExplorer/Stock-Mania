/**
 * Cards, end to end: statements rebuilt from the ledger, a payment that is a
 * transfer, and interest that the postings themselves imply.
 *
 * The Phase 3 gate is asserted twice over, on purpose. `tests/cards.spec.ts`
 * proves the identity holds for a statement built from movements handed to it;
 * this spec proves it holds for a statement **reconstructed from postings** — the
 * path a real card actually takes, where the movement kinds are inferred from
 * which account sits on the other leg.
 */

import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { Percentage, Quantity, Rate } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { AccountCode } from "@/domain/accounts";
import { BillingCycleRule, type CardTerms } from "@/domain/assets";
import { BalanceCalculator } from "@/domain/transactions";
import {
  DrizzleAccountRepository,
  DrizzleBalanceQuery,
  DrizzleCardTermsRepository,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { OpenAccount, RecordTransaction, SeedChartOfAccounts } from "@/app/ledger.usecases";
import {
  AccrueCardCharges,
  ListCards,
  OpenCreditCard,
  PayCard,
  RecordAccountTransfer,
  RecordSpend,
  UpdateCardTerms,
  ViewCard,
} from "@/app/banking.usecases";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/cards-integration.db";
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

  const userId = UserId.from("user_cards_1");
  const now = new Date("2026-09-20T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "cards@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const clock = new FixedClock(now);
  const accountRepo = new DrizzleAccountRepository(db);
  const txnRepo = new DrizzleTransactionRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  const cardTermsRepo = new DrizzleCardTermsRepository(db);
  const record = new RecordTransaction(accountRepo, txnRepo);
  const openAccount = new OpenAccount(accountRepo, txnRepo, clock);

  await new SeedChartOfAccounts(accountRepo).execute({ userId });

  const bank = await openAccount.execute({
    userId,
    name: "HDFC Savings",
    type: "ASSET",
    subtype: "BANK",
    openingBalance: rupees("300000"),
    openingBalanceOn: on("2026-06-30"),
  });
  if (!bank.ok) throw new Error("bank setup failed");

  const TERMS: CardTerms = {
    creditLimit: rupees("200000"),
    cycle: new BillingCycleRule(18, 20),
    financeRate: Rate.annual("42"),
    minimumDuePercent: Percentage.of("5"),
    minimumDueFloor: rupees("500"),
    lateFee: rupees("500"),
    annualFee: rupees("2500"),
    gstOnCharges: Percentage.of("18"),
    pointsPerHundred: Quantity.fromString("4"),
  };

  section("opening a card");

  const opened = await new OpenCreditCard(openAccount, cardTermsRepo).execute({
    userId,
    name: "HDFC Regalia",
    institution: "HDFC Bank",
    accountNumberSuffix: "4021",
    terms: TERMS,
    openingBalance: rupees("18240"),
    openingBalanceOn: on("2026-06-30"),
  });
  check("card opened", opened.ok, true);
  if (!opened.ok) throw new Error("card setup failed");
  const cardId = opened.value.accountId;

  const storedTerms = await cardTermsRepo.findFor(userId, cardId);
  check("terms round-trip: limit", storedTerms?.creditLimit.toDecimalString(), "200000.00");
  check("terms round-trip: finance rate", storedTerms?.financeRate.toString(), "42.0000% p.a. ACT/365F");
  check("terms round-trip: statement day", storedTerms?.cycle.statementDay, 18);
  check("terms round-trip: points", storedTerms?.pointsPerHundred.toDecimalString(), "4");

  section("a card balance reduces net worth with no special case");

  const totalsAtOpen = await balances.totals(userId, on("2026-06-30"));
  check("assets", totalsAtOpen.assets.toDecimalString(), "300000.00");
  check("liabilities", totalsAtOpen.liabilities.toDecimalString(), "18240.00");
  check("net worth is assets less liabilities", totalsAtOpen.netWorth.toDecimalString(), "281760.00");

  const accounts = await accountRepo.list(userId, { includeClosed: true });
  const everythingAtOpen = await txnRepo.find(userId, { limit: 5000 });
  const pureAtOpen = new BalanceCalculator().netWorthAsOf(accounts, everythingAtOpen.transactions, on("2026-06-30"));
  check("and the pure fold agrees", pureAtOpen.netWorth.toDecimalString(), "281760.00");

  section("a cycle of card activity");

  const spend = new RecordSpend(accountRepo, record);
  const groceries = (await accountRepo.findByCode(userId, AccountCode.parse("Expenses:Food:Groceries")))!;
  const electronics = (await accountRepo.findByCode(userId, AccountCode.parse("Expenses:Shopping:Electronics")))!;
  const eatingOut = (await accountRepo.findByCode(userId, AccountCode.parse("Expenses:Food:Eating Out")))!;

  const card = (await accountRepo.findById(userId, cardId))!;

  // July's cycle closes on the 18th. These four land inside it.
  const spends: [string, string, typeof groceries][] = [
    ["2026-06-22", "12499.00", electronics],
    ["2026-07-02", "8347.63", groceries],
    ["2026-07-09", "9999.00", eatingOut],
    ["2026-07-14", "2002.00", eatingOut],
  ];
  for (const [date, amount, category] of spends) {
    const result = await spend.execute({
      userId,
      fromAccountId: cardId,
      categoryAccountId: category.id,
      amount: rupees(amount),
      postedOn: on(date),
      narration: `Card spend ${date}`,
    });
    if (!result.ok) throw new Error(`spend failed: ${result.error.message}`);
  }

  // A refund: credited back to the category, reducing the debt.
  const refund = await record.execute({
    userId,
    fromAccountId: electronics.id,
    toAccountId: cardId,
    amount: rupees("1299.00"),
    postedOn: on("2026-06-28"),
    narration: "Returned headphones",
  });
  check("a refund records", refund.ok, true);

  // Paying the opening balance off, from the bank.
  const payment = await new PayCard(
    accountRepo,
    new RecordAccountTransfer(accountRepo, record),
  ).execute({
    userId,
    fromAccountId: bank.value.accountId,
    cardAccountId: cardId,
    amount: rupees("18240.00"),
    postedOn: on("2026-06-25"),
  });
  check("the payment records", payment.ok, true);

  section("a card payment is a Transfer, never an expense");

  const paymentPage = await txnRepo.find(userId, {
    accountIds: [cardId],
    range: DateRange.of(on("2026-06-25"), on("2026-06-25")),
    limit: 10,
  });
  check("it is a TRANSFER", paymentPage.transactions[0]?.kind, "TRANSFER");
  checkTrue(
    "and it carries no budget category on either leg (L12)",
    paymentPage.transactions[0]!.postings().every((posting) => posting.categoryId === null),
  );

  // The claim that matters: expenses for the month are the four spends less the
  // refund — the ₹18,240 payment inflates nothing.
  const juneFlows = await balances.flowsByAccount(
    userId,
    DateRange.of(on("2026-06-01"), on("2026-06-30")),
    { type: "EXPENSE", rollUp: false },
  );
  const juneElectronics = juneFlows.find((flow) => flow.code === "Expenses:Shopping:Electronics");
  check("June electronics is the spend less the refund", juneElectronics?.amount.toDecimalString(), "11200.00");
  const juneTotal = Money.total(juneFlows.map((flow) => flow.amount));
  check("and June's total expense excludes the card payment", juneTotal.toDecimalString(), "11200.00");

  section("the statement, rebuilt from postings — the Phase 3 gate");

  const view = new ViewCard(accountRepo, txnRepo, balances, cardTermsRepo);
  const detail = await view.execute({ userId, accountId: cardId, asOf: on("2026-07-18"), cycles: 2 });
  if (!detail.ok) throw new Error("card view failed");

  const july = detail.value.statements[detail.value.statements.length - 1];
  check("the cycle closes on 18 July", july.cycle.through.toISO(), "2026-07-18");
  check("and is due 20 days later", july.cycle.dueOn.toISO(), "2026-08-07");
  // The cycle runs 19 June – 18 July, so it holds everything: the card was opened
  // on 30 June and its whole life so far falls inside this one statement.
  check("nothing had happened before 19 June", july.opening.toDecimalString(), "0.00");
  // The four purchases: 12,499.00 + 8,347.63 + 9,999.00 + 2,002.00.
  check("July's spends", july.spends.toDecimalString(), "32847.63");
  // The ₹18,240 the card arrived owing is a charge, not spending — counted as a
  // spend it would earn reward points for debt that was never a purchase.
  check("the opening balance shows as a charge", july.charges.toDecimalString(), "18240.00");
  check("the payment that cleared it", july.payments.toDecimalString(), "18240.00");
  check("the returned headphones", july.refunds.toDecimalString(), "1299.00");
  check("July's closing balance", july.closing.toDecimalString(), "31548.63");

  checkTrue(
    "opening + spends + charges − payments − refunds = closing, exactly",
    july.opening
      .plus(july.spends)
      .plus(july.charges)
      .minus(july.payments)
      .minus(july.refunds)
      .equals(july.closing),
  );

  // And the closing balance of the statement is the ledger's own balance on the
  // statement date — the two are computed by different paths and must agree.
  const ledgerOnStatementDate = await balances.balanceOf(userId, cardId, on("2026-07-18"));
  check(
    "the statement's closing balance is the ledger's balance that day",
    july.closing.toDecimalString(),
    ledgerOnStatementDate.toDecimalString(),
  );

  check("minimum due is 5% of the closing balance", july.minimumDue.toDecimalString(), "1577.43");
  check("utilisation", detail.value.utilisation.toFixed(2), "15.77");
  check("available credit", detail.value.available.toDecimalString(), "168451.37");
  // 4 points per complete hundred of the 32,847.63 spent — 328 hundreds × 4.
  check("points earned on spending, not on the opening debt", detail.value.points.points.toDecimalString(), "1312");

  section("a mid-cycle purchase is spend now and bill later");

  const late = await spend.execute({
    userId,
    fromAccountId: cardId,
    categoryAccountId: groceries.id,
    amount: rupees("5000.00"),
    postedOn: on("2026-07-19"),
    narration: "Bought the day after the statement",
  });
  check("it records", late.ok, true);

  const afterLate = await view.execute({ userId, accountId: cardId, asOf: on("2026-07-19"), cycles: 2 });
  if (!afterLate.ok) throw new Error("card view failed");
  const julyAgain = afterLate.value.statements.find((statement) => statement.cycle.label === "2026-07")!;
  check("July's statement is unchanged", julyAgain.closing.toDecimalString(), "31548.63");
  check("but the debt today is higher", afterLate.value.owed.toDecimalString(), "36548.63");

  const augustFlows = await balances.flowsByAccount(
    userId,
    DateRange.of(on("2026-07-01"), on("2026-07-31")),
    { type: "EXPENSE", rollUp: false },
  );
  const julyGroceries = augustFlows.find((flow) => flow.code === "Expenses:Food:Groceries");
  check("and it is July spending by the calendar", julyGroceries?.amount.toDecimalString(), "13347.63");

  section("interest on a revolved balance");

  // Nothing was paid against July's statement, so the balance revolves past its
  // 7 August due date and interest accrues from there.
  const accrue = new AccrueCardCharges(accountRepo, txnRepo, balances, cardTermsRepo, record);
  const accrued = await accrue.execute({
    userId,
    cardAccountId: cardId,
    statementDate: on("2026-08-18"),
  });
  if (!accrued.ok) throw new Error(`accrual failed: ${accrued.error.message}`);

  checkTrue("interest was charged", accrued.value.interest.isPositive);
  checkTrue("and its GST", accrued.value.gst.isPositive);
  check(
    "GST is 18% of the interest",
    accrued.value.gst.toDecimalString(),
    Percentage.of("18").applyTo(accrued.value.interest).toDecimalString(),
  );

  // The charge is an expense, and it is on the interest account — not folded into
  // any spending category.
  const interestFlows = await balances.flowsByAccount(
    userId,
    DateRange.of(on("2026-08-01"), on("2026-08-31")),
    { type: "EXPENSE", rollUp: false },
  );
  const interestPaid = interestFlows.find((flow) => flow.code === "Expenses:Fees:Interest");
  check(
    "interest lands on Expenses:Fees:Interest",
    interestPaid?.amount.toDecimalString(),
    accrued.value.interest.toDecimalString(),
  );

  const augustStatement = await view.execute({ userId, accountId: cardId, asOf: on("2026-08-18"), cycles: 1 });
  if (!augustStatement.ok) throw new Error("card view failed");
  const august = augustStatement.value.statements[0];
  checkTrue("August's statement shows the interest as a charge, not a spend", august.charges.isPositive);
  checkTrue(
    "and its identity still holds",
    august.opening
      .plus(august.spends)
      .plus(august.charges)
      .minus(august.payments)
      .minus(august.refunds)
      .equals(august.closing),
  );

  const ledgerOnAugust = await balances.balanceOf(userId, cardId, on("2026-08-18"));
  check(
    "August's closing balance is the ledger's",
    august.closing.toDecimalString(),
    ledgerOnAugust.toDecimalString(),
  );

  section("a late fee, with its GST");

  const withLateFee = await accrue.execute({
    userId,
    cardAccountId: cardId,
    statementDate: on("2026-09-18"),
    lateFeeApplies: true,
  });
  if (!withLateFee.ok) throw new Error("accrual failed");
  check("the late fee", withLateFee.value.fees.toDecimalString(), "500.00");
  checkTrue("and the GST covers both the fee and the interest", withLateFee.value.gst.isPositive);

  section("the card list");

  const list = await new ListCards(accountRepo, txnRepo, balances, cardTermsRepo).execute({
    userId,
    asOf: on("2026-09-20"),
  });
  if (!list.ok) throw new Error("list failed");
  check("one card", list.value.cards.length, 1);
  const summary = list.value.cards[0];
  check("the statement quoted is the one that has closed", summary.statement.cycle.through.toISO(), "2026-09-18");
  check("days to its due date", summary.daysToDue, 18);
  checkTrue("something is owed", summary.owed.isPositive);
  check(
    "and utilisation is owed over limit",
    summary.utilisation.toFixed(2),
    Percentage.ratio(summary.owed, rupees("200000")).toFixed(2),
  );

  section("terms can be updated without touching a posting");

  const before = await balances.balanceOf(userId, cardId, on("2026-09-20"));
  const updated = await new UpdateCardTerms(accountRepo, cardTermsRepo).execute({
    userId,
    accountId: cardId,
    terms: { ...TERMS, creditLimit: rupees("300000") },
  });
  check("the limit is raised", updated.ok, true);
  const after = await balances.balanceOf(userId, cardId, on("2026-09-20"));
  check("and no balance moved", after.toDecimalString(), before.toDecimalString());
  const raised = await cardTermsRepo.findFor(userId, cardId);
  check("the new limit is stored", raised?.creditLimit.toDecimalString(), "300000.00");

  const notACard = await new UpdateCardTerms(accountRepo, cardTermsRepo).execute({
    userId,
    accountId: bank.value.accountId,
    terms: TERMS,
  });
  check("a bank account cannot take card terms", !notACard.ok, true);

  section("the ledger is still internally consistent");

  const finalPage = await txnRepo.find(userId, { limit: 20_000 });
  check("debits equal credits", new BalanceCalculator().verifyIntegrity(finalPage.transactions).ok, true);
  check("card is a liability throughout", card.type.netWorthSign, -1);

  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
