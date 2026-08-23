/**
 * The Phase 2 gate: a year of statements, checked against an independent tally.
 *
 * The plan says "a year of real statements imports, categorises, and the register
 * and net worth agree with a hand-checked spreadsheet to the paisa". The
 * spreadsheet is {@link buildYear}: it emits the statement lines **and** keeps its
 * own running balance and its own per-category totals, in exact `bigint` paise,
 * with arithmetic that never touches the ledger. The assertions then compare
 * three independently-derived answers:
 *
 *   1. the fixture's own running balance,
 *   2. the closing balance printed on the last line,
 *   3. `BalanceQuery.balanceOf` — a `SUM` over postings in SQL.
 *
 * All three must agree to the paisa. If the importer drops a row, doubles one,
 * flips a direction or rounds anything, at least one of the three moves.
 */

import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import { AccountCode } from "@/domain/accounts";
import { BalanceCalculator } from "@/domain/transactions";
import { checkBalanceContinuity, parseDelimitedText, parseStatementRows } from "@/infra/statements";
import {
  DrizzleAccountRepository,
  DrizzleBalanceQuery,
  DrizzleCategoryRuleRepository,
  DrizzleImportRepository,
  DrizzleSelfPayeeQuery,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { OpenAccount, RecordTransaction, SeedChartOfAccounts } from "@/app/ledger.usecases";
import {
  ConfirmUnmatchedRows,
  OpenCashAccount,
  PostImportBatch,
  SeedCategoryRules,
  StageStatementImport,
} from "@/app/banking.usecases";
import { check, done, section } from "./harness";

const DB_FILE = "./tmp/banking-year.db";

/* ═══ The spreadsheet ═════════════════════════════════════════════════ */

interface Line {
  date: string;
  narration: string;
  reference: string;
  /** Paise, positive for a credit. */
  paise: bigint;
  /** The account code the categoriser is expected to choose. */
  expectedCode: string;
}

/**
 * A year of plausible statement activity, generated so the expected totals are
 * computed by this function rather than read back from the thing under test.
 *
 * Amounts deliberately carry paise that do not divide evenly (₹1,234.57,
 * ₹843.33), because a rounding bug hides perfectly behind round numbers.
 */
function buildYear(): {
  csv: string;
  openingPaise: bigint;
  closingPaise: bigint;
  byCode: Map<string, bigint>;
  monthly: Map<string, { inPaise: bigint; outPaise: bigint }>;
  lineCount: number;
} {
  const openingPaise = 20_000_000n; // ₹2,00,000.00
  const lines: Line[] = [];

  for (let month = 4; month <= 15; month += 1) {
    // April 2026 through March 2027 — one Indian financial year.
    const year = month <= 12 ? 2026 : 2027;
    const mm = String(month <= 12 ? month : month - 12).padStart(2, "0");
    const nudge = BigInt(month); // makes every month's figures distinct

    lines.push({
      date: `01/${mm}/${year}`,
      narration: "SALARY CREDIT ANANDA LTD",
      reference: `SAL${year}${mm}`,
      paise: 12_500_000n + nudge * 100n,
      expectedCode: "Income:Salary",
    });
    lines.push({
      date: `03/${mm}/${year}`,
      narration: "NEFT DR RENT LANDLORD",
      reference: `RENT${year}${mm}`,
      paise: -(1_850_000n + nudge * 33n),
      expectedCode: "Expenses:Housing:Rent",
    });
    lines.push({
      date: `07/${mm}/${year}`,
      narration: "UPI-ZEPTO MARKETPLACE GROCERY",
      reference: "",
      paise: -(123_457n + nudge * 7n),
      expectedCode: "Expenses:Food:Groceries",
    });
    lines.push({
      date: `12/${mm}/${year}`,
      narration: "UPI-SWIGGY ORDER DINNER",
      reference: "",
      paise: -(84_333n + nudge * 11n),
      expectedCode: "Expenses:Food:Eating Out",
    });
    lines.push({
      date: `18/${mm}/${year}`,
      narration: "TPCODL ELECTRICITY BILL",
      reference: `ELEC${year}${mm}`,
      paise: -(234_011n + nudge * 3n),
      expectedCode: "Expenses:Utilities:Electricity",
    });
    lines.push({
      date: `22/${mm}/${year}`,
      narration: "JIO RECHARGE PREPAID",
      reference: "",
      paise: -(29_900n),
      expectedCode: "Expenses:Utilities:Mobile",
    });
    // A second, identical grocery run in the same month: two real transactions
    // that differ in nothing the fingerprint can see except their occurrence.
    lines.push({
      date: `07/${mm}/${year}`,
      narration: "UPI-ZEPTO MARKETPLACE GROCERY",
      reference: "",
      paise: -(123_457n + nudge * 7n),
      expectedCode: "Expenses:Food:Groceries",
    });
  }

  const byCode = new Map<string, bigint>();
  const monthly = new Map<string, { inPaise: bigint; outPaise: bigint }>();
  let running = openingPaise;

  // Statement order: by date, as a bank prints it. The two identical grocery rows
  // land next to each other, which is exactly the case `occurrence` exists for.
  const ordered = [...lines].sort((a, b) => isoOf(a.date).localeCompare(isoOf(b.date)));

  const rows: string[] = ["Date,Narration,Chq/Ref No,Withdrawal (Dr),Deposit (Cr),Closing Balance"];
  for (const line of ordered) {
    running += line.paise;
    const debit = line.paise < 0n ? decimal(-line.paise) : "";
    const credit = line.paise > 0n ? decimal(line.paise) : "";
    rows.push(
      `${line.date},${line.narration},${line.reference},${debit},${credit},${decimal(running)}`,
    );

    byCode.set(line.expectedCode, (byCode.get(line.expectedCode) ?? 0n) + abs(line.paise));

    const monthKey = isoOf(line.date).slice(0, 7);
    const bucket = monthly.get(monthKey) ?? { inPaise: 0n, outPaise: 0n };
    if (line.paise > 0n) bucket.inPaise += line.paise;
    else bucket.outPaise += -line.paise;
    monthly.set(monthKey, bucket);
  }

  return {
    csv: rows.join("\n"),
    openingPaise,
    closingPaise: running,
    byCode,
    monthly,
    lineCount: ordered.length,
  };
}

const abs = (value: bigint) => (value < 0n ? -value : value);

/** Paise to a plain decimal string — no floats anywhere in the fixture either. */
function decimal(paise: bigint): string {
  const negative = paise < 0n;
  const magnitude = abs(paise);
  const whole = magnitude / 100n;
  const fraction = magnitude % 100n;
  return `${negative ? "-" : ""}${whole}.${String(fraction).padStart(2, "0")}`;
}

function isoOf(ddmmyyyy: string): string {
  const [dd, mm, yyyy] = ddmmyyyy.split("/");
  return `${yyyy}-${mm}-${dd}`;
}

/* ═══ The run ═════════════════════════════════════════════════════════ */

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

  const userId = UserId.from("user_year_1");
  const now = new Date("2027-04-01T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "year@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const clock = new FixedClock(now);
  const accountRepo = new DrizzleAccountRepository(db);
  const txnRepo = new DrizzleTransactionRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  const importRepo = new DrizzleImportRepository(db);
  const record = new RecordTransaction(accountRepo, txnRepo);

  await new SeedChartOfAccounts(accountRepo).execute({ userId });
  await new SeedCategoryRules(
    accountRepo,
    new DrizzleCategoryRuleRepository(db),
  ).execute({ userId });

  const year = buildYear();

  const opened = await new OpenCashAccount(
    accountRepo,
    new OpenAccount(accountRepo, txnRepo, clock),
  ).execute({
    userId,
    name: "HDFC Salary",
    subtype: "BANK",
    institution: "HDFC Bank",
    openingBalance: Money.fromMinor(year.openingPaise),
    openingBalanceOn: CalendarDate.parse("2026-03-31"),
  });
  if (!opened.ok) throw new Error("could not open the account");
  const accountId = opened.value.accountId;

  section("the statement parses exactly");

  const statement = parseStatementRows(parseDelimitedText(year.csv));
  check("every line read", statement.rows.length, year.lineCount);
  check("nothing unreadable", statement.problems.length, 0);
  const continuity = checkBalanceContinuity(statement.rows);
  check("continuity checked across the year", continuity.checked, year.lineCount - 1);
  check("with no break", continuity.breaks.length, 0);
  check(
    "and the printed closing balance is the fixture's own running total",
    statement.rows[statement.rows.length - 1].balanceAfter?.toDecimalString(),
    Money.fromMinor(year.closingPaise).toDecimalString(),
  );

  section("a year imports in one batch");

  const stage = new StageStatementImport(
    accountRepo,
    txnRepo,
    importRepo,
    new DrizzleCategoryRuleRepository(db),
    new DrizzleSelfPayeeQuery(db),
  );
  const staged = await stage.execute({
    userId,
    accountId,
    fileName: "hdfc-fy2026-27.csv",
    fileHash: "sha256-year",
    statement,
  });
  check("all rows staged", staged.ok && staged.value.rowsStaged, year.lineCount);
  check("none looks like a duplicate", staged.ok && staged.value.rowsLikelyDuplicate, 0);
  if (!staged.ok) throw new Error("staging failed");

  const confirmed = await new ConfirmUnmatchedRows(importRepo).execute({
    userId,
    batchId: staged.value.batchId,
  });
  check("every row was categorised, so every row confirms", confirmed.ok && confirmed.value.confirmed, year.lineCount);
  check("none needed a manual choice", confirmed.ok && confirmed.value.needingChoice, 0);

  const posted = await new PostImportBatch(importRepo, accountRepo, record, clock).execute({
    userId,
    batchId: staged.value.batchId,
  });
  check("every row posted", posted.ok && posted.value.posted, year.lineCount);
  check("with no problems", posted.ok && posted.value.failed, 0);
  // The duplicated grocery row each month is the case this proves: 12 pairs of
  // otherwise identical rows, all 24 posted.
  check("including both halves of each identical pair", posted.ok && posted.value.posted, 84);

  section("three independent answers agree to the paisa");

  const asOf = CalendarDate.parse("2027-03-31");
  const sqlBalance = await balances.balanceOf(userId, accountId, asOf);
  check("SQL sum over postings", sqlBalance.toDecimalString(), Money.fromMinor(year.closingPaise).toDecimalString());
  check(
    "equals the statement's printed closing balance",
    sqlBalance.equals(statement.rows[statement.rows.length - 1].balanceAfter!),
    true,
  );

  const allAccounts = await accountRepo.list(userId, { includeClosed: true });
  const everything = await txnRepo.find(userId, { limit: 20_000 });
  const calculator = new BalanceCalculator();
  const pure = calculator.balancesAsOf(allAccounts, everything.transactions, asOf);
  check(
    "and the pure fold over the same data",
    pure.get(accountId.value)?.toDecimalString(),
    sqlBalance.toDecimalString(),
  );
  check("the ledger balances, debits to credits", calculator.verifyIntegrity(everything.transactions).ok, true);

  section("categorisation matches the tally, category by category");

  const fyRange = DateRange.of(CalendarDate.parse("2026-04-01"), asOf);
  const flows = await balances.flowsByAccount(userId, fyRange, { rollUp: false });
  const actualByCode = new Map(flows.map((flow) => [flow.code, flow.amount]));

  let categoryMismatches = 0;
  for (const [code, expectedPaise] of year.byCode) {
    const actual = actualByCode.get(code);
    const expected = Money.fromMinor(expectedPaise);
    if (!actual || !actual.equals(expected)) {
      categoryMismatches += 1;
      console.log(
        `   MISMATCH ${code}: expected ${expected.toDecimalString()}, got ${actual?.toDecimalString() ?? "nothing"}`,
      );
    }
  }
  check("every category total is exact", categoryMismatches, 0);
  check("and nothing landed in Uncategorized", actualByCode.get("Expenses:Uncategorized"), undefined);

  section("monthly flows match the tally, month by month");

  const monthlyFlows = await balances.monthlyFlows(userId, fyRange);
  check("twelve months reported", monthlyFlows.length, 12);

  let monthMismatches = 0;
  for (const flow of monthlyFlows) {
    const expected = year.monthly.get(flow.month);
    if (!expected) {
      monthMismatches += 1;
      continue;
    }
    if (
      !flow.income.equals(Money.fromMinor(expected.inPaise)) ||
      !flow.expense.equals(Money.fromMinor(expected.outPaise))
    ) {
      monthMismatches += 1;
      console.log(
        `   MISMATCH ${flow.month}: in ${flow.income.toDecimalString()} vs ${decimal(expected.inPaise)}, ` +
          `out ${flow.expense.toDecimalString()} vs ${decimal(expected.outPaise)}`,
      );
    }
  }
  check("every month is exact", monthMismatches, 0);

  section("net worth");

  const totals = await balances.totals(userId, asOf);
  check(
    "net worth is the account balance, nothing else being held",
    totals.netWorth.toDecimalString(),
    Money.fromMinor(year.closingPaise).toDecimalString(),
  );
  const pureNetWorth = calculator.netWorthAsOf(allAccounts, everything.transactions, asOf);
  check("and the pure fold agrees", pureNetWorth.netWorth.toDecimalString(), totals.netWorth.toDecimalString());

  section("re-importing the same year adds nothing");

  const again = await stage.execute({
    userId,
    accountId,
    fileName: "hdfc-fy2026-27-copy.csv",
    // A different file hash, so I02 does not short-circuit it: this is the
    // duplicate matcher's job, not the hash's.
    fileHash: "sha256-year-copy",
    statement,
  });
  check("every row is recognised as already present", again.ok && again.value.rowsLikelyDuplicate, year.lineCount);
  if (!again.ok) throw new Error("re-staging failed");

  const confirmedAgain = await new ConfirmUnmatchedRows(importRepo).execute({
    userId,
    batchId: again.value.batchId,
  });
  check("so nothing is offered for posting", confirmedAgain.ok && confirmedAgain.value.confirmed, 0);

  const balanceAfterReimport = await balances.balanceOf(userId, accountId, asOf);
  check(
    "and the balance is unchanged",
    balanceAfterReimport.toDecimalString(),
    Money.fromMinor(year.closingPaise).toDecimalString(),
  );

  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
