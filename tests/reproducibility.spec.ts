/**
 * The nightly reproducibility check, against a real journal.
 *
 * Three things are asserted, and the third is the one that matters:
 *
 *   1. A clean journal reports no differences.
 *   2. An unbalanced entry is caught — and it is caught by SQL over the raw
 *      rows, so it would be caught even if it were written by a migration or a
 *      hand-edit that never touched a domain constructor.
 *   3. **The two recomputations really are independent.** A soft-deleted posting
 *      is excluded by the journal fold and included by `DrizzleBalanceQuery`
 *      (which does not filter `postings.deleted_at`), so the job reports a
 *      difference. That is the check doing its job: a latent disagreement between
 *      the query layer and the journal, found by diffing rather than by reading
 *      the code. Nothing soft-deletes a posting today — a reversal is a new
 *      entry, not a deletion — which is why it has never mattered, and exactly
 *      why a nightly diff is worth running.
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
import { OpenAccount, RecordTransaction, SeedChartOfAccounts } from "@/app/ledger.usecases";
import { VerifyReproducibility, formatReproducibility } from "@/app/reproducibility.usecases";
import {
  DrizzleAccountRepository,
  DrizzleBalanceQuery,
  DrizzleJournalReplaySource,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/reproducibility.spec.db";
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

  const userId = UserId.from("user_reproducibility_1");
  const now = new Date("2026-08-24T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "repro@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const accounts = new DrizzleAccountRepository(db);
  const journal = new DrizzleTransactionRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  const clock = new FixedClock(now);

  await new SeedChartOfAccounts(accounts).execute({ userId });
  const openAccount = new OpenAccount(accounts, journal, clock);
  const record = new RecordTransaction(accounts, journal);

  const bank = await openAccount.execute({
    userId,
    name: "Savings",
    type: "ASSET",
    subtype: "SAVINGS",
    openingBalance: Money.fromRupees("250000"),
    openingBalanceOn: on("2026-04-01"),
  });
  if (!bank.ok) throw new Error(bank.error.message);

  const groceries = await accounts.findByCode(userId, AccountCode.parse("Expenses:Food:Groceries"));
  if (!groceries) throw new Error("the chart of accounts is missing Expenses:Food:Groceries");

  const spend = await record.execute({
    userId,
    fromAccountId: bank.value.accountId,
    toAccountId: groceries.id,
    amount: Money.fromRupees("4500"),
    postedOn: on("2026-05-10"),
    narration: "Groceries",
  });
  if (!spend.ok) throw new Error(spend.error.message);

  const verify = new VerifyReproducibility(new DrizzleJournalReplaySource(db), balances);

  section("a clean journal recomputes to the same numbers");

  const clean = await verify.execute({ asOf: on("2026-08-24"), userId });
  checkTrue("the check ran", clean.ok);
  if (!clean.ok) return;
  check("no differences", clean.value.differences, 0);
  check("and it holds", clean.value.holds, true);
  checkTrue("accounts were actually checked", clean.value.users[0].accountsChecked > 0);
  check("and the transactions were counted", clean.value.users[0].transactionsChecked > 0, true);
  checkTrue(
    "the empty projection cache is reported as a gap, not passed over",
    clean.value.users[0].findings.some(
      (finding) => finding.severity === "GAP" && finding.check === "projection cache",
    ),
  );
  checkTrue("the report renders", formatReproducibility(clean.value).includes("PASS"));

  section("an unbalanced entry is caught in the raw rows");

  /*
   * Written with SQL on purpose. Every domain path refuses this — `Transaction`
   * enforces L01 in its constructor — so the only way an unbalanced entry can
   * exist is a path that bypassed the domain, which is precisely what a nightly
   * check over the raw journal is for.
   */
  await client.execute(
    `update postings set amount_minor = amount_minor + 100 where transaction_id = '${spend.value.transactionId.value}' and direction = 'DEBIT'`,
  );
  const broken = await verify.execute({ asOf: on("2026-08-24"), userId });
  if (!broken.ok) return;
  checkTrue(
    "the unbalanced entry is named",
    broken.value.users[0].findings.some((finding) => finding.check === "L01 double-entry"),
  );
  check("so the job fails", broken.value.holds, false);
  checkTrue("and the report says FAIL", formatReproducibility(broken.value).includes("FAIL"));

  await client.execute(
    `update postings set amount_minor = amount_minor - 100 where transaction_id = '${spend.value.transactionId.value}' and direction = 'DEBIT'`,
  );
  const repaired = await verify.execute({ asOf: on("2026-08-24"), userId });
  if (!repaired.ok) return;
  check("repairing the row clears the finding", repaired.value.differences, 0);

  section("the two recomputations are genuinely independent");

  /*
   * Tombstone the credit leg — the one on the savings account, because the
   * balance sheet only carries ASSET, LIABILITY and EQUITY and an expense leg
   * would be excluded by both paths for the same reason.
   *
   * The journal fold honours `deleted_at`; `DrizzleBalanceQuery` does not filter
   * it. Nothing in the app soft-deletes a posting today — a reversal is a new
   * entry — so this is latent rather than live, and the diff finds it without
   * anyone reading the SQL.
   */
  await client.execute(
    `update postings set deleted_at = 1 where transaction_id = '${spend.value.transactionId.value}' and direction = 'CREDIT'`,
  );
  const divergent = await verify.execute({ asOf: on("2026-08-24"), userId });
  if (!divergent.ok) return;
  checkTrue(
    "a balance the two paths disagree on is reported",
    divergent.value.users[0].findings.some((finding) => finding.check === "balance recomputation"),
  );
  checkTrue(
    "and the finding names the account and the difference",
    divergent.value.users[0].findings.some(
      (finding) => finding.check === "balance recomputation" && finding.detail.includes("Savings"),
    ),
  );
  check("the job fails on it", divergent.value.holds, false);

  done();
}

void main();
