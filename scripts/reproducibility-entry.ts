/**
 * The nightly reproducibility job.
 *
 *   npm run verify:reproducibility
 *   npm run verify:reproducibility -- --as-of 2026-03-31
 *
 * Exits non-zero on a **difference** — two computations over one journal
 * disagreeing — and zero on a **gap**, which is something not yet checkable and
 * is printed rather than swallowed. That split is the whole design: a job that
 * failed on gaps would be switched off within a week, and one that hid them would
 * be a green tick nobody had earned.
 */

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const { CalendarDate } = await import("@/core/time");
const { db } = await import("@/infra/db/client");
const { DrizzleBalanceQuery, DrizzleJournalReplaySource } = await import("@/infra/repositories");
const { VerifyReproducibility, formatReproducibility } = await import(
  "@/app/reproducibility.usecases"
);

const flagIndex = process.argv.indexOf("--as-of");
const asOf =
  flagIndex >= 0 && process.argv[flagIndex + 1]
    ? CalendarDate.parse(process.argv[flagIndex + 1])
    : CalendarDate.parse(new Date().toISOString().slice(0, 10));

const verify = new VerifyReproducibility(
  new DrizzleJournalReplaySource(db),
  new DrizzleBalanceQuery(db),
);

const result = await verify.execute({ asOf });
if (!result.ok) {
  console.error(result.error.message);
  process.exit(2);
}

console.log(formatReproducibility(result.value));
process.exit(result.value.holds ? 0 : 1);
