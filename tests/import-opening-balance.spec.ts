/**
 * A statement that starts where the ledger does not.
 *
 * The failure this covers is invisible to every other check in the import path.
 * The file parses perfectly, every row reconciles against the running balance the
 * bank printed beside it, and the account still ends up wrong — because a
 * statement beginning mid-life carries an opening balance it never prints as a
 * row. One real SBI account read ₹10,596.08 against a bank showing ₹1,00,905.39,
 * and the difference was exactly the opening balance of a period whose
 * predecessor had never been imported.
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
import type { StatementInput } from "@/domain/banking";
import {
  DrizzleAccountRepository,
  DrizzleBalanceQuery,
  DrizzleCategoryRuleRepository,
  DrizzleImportRepository,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { StageStatementImport } from "@/app/banking.usecases";
import { OpenAccount, SeedChartOfAccounts } from "@/app/ledger.usecases";
import { checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/import-opening-balance.db";
const rupees = (value: string) => Money.fromRupees(value);
const on = (value: string) => CalendarDate.parse(value);

/** One credit of ₹500 that leaves the account at ₹90,500 — so it opened at ₹90,000. */
const statement = (): StatementInput => ({
  rows: [
    {
      rowIndex: 1,
      date: on("2026-01-10"),
      description: "Salary credit",
      reference: null,
      externalId: null,
      amount: rupees("500.00"),
      direction: "CREDIT",
      balanceAfter: rupees("90500.00"),
      occurrence: 0,
      raw: "10/01/2026 | Salary credit | | 500.00 | 90,500.00",
    },
  ],
  problems: [],
});

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
    for (const statementSql of readFileSync(`${dir}/${file}`, "utf8").split("--> statement-breakpoint")) {
      const trimmed = statementSql.trim();
      if (trimmed) await client.execute(trimmed);
    }
  }

  const userId = UserId.from("user_opening_1");
  const now = new Date("2026-09-01T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "opening@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const accountRepo = new DrizzleAccountRepository(db);
  const txnRepo = new DrizzleTransactionRepository(db);
  const importRepo = new DrizzleImportRepository(db);
  const ruleRepo = new DrizzleCategoryRuleRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  const openAccount = new OpenAccount(accountRepo, txnRepo, new FixedClock(now));

  await new SeedChartOfAccounts(accountRepo).execute({ userId });

  const opened = await openAccount.execute({
    userId,
    name: "SBI Savings",
    type: "ASSET",
    subtype: "BANK",
    openingBalance: rupees("100.00"),
    openingBalanceOn: on("2025-04-01"),
  });
  if (!opened.ok) throw new Error("account setup failed");

  const stage = new StageStatementImport(
    accountRepo,
    txnRepo,
    importRepo,
    ruleRepo,
    { list: async () => [] },
    undefined,
    undefined,
    balances,
  );

  section("a statement that assumes a balance the ledger does not have");

  const staged = await stage.execute({
    userId,
    accountId: opened.value.accountId,
    fileName: "sbi-2026.pdf",
    fileHash: "hash-2026",
    statement: statement(),
  });
  if (!staged.ok) throw new Error(`staging failed: ${staged.error.message}`);

  const batch = (await importRepo.listBatches(userId)).find(
    (candidate) => candidate.id === staged.value.batchId,
  );
  const warnings = batch?.diagnostics?.warnings ?? [];

  checkTrue("the import is warned about, not refused", staged.ok);
  checkTrue("a warning is raised", warnings.length > 0);
  // The numbers, not just the complaint: 90,000 assumed against 100 held.
  checkTrue(
    "it names the balance the statement assumes",
    warnings.some((warning) => warning.includes("90000.00")),
  );
  checkTrue(
    "and the balance the ledger holds",
    warnings.some((warning) => warning.includes("100.00")),
  );
  checkTrue(
    "and the difference between them",
    warnings.some((warning) => warning.includes("89900.00")),
  );

  section("a statement that continues from where the ledger is");

  const continuous = await stage.execute({
    userId,
    accountId: opened.value.accountId,
    fileName: "sbi-2025.pdf",
    fileHash: "hash-2025",
    statement: {
      rows: [
        {
          ...statement().rows[0],
          date: on("2025-06-01"),
          balanceAfter: rupees("600.00"),
        },
      ],
      problems: [],
    },
  });
  if (!continuous.ok) throw new Error(`staging failed: ${continuous.error.message}`);

  const second = (await importRepo.listBatches(userId)).find(
    (candidate) => candidate.id === continuous.value.batchId,
  );
  checkTrue(
    "says nothing about an opening balance",
    !(second?.diagnostics?.warnings ?? []).some((warning) => warning.includes("starts from")),
  );

  done();
}

await main();
