/**
 * The v1 migration, as a command.
 *
 *   npm run migrate:v1 -- --user <userId> --dir ./v1-export            # dry run
 *   npm run migrate:v1 -- --user <userId> --dir ./v1-export --commit   # write
 *
 * It reads what `mongoexport` produces — one JSON array or JSONL file per
 * collection — rather than connecting to Mongo. `mongoose` left `package.json`
 * with v1 and nothing imports it; a migration that re-added a driver would undo
 * the Phase 6 gate on the last lap. Reading a file is also reproducible, which is
 * what makes the dry run worth anything: the same export migrates the same way.
 *
 * Expected files, any of which may be absent:
 *
 *   accounts.json  transactions.json  trades.json  snapshots.json
 *
 * The dry run writes nothing and prints exactly what a real run would do. The real
 * run is idempotent: every migrated transaction carries a fingerprint derived from
 * the v1 document id, so a second run finds them and adds nothing.
 */

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { SystemClock, UserId } from "@/core/kernel";
import { CalendarDate, DateRange } from "@/core/time";
import { BalanceCalculator } from "@/domain/transactions";
import { checkAccountingIdentity } from "@/domain/reports";
import * as schema from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import {
  DrizzleAccountRepository,
  DrizzleBalanceQuery,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { OpenAccount, RecordTransaction, SeedChartOfAccounts } from "@/app/ledger.usecases";
import {
  MigrateV1,
  ReconcileV1,
  cutoverReadiness,
  type V1Account,
  type V1Export,
  type V1Snapshot,
  type V1Trade,
  type V1Transaction,
} from "@/app/migration.usecases";

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

/** Reads a JSON array or a JSONL file — `mongoexport` produces either. */
function readCollection<T>(path: string): readonly T[] {
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8").trim();
  if (text === "") return [];
  if (text.startsWith("[")) return JSON.parse(text) as T[];
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

async function main(): Promise<void> {
  const userIdValue = arg("user");
  const directory = arg("dir") ?? "./v1-export";
  const commit = process.argv.includes("--commit");

  if (!userIdValue) {
    console.error("Usage: npm run migrate:v1 -- --user <userId> --dir ./v1-export [--commit]");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Use "file:./data/finance.db" locally.');
    process.exit(1);
  }

  const userId = UserId.from(userIdValue);
  const client = createClient({ url, ...(process.env.DATABASE_AUTH_TOKEN ? { authToken: process.env.DATABASE_AUTH_TOKEN } : {}) });
  const db = drizzle(client, { schema }) as unknown as Database;

  const accounts = new DrizzleAccountRepository(db);
  const journal = new DrizzleTransactionRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  const clock = new SystemClock();

  const v1: V1Export = {
    accounts: readCollection<V1Account>(`${directory}/accounts.json`),
    transactions: readCollection<V1Transaction>(`${directory}/transactions.json`),
    trades: readCollection<V1Trade>(`${directory}/trades.json`),
    snapshots: readCollection<V1Snapshot>(`${directory}/snapshots.json`),
  };

  console.log(
    `Read ${v1.accounts.length} accounts, ${v1.transactions.length} transactions, ` +
      `${v1.trades.length} trades and ${v1.snapshots.length} snapshots from ${directory}.`,
  );
  if (v1.accounts.length === 0 && v1.transactions.length === 0) {
    console.error(`Nothing to migrate. Expected accounts.json / transactions.json in ${directory}.`);
    process.exit(1);
  }

  // The chart has to exist before anything can post to it, and seeding is
  // idempotent — so it runs even on a dry run's real-run counterpart.
  if (commit) await new SeedChartOfAccounts(accounts).execute({ userId });

  const report = await new MigrateV1(
    accounts,
    new OpenAccount(accounts, journal, clock),
    new RecordTransaction(accounts, journal),
    clock,
  ).execute({ userId, export: v1, dryRun: !commit });

  if (!report.ok) {
    console.error(`Migration failed: ${report.error.message}`);
    process.exit(1);
  }

  console.log(`\n${commit ? "MIGRATED" : "DRY RUN"} — nothing was written${commit ? " is false" : ""}.`);
  console.log(
    `  ${report.value.migrated} migrated, ${report.value.skipped} already present, ` +
      `${report.value.rejected} reported.`,
  );

  for (const row of report.value.rows.filter((entry) => entry.outcome === "REJECTED")) {
    console.log(`  REJECTED ${row.collection}/${row.sourceId}: ${row.reason}`);
  }
  for (const warning of report.value.warnings) {
    console.log(`  NOTE ${warning}`);
  }

  if (!commit) {
    console.log("\nRe-run with --commit to write. The run is idempotent.");
    return;
  }

  /* ── Reconciliation ────────────────────────────────────────────────── */

  const reconciliation = await new ReconcileV1(balances).execute({
    userId,
    snapshots: v1.snapshots,
  });
  if (!reconciliation.ok) {
    console.error(`Reconciliation failed: ${reconciliation.error.message}`);
    process.exit(1);
  }

  console.log("\nRECONCILIATION against v1's stored month-end totals:");
  for (const month of reconciliation.value.months) {
    console.log(
      `  ${month.month}  v1 ${month.v1NetWorth.toDecimalString()}  v2 ${month.v2NetWorth.toDecimalString()}  ` +
        `${month.cause}\n    ${month.explanation}`,
    );
  }

  /* ── Cutover readiness ─────────────────────────────────────────────── */

  const everything = await journal.find(userId, { limit: 100_000 });
  const calculator = new BalanceCalculator();
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const sheet = await balances.balanceSheet(userId, today, { includeClosed: true });
  // Cumulative flows, because B02 is a statement about all history rather than a
  // period — an income statement for one year does not explain a ten-year sheet.
  const flows = await balances.flowsByAccount(
    userId,
    DateRange.of(CalendarDate.parse("1900-01-01"), today),
    { rollUp: false },
  );

  const identity = checkAccountingIdentity([
    ...sheet.map((row) => ({
      accountId: row.accountId.value,
      code: row.code,
      name: row.name,
      type: row.type,
      subtype: row.subtype,
      balance: row.balance,
    })),
    ...flows.map((flow) => ({
      accountId: flow.accountId.value,
      code: flow.code,
      name: flow.name,
      type: flow.type,
      subtype: null,
      balance: flow.amount,
    })),
  ]);

  const readiness = cutoverReadiness({
    migration: report.value,
    reconciliation: reconciliation.value,
    ledgerBalances: calculator.verifyIntegrity(everything.transactions).ok,
    identityHolds: identity.holds,
    // Manual, and deliberately not inferred: the script cannot know whether anyone
    // archived the old database, and claiming it did would be the one lie that
    // matters here.
    v1Archived: process.argv.includes("--v1-archived"),
  });

  console.log("\nCUTOVER CHECKLIST:");
  for (const item of readiness.checklist) {
    console.log(`  [${item.satisfied ? "x" : " "}] ${item.requirement}\n      ${item.detail}`);
  }
  console.log(
    readiness.ready
      ? "\nReady to cut over."
      : "\nNot ready. Every box above must be ticked first — the unticked ones say why.",
  );

  if (!reconciliation.value.allExplained) process.exit(2);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
