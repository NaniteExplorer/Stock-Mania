import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

const { sql } = await import("drizzle-orm");
const { db } = await import("@/infra/db/client");
const { seedReferenceData } = await import("@/infra/db/seeds");

await seedReferenceData(db);

const TABLES = [
  "txn_type_legality",
  "tax_rules",
  "cost_inflation_index",
  "charge_rates",
  "market_holidays",
] as const;

for (const table of TABLES) {
  const rows = await db.all<{ n: number }>(sql.raw(`select count(*) as n from "${table}"`));
  console.log(`  ${table}: ${rows[0]?.n ?? 0}`);
}
console.log("seed complete");
