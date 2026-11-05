/**
 * Task 0.4.b follow-up: `AccountCoverageGaps`, the read use case behind the account
 * page's coverage gap notice and first-statement line (DESIGN.md §9a), against a
 * real libSQL file with the migrations applied.
 *
 *   - a new account's first statement books its own opening: no gap, and the
 *     ledger without that opening is zero, so it reads as the first statement;
 *   - a later statement that starts mid-life is a gap, signed, with `coveredTo`;
 *   - an account with a hand-entered opening is neither a gap nor "first";
 *   - a missing period of net spending is a negative (overstated) gap;
 *   - an unposted first statement on an empty account is the full notice, not "first";
 *   - a format without a running balance yields nothing;
 *   - an undone batch drops out; another owner sees nothing.
 */
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import type { AccountId } from "@/domain/accounts";
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
  AccountCoverageGaps,
  ConfirmUnmatchedRows,
  OpenCashAccount,
  PostImportBatch,
  SeedCategoryRules,
  StageStatementImport,
  UndoImport,
  importOpeningFingerprint,
} from "@/app/banking.usecases";
import { parseDelimitedText, parseStatementRows, toBankingStatement } from "@/infra/statements";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/coverage-gaps.db";

/* First statement of an empty account: implied opening ₹4,12,838.83 on 31 Mar. */
const AXIS_APRIL = `AXIS BANK
Date,Narration,Withdrawal (Dr),Deposit (Cr),Closing Balance
01/04/2026,SALARY CREDIT APR,,71050.00,483888.83
02/04/2026,ATM CASH,10000.00,,473888.83`;

/* May was never imported: June opens at ₹5,28,950.00 against a ledger of ₹4,73,888.83. */
const AXIS_JUNE = `AXIS BANK
Date,Narration,Withdrawal (Dr),Deposit (Cr),Closing Balance
01/06/2026,SALARY CREDIT JUN,,71050.00,600000.00`;

/* Opens at ₹2,00,000.00 — exactly the hand-entered opening. */
const HDFC_APRIL = `HDFC BANK LIMITED
Date,Narration,Withdrawal (Dr),Deposit (Cr),Closing Balance
01/04/2026,SALARY CREDIT APR,,1000.00,201000.00`;

/* Opens at ₹30,000.00 against a ledger of ₹50,000.00: the missing period was net spending. */
const SBI_APRIL = `SBI
Date,Narration,Withdrawal (Dr),Deposit (Cr),Closing Balance
01/04/2026,ATM CASH,500.00,,29500.00`;

/* No running balance printed: not evidence of anything. */
const NO_BALANCE = `KOTAK
Date,Narration,Withdrawal (Dr),Deposit (Cr)
01/04/2026,SALARY CREDIT APR,,1000.00`;

async function main() {
  for (const suffix of ["", "-shm", "-wal"]) {
    try { rmSync(DB_FILE + suffix); } catch { /* not there */ }
  }
  const client = createClient({ url: "file:" + DB_FILE });
  const db = drizzle(client, { schema }) as unknown as Database;
  const dir = "./src/infra/db/migrations";
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${dir}/${file}`, "utf8").split("--> statement-breakpoint")) {
      if (statement.trim()) await client.execute(statement.trim());
    }
  }

  const now = new Date("2026-07-01T10:00:00Z");
  const userId = UserId.from("user_coverage_1");
  const other = UserId.from("user_coverage_2");
  for (const id of [userId, other]) {
    await db.insert(users).values({ id: id.value, name: "T", email: `${id.value}@example.com`, emailVerified: true, createdAt: now, updatedAt: now });
  }

  const clock = new FixedClock(now);
  const accounts = new DrizzleAccountRepository(db);
  const journal = new DrizzleTransactionRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  const imports = new DrizzleImportRepository(db);
  const rules = new DrizzleCategoryRuleRepository(db);
  const record = new RecordTransaction(accounts, journal);
  const openCash = new OpenCashAccount(accounts, new OpenAccount(accounts, journal, clock));
  const stage = new StageStatementImport(accounts, journal, imports, rules, new DrizzleSelfPayeeQuery(db));
  const confirm = new ConfirmUnmatchedRows(imports);
  const post = new PostImportBatch(imports, accounts, record, clock);
  const undo = new UndoImport(imports, journal, clock);
  const coverage = new AccountCoverageGaps(accounts, imports, journal, balances);

  await new SeedChartOfAccounts(accounts).execute({ userId });
  await new SeedCategoryRules(accounts, rules).execute({ userId });

  const open = async (name: string, opening?: string): Promise<AccountId> => {
    const r = await openCash.execute({
      userId, name, subtype: "BANK",
      ...(opening ? { openingBalance: Money.fromRupees(opening), openingBalanceOn: CalendarDate.parse("2026-03-31") } : {}),
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value.accountId;
  };
  let files = 0;
  const stageCsv = async (accountId: AccountId, csv: string): Promise<string> => {
    files += 1;
    const parsed = parseStatementRows(parseDelimitedText(csv));
    const r = await stage.execute({
      userId, accountId, fileName: `statement-${files}.csv`, fileHash: `sha256-coverage-${files}`,
      statement: toBankingStatement(parsed),
    });
    if (!r.ok) throw new Error(r.error.message);
    return r.value.batchId;
  };
  const stageAndPost = async (accountId: AccountId, csv: string): Promise<string> => {
    const batchId = await stageCsv(accountId, csv);
    await confirm.execute({ userId, batchId });
    const r = await post.execute({ userId, batchId });
    if (!r.ok || r.value.failed > 0) throw new Error(`post failed: ${r.ok ? JSON.stringify(r.value.problems) : r.error.message}`);
    return batchId;
  };

  section("a new account's first statement");
  const axis = await open("Axis Salary");
  const april = await stageAndPost(axis, AXIS_APRIL);
  const opening = await journal.find(userId, { accountIds: [axis], importBatchId: april });
  checkTrue("the import booked its own opening", opening.transactions.some((t) => t.context.fingerprint === importOpeningFingerprint(april)));
  let result = await coverage.execute({ userId, accountId: axis });
  check("one checkable statement", result.statements.length, 1);
  check("no gap: the booked opening matches", result.gaps.length, 0);
  const first = result.statements[0]!;
  check("ledger the day before includes the opening", first.ledgerBalance.toDecimalString(), "412838.83");
  check("ledger without the batch's own opening is zero", first.ledgerBeforeOwnOpening.toDecimalString(), "0.00");
  check("no earlier history once the own opening is excluded", first.coveredTo, null);
  checkTrue("it is the first statement", first.isFirstStatement);
  check("firstStatementOn names where history starts", result.firstStatementOn?.toISO(), "2026-04-01");

  section("a later statement that starts mid-life");
  const june = await stageCsv(axis, AXIS_JUNE);
  result = await coverage.execute({ userId, accountId: axis });
  check("two statements, oldest first", result.statements.map((s) => s.resumesOn.toISO()).join(","), "2026-04-01,2026-06-01");
  check("one gap", result.gaps.length, 1);
  const gap = result.gaps[0]!;
  check("covered to the last April posting", gap.coveredTo?.toISO(), "2026-04-02");
  check("resumes on 1 June", gap.resumesOn.toISO(), "2026-06-01");
  check("statement opened at", gap.impliedOpening.toDecimalString(), "528950.00");
  check("ledger held", gap.ledgerBalance.toDecimalString(), "473888.83");
  check("difference, positive = understated", gap.difference.toDecimalString(), "55061.17");
  check("the later statement is not 'first'", result.statements[1]!.isFirstStatement, false);
  check("history still starts in April", result.firstStatementOn?.toISO(), "2026-04-01");

  section("an undone batch drops out");
  await undo.execute({ userId, batchId: june });
  result = await coverage.execute({ userId, accountId: axis });
  check("the June gap is gone", result.gaps.length, 0);
  check("the first-statement line stays", result.firstStatementOn?.toISO(), "2026-04-01");

  section("a hand-entered opening is earlier history");
  const hdfc = await open("HDFC Savings", "200000");
  await stageAndPost(hdfc, HDFC_APRIL);
  result = await coverage.execute({ userId, accountId: hdfc });
  check("no gap: the statement opens at the entered opening", result.gaps.length, 0);
  check("the opening is not this batch's own", result.statements[0]!.ledgerBeforeOwnOpening.toDecimalString(), "200000.00");
  check("covered to the opening date", result.statements[0]!.coveredTo?.toISO(), "2026-03-31");
  check("so it is not the first statement", result.firstStatementOn, null);

  section("a missing period of net spending is overstated, sign kept");
  const sbi = await open("SBI Savings", "50000");
  await stageCsv(sbi, SBI_APRIL);
  result = await coverage.execute({ userId, accountId: sbi });
  check("one gap", result.gaps.length, 1);
  check("difference is negative (overstated)", result.gaps[0]!.difference.toDecimalString(), "-20000.00");
  check("not first", result.firstStatementOn, null);

  section("an empty account whose statement was never posted: the full notice");
  const unposted = await open("Unposted");
  await stageCsv(unposted, AXIS_APRIL.replace("AXIS BANK", "AXIS BANK (copy)"));
  result = await coverage.execute({ userId, accountId: unposted });
  check("a gap, not the quiet line", result.gaps.length, 1);
  check("with nothing before it", result.gaps[0]!.coveredTo, null);
  check("and its full difference", result.gaps[0]!.difference.toDecimalString(), "412838.83");
  check("not first", result.firstStatementOn, null);

  section("no running balance, no claim");
  const kotak = await open("Kotak");
  await stageCsv(kotak, NO_BALANCE);
  result = await coverage.execute({ userId, accountId: kotak });
  check("nothing checkable", result.statements.length, 0);
  check("no gap", result.gaps.length, 0);
  check("no first-statement line", result.firstStatementOn, null);

  section("owner scoping");
  result = await coverage.execute({ userId: other, accountId: axis });
  check("another owner sees no statements", result.statements.length, 0);
  check("and no line", result.firstStatementOn, null);

  client.close();
  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
