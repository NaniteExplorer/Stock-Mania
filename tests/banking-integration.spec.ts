/**
 * The Phase 2 slice, end to end, against a real libSQL file.
 *
 * A statement is parsed, staged, reviewed, posted, reconciled, budgeted and
 * undone — through the same repositories and migrations production runs. The
 * assertions that matter are the ones a unit test cannot make:
 *
 *   - **I01**: `PostImportBatch` posts nothing that is not `CONFIRMED`. Asserted
 *     by posting a batch whose rows are all still `PARSED` and finding the ledger
 *     unchanged.
 *   - **I02**: re-uploading identical bytes stages nothing.
 *   - **A re-imported overlapping statement adds only what is new.** The month's
 *     second file repeats four rows and brings two; two transactions appear.
 *   - **The derived balance equals the statement's printed closing balance**, to
 *     the paisa — which is the Phase 2 gate.
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
import { AccountCode } from "@/domain/accounts";
import { BalanceCalculator } from "@/domain/transactions";
import { CashAsset, CashInHand, Wallet } from "@/domain/assets";
import {
  DrizzleAccountRepository,
  DrizzleBalanceQuery,
  DrizzleBudgetRepository,
  DrizzleCategoryRuleRepository,
  DrizzleImportRepository,
  DrizzleSelfPayeeQuery,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { OpenAccount, RecordTransaction, SeedChartOfAccounts } from "@/app/ledger.usecases";
import {
  ConfirmUnmatchedRows,
  ListCashPositions,
  OpenCashAccount,
  PlanBudgets,
  PostImportBatch,
  ReconcileAccount,
  RecordSpend,
  ReviewImportRow,
  SeedCategoryRules,
  StageStatementImport,
  UndoImport,
} from "@/app/banking.usecases";
import { parseDelimitedText, parseStatementRows } from "@/infra/statements";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/banking-integration.db";

/* The April statement: six movements, printed closing ₹1,09,800.03. */
const APRIL = `HDFC BANK LIMITED
Date,Narration,Chq/Ref No,Withdrawal (Dr),Deposit (Cr),Closing Balance
01/04/2026,SALARY CREDIT APR ANANDA LTD,REF1001,,"1,25,000.00","3,25,000.00"
03/04/2026,UPI-ZEPTO MARKETPLACE,,"1,234.56",,"3,23,765.44"
07/04/2026,NEFT DR RENT APRIL LANDLORD,REF1002,"18,500.00",,"3,05,265.44"
15/04/2026,UPI-SWIGGY ORDER DINNER,,"842.75",,"3,04,422.69"
22/04/2026,TPCODL ELECTRICITY BILL APR,REF1003,"2,340.00",,"3,02,082.69"
28/04/2026,INT.PD:01-01-2026 TO 31-03-2026,,,"318.40","3,02,401.09"`;

/* May's file overlaps April by four rows and brings two new ones. */
const MAY_OVERLAPPING = `HDFC BANK LIMITED
Date,Narration,Chq/Ref No,Withdrawal (Dr),Deposit (Cr),Closing Balance
07/04/2026,NEFT DR RENT APRIL LANDLORD,REF1002,"18,500.00",,"3,05,265.44"
15/04/2026,UPI-SWIGGY ORDER DINNER,,"842.75",,"3,04,422.69"
22/04/2026,TPCODL ELECTRICITY BILL APR,REF1003,"2,340.00",,"3,02,082.69"
28/04/2026,INT.PD:01-01-2026 TO 31-03-2026,,,"318.40","3,02,401.09"
02/05/2026,UPI-BLINKIT GROCERY,,"1,120.00",,"3,01,281.09"
05/05/2026,NEFT DR RENT MAY LANDLORD,REF1004,"18,500.00",,"2,82,781.09"`;

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
    const sqlText = readFileSync(`${dir}/${file}`, "utf8");
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.execute(trimmed);
    }
  }
  console.log("migrations applied\n");

  const userId = UserId.from("user_banking_1");
  const now = new Date("2026-06-01T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "banking@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const clock = new FixedClock(now);
  const accountRepo = new DrizzleAccountRepository(db);
  const txnRepo = new DrizzleTransactionRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  const importRepo = new DrizzleImportRepository(db);
  const ruleRepo = new DrizzleCategoryRuleRepository(db);
  const selfPayees = new DrizzleSelfPayeeQuery(db);
  const budgetRepo = new DrizzleBudgetRepository(db);

  const record = new RecordTransaction(accountRepo, txnRepo);
  const openAccount = new OpenAccount(accountRepo, txnRepo, clock);
  const openCash = new OpenCashAccount(accountRepo, openAccount);
  const stage = new StageStatementImport(accountRepo, txnRepo, importRepo, ruleRepo, selfPayees);
  const confirmRest = new ConfirmUnmatchedRows(importRepo);
  const review = new ReviewImportRow(importRepo, accountRepo);
  const post = new PostImportBatch(importRepo, accountRepo, record, clock);
  const undo = new UndoImport(importRepo, txnRepo, clock);
  const reconcileAccount = new ReconcileAccount(accountRepo, balances, importRepo);
  const positions = new ListCashPositions(accountRepo, balances);
  const planBudgets = new PlanBudgets(budgetRepo, balances);
  const spend = new RecordSpend(accountRepo, record);

  await new SeedChartOfAccounts(accountRepo).execute({ userId });
  const seededRules = await new SeedCategoryRules(accountRepo, ruleRepo).execute({ userId });

  section("setup");
  // 282, not one per keyword: the unique index on (user, pattern, appliesTo)
  // collapses a keyword two built-in groups both claim ("auto", "recharge").
  check("built-in rules were seeded as editable rows", seededRules.ok && seededRules.value.created, 282);
  const reseeded = await new SeedCategoryRules(accountRepo, ruleRepo).execute({ userId });
  check("re-seeding creates nothing", reseeded.ok && reseeded.value.created, 0);

  /* ── Opening cash accounts ─────────────────────────────────────────── */

  section("opening cash accounts");

  const hdfc = await openCash.execute({
    userId,
    name: "HDFC Savings",
    subtype: "BANK",
    institution: "HDFC Bank",
    accountNumberSuffix: "4321",
    // The statement's own opening balance: ₹3,25,000 closing on the salary row
    // less that row's ₹1,25,000 credit.
    openingBalance: Money.fromRupees("200000"),
    openingBalanceOn: CalendarDate.parse("2026-03-31"),
  });
  check("bank account opened", hdfc.ok && hdfc.value.kind, "BANK_ACCOUNT");

  const wallet = await openCash.execute({
    userId,
    name: "Paytm Wallet",
    subtype: "WALLET",
    openingBalance: Money.fromRupees("500"),
    openingBalanceOn: CalendarDate.parse("2026-03-31"),
  });
  check("wallet opened", wallet.ok && wallet.value.kind, "WALLET");

  const cash = await openCash.execute({
    userId,
    name: "Cash",
    subtype: "CASH",
    openingBalance: Money.fromRupees("3000"),
    openingBalanceOn: CalendarDate.parse("2026-03-31"),
  });
  check("cash opened", cash.ok && cash.value.kind, "CASH_IN_HAND");

  const notCash = await openCash.execute({ userId, name: "Zerodha", subtype: "BROKERAGE" });
  check("a brokerage account is not cash", !notCash.ok, true);

  if (!hdfc.ok || !wallet.ok || !cash.ok) throw new Error("setup failed");
  const hdfcId = hdfc.value.accountId;

  /* ── Staging the April statement ───────────────────────────────────── */

  section("staging an import");

  const april = parseStatementRows(parseDelimitedText(APRIL));
  check("six rows parsed", april.rows.length, 6);

  const staged = await stage.execute({
    userId,
    accountId: hdfcId,
    fileName: "hdfc-april.csv",
    fileHash: "sha256-april",
    statement: april,
  });
  check("all six staged", staged.ok && staged.value.rowsStaged, 6);
  check("none looks like a duplicate yet", staged.ok && staged.value.rowsLikelyDuplicate, 0);
  if (!staged.ok) throw new Error("staging failed");
  const batchId = staged.value.batchId;

  const stagedRows = await importRepo.listRows(userId, batchId);
  const byNarration = new Map(stagedRows.map((row) => [row.description, row]));
  const zeptoRow = byNarration.get("UPI-ZEPTO MARKETPLACE")!;
  const groceries = (await accountRepo.findByCode(userId, AccountCode.parse("Expenses:Food:Groceries")))!;
  check("Zepto was categorised as groceries", zeptoRow.proposedAccountId?.value, groceries.id.value);
  check("and the reason is recorded", zeptoRow.because.length > 0, true);
  check("the raw line is kept", zeptoRow.raw.includes("ZEPTO"), true);
  check("staged rows are PARSED, not confirmed", zeptoRow.status, "PARSED");

  const salaryRow = byNarration.get("SALARY CREDIT APR ANANDA LTD")!;
  const salaryAccount = (await accountRepo.findByCode(userId, AccountCode.parse("Income:Salary")))!;
  check("the salary credit found the income account", salaryRow.proposedAccountId?.value, salaryAccount.id.value);
  check("and is a receipt", salaryRow.intent, "RECEIPT");

  /* ── I01: nothing posts before it is confirmed ─────────────────────── */

  section("I01 — nothing reaches the ledger unconfirmed");

  const prematurePost = await post.execute({ userId, batchId });
  check("posting a wholly unreviewed batch posts nothing", prematurePost.ok && prematurePost.value.posted, 0);
  const afterPremature = await txnRepo.find(userId, { accountIds: [hdfcId], limit: 100 });
  check("the ledger still has only the opening balance", afterPremature.totalCount, 1);

  /* ── Review and post ──────────────────────────────────────────────── */

  section("review and post");

  const confirmed = await confirmRest.execute({ userId, batchId });
  check("every categorised row is confirmed in one step", confirmed.ok && confirmed.value.confirmed, 6);
  check("none needed a manual choice", confirmed.ok && confirmed.value.needingChoice, 0);

  const posted = await post.execute({ userId, batchId });
  check("six transactions posted", posted.ok && posted.value.posted, 6);
  check("with no problems", posted.ok && posted.value.failed, 0);

  const batchAfter = await importRepo.findBatch(userId, batchId);
  check("the batch is completed", batchAfter?.status, "COMPLETED");
  check("and records what it imported", batchAfter?.rowsImported, 6);

  const postedAgain = await post.execute({ userId, batchId });
  check("posting the same batch twice posts nothing more", postedAgain.ok && postedAgain.value.posted, 0);

  /* ── The gate: the derived balance is the printed balance ──────────── */

  section("the derived balance equals the statement's printed closing balance");

  const asOf = CalendarDate.parse("2026-04-30");
  const balance = await balances.balanceOf(userId, hdfcId, asOf);
  check("HDFC balance on 30 April", balance.toDecimalString(), "302401.09");
  check(
    "which is exactly what the statement printed",
    balance.equals(april.rows[april.rows.length - 1].balanceAfter!),
    true,
  );

  const reconciled = await reconcileAccount.execute({
    userId,
    accountId: hdfcId,
    asOf,
    statementClosing: Money.fromRupees("302401.09"),
    batchId,
  });
  check("so the account reconciles", reconciled.ok && reconciled.value.isReconciled, true);
  check("with a zero difference", reconciled.ok && reconciled.value.difference.toDecimalString(), "0.00");

  const wrongClosing = await reconcileAccount.execute({
    userId,
    accountId: hdfcId,
    asOf,
    statementClosing: Money.fromRupees("302400.09"),
  });
  check("a one-rupee disagreement is caught", wrongClosing.ok && wrongClosing.value.difference.toDecimalString(), "-1.00");

  /* ── The SQL read path still agrees with the pure fold ─────────────── */

  section("SQL balances agree with the pure fold");

  const allAccounts = await accountRepo.list(userId, { includeClosed: true });
  const everything = await txnRepo.find(userId, { limit: 10_000 });
  const pure = new BalanceCalculator().balancesAsOf(allAccounts, everything.transactions, asOf);
  const sheet = await balances.balanceSheet(userId, asOf, { includeClosed: true });
  const mismatches = sheet.filter((row) => !pure.get(row.accountId.value)!.equals(row.balance));
  check("no account disagrees", mismatches.length, 0);
  check("and the ledger balances", new BalanceCalculator().verifyIntegrity(everything.transactions).ok, true);

  /* ── I02 and the overlapping re-import ────────────────────────────── */

  section("I02 — the same bytes are a no-op");

  const sameFile = await stage.execute({
    userId,
    accountId: hdfcId,
    fileName: "hdfc-april-again.csv",
    fileHash: "sha256-april",
    statement: april,
  });
  check("nothing is staged", sameFile.ok && sameFile.value.rowsStaged, 0);
  check("and the original batch is named", sameFile.ok && sameFile.value.alreadyImportedBatchId, batchId);

  section("an overlapping statement adds only what is new");

  const may = parseStatementRows(parseDelimitedText(MAY_OVERLAPPING));
  const mayStaged = await stage.execute({
    userId,
    accountId: hdfcId,
    fileName: "hdfc-may.csv",
    fileHash: "sha256-may",
    statement: may,
  });
  check("six rows staged", mayStaged.ok && mayStaged.value.rowsStaged, 6);
  check("four are recognised as already present", mayStaged.ok && mayStaged.value.rowsLikelyDuplicate, 4);
  if (!mayStaged.ok) throw new Error("May staging failed");

  const mayBatchId = mayStaged.value.batchId;
  const mayConfirmed = await confirmRest.execute({ userId, batchId: mayBatchId });
  check("only the two new rows are confirmed", mayConfirmed.ok && mayConfirmed.value.confirmed, 2);

  const mayPosted = await post.execute({ userId, batchId: mayBatchId });
  check("and only two transactions are added", mayPosted.ok && mayPosted.value.posted, 2);

  const afterMay = await txnRepo.find(userId, { accountIds: [hdfcId], limit: 100 });
  check("nine transactions on the account in total", afterMay.totalCount, 9);
  const mayBalance = await balances.balanceOf(userId, hdfcId, CalendarDate.parse("2026-05-31"));
  check("and the May closing balance matches the statement", mayBalance.toDecimalString(), "282781.09");

  /* ── Overruling the matcher ───────────────────────────────────────── */

  section("the user can overrule the matcher");

  const dupRows = await importRepo.listRows(userId, mayBatchId, { statuses: ["MATCHED"] });
  check("four rows are flagged", dupRows.length, 4);
  const overruled = await review.execute({
    userId,
    batchId: mayBatchId,
    rowId: dupRows[0].id,
    decision: "CONFIRM",
  });
  check("confirming a flagged row is allowed", overruled.ok, true);
  const overruledPost = await post.execute({ userId, batchId: mayBatchId });
  // The fingerprint is the backstop: the user may overrule the fuzzy matcher, but
  // the same row of the same statement cannot post twice.
  check("the fingerprint index still refuses the exact duplicate", overruledPost.ok && overruledPost.value.posted, 0);
  check("and the reason is reported rather than thrown", overruledPost.ok && overruledPost.value.failed, 1);

  const rejected = await review.execute({
    userId,
    batchId: mayBatchId,
    rowId: dupRows[1].id,
    decision: "REJECT",
    rejectedReason: "Already have it",
  });
  check("a row can be rejected", rejected.ok, true);
  const rejectedRows = await importRepo.listRows(userId, mayBatchId, { statuses: ["REJECTED"] });
  check("and it stays as evidence", rejectedRows.length, 1);
  check("with the reason", rejectedRows[0].rejectedReason, "Already have it");

  /* ── Undo ─────────────────────────────────────────────────────────── */

  section("undo an import");

  const undone = await undo.execute({ userId, batchId: mayBatchId });
  check("the two May transactions are tombstoned", undone.ok && undone.value.reversed, 2);
  const afterUndo = await balances.balanceOf(userId, hdfcId, CalendarDate.parse("2026-05-31"));
  check("the balance returns to April's closing", afterUndo.toDecimalString(), "302401.09");
  const undoneBatch = await importRepo.findBatch(userId, mayBatchId);
  check("the batch is marked undone", undoneBatch?.status, "UNDONE");

  const reimportAfterUndo = await stage.execute({
    userId,
    accountId: hdfcId,
    fileName: "hdfc-may.csv",
    fileHash: "sha256-may",
    statement: may,
  });
  check(
    "an undone import frees its file hash, so a corrected re-import is possible",
    reimportAfterUndo.ok && reimportAfterUndo.value.rowsStaged,
    6,
  );

  /* ── Cash positions and anomalies ─────────────────────────────────── */

  section("cash positions, derived");

  const cashPositions = await positions.execute({ userId, asOf: CalendarDate.parse("2026-04-30") });
  // Six, not three: the seeded chart's own `Assets:Bank`, `Assets:Cash` and
  // `Assets:Wallets` group accounts are postable accounts of a cash subtype, so
  // they classify too. They sit at zero unless something is posted directly to
  // them, and the screen nests them under their parent.
  check("six cash accounts are classified", cashPositions.ok && cashPositions.value.positions.length, 6);
  check(
    "the total is the sum of the three",
    cashPositions.ok && cashPositions.value.total.toDecimalString(),
    // 302401.09 bank + 500 wallet + 3000 cash
    "305901.09",
  );
  check("with no anomalies", cashPositions.ok && cashPositions.value.anomalies.length, 0);

  // Overspend the wallet: an impossible state that the ledger will happily record
  // and the asset class is expected to flag.
  const eatingOut = (await accountRepo.findByCode(userId, AccountCode.parse("Expenses:Food:Eating Out")))!;
  const overspend = await spend.execute({
    userId,
    fromAccountId: wallet.value.accountId,
    categoryAccountId: eatingOut.id,
    amount: Money.fromRupees("900"),
    postedOn: CalendarDate.parse("2026-04-10"),
    narration: "Wallet overspend",
  });
  check("the ledger records it", overspend.ok, true);

  const flagged = await positions.execute({ userId, asOf: CalendarDate.parse("2026-04-30") });
  check("the wallet is flagged", flagged.ok && flagged.value.anomalies.length, 1);
  checkTrue(
    "and the message says why it is impossible",
    flagged.ok && flagged.value.anomalies[0].includes("loaded"),
  );

  const walletAccount = (await accountRepo.findById(userId, wallet.value.accountId))!;
  checkTrue("the wallet classifies as a Wallet", CashAsset.classify(walletAccount) instanceof Wallet);

  const cashAccount = (await accountRepo.findById(userId, cash.value.accountId))!;
  const cashAsset = CashAsset.classify(cashAccount) as CashInHand;
  const cashBalance = await cashAsset.valueOn(CalendarDate.parse("2026-04-30"), balances);
  check("cash in hand reads from the journal", cashBalance.toDecimalString(), "3000.00");
  check(
    "and a physical count of 2,850 needs a 150 adjustment out",
    cashAsset.reconcileTo(Money.fromRupees("2850"), cashBalance).toDecimalString(),
    "-150.00",
  );

  /* ── Budgets ──────────────────────────────────────────────────────── */

  section("budgets over real flows");

  const rent = (await accountRepo.findByCode(userId, AccountCode.parse("Expenses:Housing:Rent")))!;
  await budgetRepo.upsert(userId, {
    accountId: rent.id,
    month: null,
    limit: Money.fromRupees("20000"),
    warnAtPercent: 80,
    carryover: false,
  });
  await budgetRepo.upsert(userId, {
    accountId: eatingOut.id,
    month: null,
    limit: Money.fromRupees("1000"),
    warnAtPercent: 80,
    carryover: true,
  });
  await budgetRepo.upsert(userId, {
    accountId: eatingOut.id,
    month: "2026-04",
    limit: Money.fromRupees("2000"),
    warnAtPercent: 90,
    carryover: true,
  });

  const plan = await planBudgets.execute({ userId, months: ["2026-04", "2026-05"] });
  if (!plan.ok) throw new Error("budget plan failed");
  const aprilPlan = plan.value.months[0];
  const rentEnvelope = aprilPlan.envelopes.find((e) => e.accountId.equals(rent.id))!;
  check("rent budgeted 20,000", rentEnvelope.budgeted.toDecimalString(), "20000.00");
  check("rent spent 18,500 (as a negative)", rentEnvelope.spent.toDecimalString(), "-18500.00");
  check("so 1,500 is left", rentEnvelope.leftover.toDecimalString(), "1500.00");

  const foodEnvelope = aprilPlan.envelopes.find((e) => e.accountId.equals(eatingOut.id))!;
  check("April's specific budget overrides the recurring default", foodEnvelope.budgeted.toDecimalString(), "2000.00");
  // 842.75 from the statement plus the 900 wallet overspend.
  check("eating out spent 1,742.75", foodEnvelope.spent.toDecimalString(), "-1742.75");
  check("leaving 257.25", foodEnvelope.leftover.toDecimalString(), "257.25");

  const mayPlan = plan.value.months[1];
  const mayFood = mayPlan.envelopes.find((e) => e.accountId.equals(eatingOut.id))!;
  check("May falls back to the recurring 1,000", mayFood.budgeted.toDecimalString(), "1000.00");
  check("and carries April's 257.25 in", mayFood.carriedIn.toDecimalString(), "257.25");

  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
