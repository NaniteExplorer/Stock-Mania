import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { UserId, FixedClock } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import { AccountCode } from "@/domain/accounts";
import { AccountType } from "@/domain/accounts";
import { BalanceCalculator } from "@/domain/transactions";
import { DrizzleAccountRepository } from "@/infra/repositories";
import { DrizzleJournalRepository } from "@/infra/repositories";
import { DrizzleBalanceQuery } from "@/infra/repositories";
import { SeedChartOfAccounts } from "@/app/ledger.usecases";
import { OpenAccount } from "@/app/ledger.usecases";
import { RecordTransaction } from "@/app/ledger.usecases";
import { ReverseTransaction } from "@/app/ledger.usecases";
import { check, throws, done } from "./harness";


const DB_FILE = "./tmp/integration.db";

async function main() {
  for (const suffix of ["", "-shm", "-wal"]) {
    try { rmSync(DB_FILE + suffix); } catch { /* not there */ }
  }

  const client = createClient({ url: "file:" + DB_FILE });
  const db = drizzle(client, { schema }) as unknown as Database;

  // Apply the generated migrations exactly as production would.
  const dir = "./src/infra/db/migrations";
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sqlText = readFileSync(`${dir}/${file}`, "utf8");
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.execute(trimmed);
    }
  }
  console.log("migrations applied\n");

  const userId = UserId.from("user_integration_1");
  const now = new Date("2026-08-05T10:00:00Z");
  await db.insert(users).values({
    id: userId.value, name: "Test", email: "test@example.com",
    emailVerified: true, createdAt: now, updatedAt: now,
  });

  const clock = new FixedClock(now);
  const accountRepo = new DrizzleAccountRepository(db);
  const journalRepo = new DrizzleJournalRepository(db);
  const balances = new DrizzleBalanceQuery(db);

  const seed = new SeedChartOfAccounts(accountRepo);
  const openAccount = new OpenAccount(accountRepo, journalRepo, clock);
  const record = new RecordTransaction(accountRepo, journalRepo);
  const reverse = new ReverseTransaction(journalRepo, clock);

  console.log("-- seeding is idempotent --");
  const first = await seed.execute({ userId });
  check("first seed creates the chart", first.ok && first.value.created, 68);
  const second = await seed.execute({ userId });
  check("second seed creates nothing", second.ok && second.value.created, 0);

  console.log("\n-- opening accounts, with opening balances --");
  const hdfc = await openAccount.execute({
    userId, name: "HDFC Savings", type: "ASSET", subtype: "BANK", institution: "HDFC Bank",
    accountNumberSuffix: "4321", openingBalance: Money.fromRupees("200000"),
    openingBalanceOn: CalendarDate.parse("2026-07-01"),
  });
  check("HDFC opened", hdfc.ok && hdfc.value.code, "Assets:HDFC Savings");
  const card = await openAccount.execute({
    userId, name: "ICICI Amazon Pay", type: "LIABILITY", subtype: "CREDIT_CARD",
    openingBalance: Money.fromRupees("15000"), openingBalanceOn: CalendarDate.parse("2026-07-01"),
  });
  check("card opened", card.ok, true);
  const dup = await openAccount.execute({ userId, name: "HDFC Savings", type: "ASSET" });
  check("duplicate name gets a distinct code", dup.ok && dup.value.code, "Assets:HDFC Savings 2");
  const equityRejected = await openAccount.execute({ userId, name: "Sneaky", type: "EQUITY" });
  check("equity cannot be user-created", !equityRejected.ok, true);

  if (!hdfc.ok || !card.ok) throw new Error("setup failed");
  const hdfcId = hdfc.value.accountId;
  const cardId = card.value.accountId;

  const groceries = (await accountRepo.findByCode(userId, AccountCode.parse("Expenses:Food:Groceries")))!;
  const salaryAcct = (await accountRepo.findByCode(userId, AccountCode.parse("Income:Salary")))!;
  const rent = (await accountRepo.findByCode(userId, AccountCode.parse("Expenses:Housing:Rent")))!;

  console.log("\n-- recording a month of real activity --");
  const tx = async (from: typeof hdfcId, to: typeof hdfcId, amount: string, date: string, what: string) => {
    const r = await record.execute({
      userId, fromAccountId: from, toAccountId: to,
      amount: Money.fromRupees(amount), postedOn: CalendarDate.parse(date), narration: what,
    });
    if (!r.ok) throw new Error(what + ": " + r.error.message);
    return r.value;
  };

  const salaryEntry = await tx(salaryAcct.id, hdfcId, "150000", "2026-08-01", "August salary");
  check("salary derived as INCOME", salaryEntry.kind, "INCOME");
  const groceryEntry = await tx(cardId, groceries.id, "1240", "2026-08-03", "Big Bazaar");
  check("card spend derived as EXPENSE", groceryEntry.kind, "EXPENSE");
  const payment = await tx(hdfcId, cardId, "16240", "2026-08-04", "Card payment");
  check("card payment derived as TRANSFER", payment.kind, "TRANSFER");
  await tx(hdfcId, rent.id, "35000", "2026-08-05", "August rent");
  await tx(hdfcId, groceries.id, "2100", "2026-07-20", "July groceries");

  console.log("\n-- validation --");
  const sameAccount = await record.execute({
    userId, fromAccountId: hdfcId, toAccountId: hdfcId, amount: Money.fromRupees("100"),
    postedOn: CalendarDate.parse("2026-08-05"), narration: "nope",
  });
  check("same account rejected", !sameAccount.ok, true);
  const negative = await record.execute({
    userId, fromAccountId: hdfcId, toAccountId: groceries.id, amount: Money.fromRupees("-5"),
    postedOn: CalendarDate.parse("2026-08-05"), narration: "nope",
  });
  check("negative amount rejected", !negative.ok, true);

  console.log("\n-- import dedupe --");
  const fp = "fingerprint-abc-123";
  const imported = await record.execute({
    userId, fromAccountId: hdfcId, toAccountId: groceries.id, amount: Money.fromRupees("500"),
    postedOn: CalendarDate.parse("2026-08-06"), narration: "Imported row", source: "IMPORT", fingerprint: fp,
  });
  check("first import lands", imported.ok, true);
  const reimported = await record.execute({
    userId, fromAccountId: hdfcId, toAccountId: groceries.id, amount: Money.fromRupees("500"),
    postedOn: CalendarDate.parse("2026-08-06"), narration: "Imported row", source: "IMPORT", fingerprint: fp,
  });
  check("re-import is skipped, not duplicated", !reimported.ok, true);

  // ── The claim under test: SQL read path == pure domain fold ────────────────
  console.log("\n== SQL BalanceQuery vs pure BalanceCalculator ==");
  const asOf = CalendarDate.parse("2026-08-31");
  const allAccounts = await accountRepo.list(userId, { includeClosed: true });
  const page = await journalRepo.find(userId, { limit: 10_000 });
  const calc = new BalanceCalculator();
  const pure = calc.balancesAsOf(allAccounts, page.entries, asOf);
  const sqlSheet = await balances.balanceSheet(userId, asOf, { includeClosed: true });

  let mismatches = 0;
  for (const row of sqlSheet) {
    const expected = pure.get(row.accountId.value)!;
    if (!expected.equals(row.balance)) {
      mismatches++;
      console.log(`   MISMATCH ${row.code}: sql=${row.balance.toDecimalString()} pure=${expected.toDecimalString()}`);
    }
  }
  check("every balance-sheet account agrees", mismatches, 0);

  const byCode = new Map(sqlSheet.map((r) => [r.code, r.balance.toDecimalString()]));
  // 200000 opening + 150000 salary - 16240 card payment - 35000 rent - 2100 groceries - 500 imported
  check("HDFC balance", byCode.get("Assets:HDFC Savings"), "296160.00");
  // 15000 opening debt + 1240 card spend - 16240 payment
  check("credit card balance", byCode.get("Liabilities:ICICI Amazon Pay"), "0.00");

  const sqlTotals = await balances.totals(userId, asOf);
  const pureNw = calc.netWorthAsOf(allAccounts, page.entries, asOf);
  check("assets agree", sqlTotals.assets.toDecimalString(), pureNw.assets.toDecimalString());
  check("liabilities agree", sqlTotals.liabilities.toDecimalString(), pureNw.liabilities.toDecimalString());
  check("net worth agrees", sqlTotals.netWorth.toDecimalString(), pureNw.netWorth.toDecimalString());
  check("net worth value", sqlTotals.netWorth.toDecimalString(), "296160.00");

  console.log("\n-- ledger integrity over the whole store --");
  const integrity = calc.verifyIntegrity(page.entries);
  check("debits == credits in the database", integrity.ok, true);

  console.log("\n-- monthly flows --");
  const flows = await balances.monthlyFlows(userId, DateRange.of(CalendarDate.parse("2026-07-01"), asOf));
  check("two months returned", flows.length, 2);
  const july = flows.find((f) => f.month === "2026-07")!;
  const august = flows.find((f) => f.month === "2026-08")!;
  check("July income", july.income.toDecimalString(), "0.00");
  check("July expense", july.expense.toDecimalString(), "2100.00");
  check("August income", august.income.toDecimalString(), "150000.00");
  check("August expense (1240+35000+500)", august.expense.toDecimalString(), "36740.00");

  console.log("\n-- category rollup --");
  const cats = await balances.flowsByAccount(userId, DateRange.monthOf(CalendarDate.parse("2026-08-15")), {
    type: "EXPENSE", rollUp: true,
  });
  const catByCode = new Map(cats.map((c) => [c.code, c.amount.toDecimalString()]));
  check("leaf groceries", catByCode.get("Expenses:Food:Groceries"), "1740.00");
  check("parent Expenses:Food rolls up", catByCode.get("Expenses:Food"), "1740.00");
  check("root Expenses rolls up everything", catByCode.get("Expenses"), "36740.00");

  console.log("\n-- reversal, end to end --");
  const rev = await reverse.execute({ userId, entryId: groceryEntry.entryId });
  check("reversal saved", rev.ok, true);
  const afterReversal = await balances.totals(userId, asOf);
  // The spend was already paid off in full, so un-spending it leaves the card
  // overpaid by exactly the reversed amount — a credit balance of -1240.
  check("reversal moves the card by exactly -1240",
    afterReversal.liabilities.toDecimalString(), "-1240.00");
  const twice = await reverse.execute({ userId, entryId: groceryEntry.entryId });
  check("cannot reverse the same entry twice", !twice.ok, true);
  const reReversed = await journalRepo.find(userId, { limit: 10_000 });
  check("history preserved (nothing deleted)", reReversed.entries.length, page.entries.length + 1);
  check("still balanced after reversal", calc.verifyIntegrity(reReversed.entries).ok, true);

  console.log("\n-- balance series --");
  const series = await balances.balanceSeries(userId, hdfcId, DateRange.monthOf(CalendarDate.parse("2026-08-15")));
  check("series ends at the current balance", series[series.length - 1].balance.toDecimalString(), "296160.00");

  console.log("\n-- user scoping --");
  const otherUser = UserId.from("user_integration_2");
  await db.insert(users).values({
    id: otherUser.value, name: "Other", email: "other@example.com",
    emailVerified: true, createdAt: now, updatedAt: now,
  });
  const otherSheet = await balances.balanceSheet(otherUser, asOf, { includeClosed: true });
  check("another user sees nothing", otherSheet.length, 0);
  const otherTotals = await balances.totals(otherUser, asOf);
  check("another user's net worth is zero", otherTotals.netWorth.toDecimalString(), "0.00");
  check("cross-user findById returns null", await accountRepo.findById(otherUser, hdfcId), null);

  client.close();
  done();
}

main().catch((e) => { console.error(e); process.exit(1); });
