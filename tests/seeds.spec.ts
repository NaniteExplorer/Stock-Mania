import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { sql } from "drizzle-orm";
import * as schema from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { seedReferenceData } from "@/infra/db/seeds";
import { MarketCalendar } from "@/core/time";
import { check, checkDeep, section, done } from "./harness";

/**
 * The seeded reference data.
 *
 * These rows are read at runtime by a constructor (the legality matrix), a tax
 * rule (the CII table) and a charge model (the rates), so a wrong row here is a
 * wrong number in a report — not a cosmetic problem.
 */

const DB_FILE = "./tmp/seeds.db";

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

  const count = async (table: string): Promise<number> => {
    const rows = await db.all<{ n: number }>(sql.raw(`select count(*) as n from "${table}"`));
    return Number(rows[0]?.n ?? 0);
  };
  const rows = async <T>(query: string): Promise<T[]> => db.all<T>(sql.raw(query));

  section("seeding is idempotent");

  await seedReferenceData(db);
  const first = {
    legality: await count("txn_type_legality"),
    taxRules: await count("tax_rules"),
    cii: await count("cost_inflation_index"),
    chargeRates: await count("charge_rates"),
    holidays: await count("market_holidays"),
  };
  check("legality rows were written", first.legality > 100, true);

  // Booting twice must not double anything, because `migrateAndSeed` runs on
  // every start and a duplicated legality row would be silently harmless while a
  // duplicated charge rate would double a fee.
  await seedReferenceData(db);
  const second = {
    legality: await count("txn_type_legality"),
    taxRules: await count("tax_rules"),
    cii: await count("cost_inflation_index"),
    chargeRates: await count("charge_rates"),
    holidays: await count("market_holidays"),
  };
  checkDeep("a second seed writes nothing", second, first);

  section("L07 — EXPENSE is never a source");

  /*
   * Firefly's rule, preserved. This is not a second check on top of L06: the
   * matrix simply contains no such row, so the legality lookup fails on its own.
   * REFUND is the one legitimate case of money coming back *from* an expense.
   */
  const expenseSources = await rows<{ txn_type: string }>(
    "select distinct txn_type from txn_type_legality where source_role = 'EXPENSE'",
  );
  checkDeep(
    "only REFUND may originate at an expense account",
    expenseSources.map((r) => r.txn_type).sort(),
    ["REFUND"],
  );

  section("the investment rows §3.6 adds to Firefly's matrix");

  const legal = async (kind: string, from: string, to: string): Promise<boolean> => {
    const found = await rows<{ n: number }>(
      `select count(*) as n from txn_type_legality
       where txn_type = '${kind}' and source_role = '${from}' and destination_role = '${to}'`,
    );
    return Number(found[0]?.n ?? 0) > 0;
  };

  check("BUY from a bank into a brokerage", await legal("BUY", "ASSET_BANK", "ASSET_BROKERAGE"), true);
  check("SELL from a brokerage into a bank", await legal("SELL", "ASSET_BROKERAGE", "ASSET_BANK"), true);
  check("DIVIDEND from income into a bank", await legal("DIVIDEND", "INCOME", "ASSET_BANK"), true);
  check("INTEREST from income into a deposit", await legal("INTEREST", "INCOME", "ASSET_DEPOSIT"), true);
  check(
    "CORPORATE_ACTION against the adjustment account",
    await legal("CORPORATE_ACTION", "ASSET_BROKERAGE", "EQUITY_ADJUSTMENT"),
    true,
  );
  check(
    "VALUATION_ADJUSTMENT only for unpriceable assets",
    await legal("VALUATION_ADJUSTMENT", "ASSET_PROPERTY", "EQUITY_ADJUSTMENT"),
    true,
  );

  // A card payment is a transfer between two of your own accounts — invariant
  // L12's premise. Booking it as an expense is v1's bug class.
  check(
    "paying a card is a TRANSFER, not an expense",
    await legal("TRANSFER", "ASSET_BANK", "LIABILITY_CREDIT_CARD"),
    true,
  );
  check(
    "BUY directly from an expense account is not legal",
    await legal("BUY", "EXPENSE", "ASSET_BROKERAGE"),
    false,
  );

  section("tax rules mirror both shipped regimes");

  const regimes = await rows<{ regime: string }>(
    "select distinct regime from tax_rules order by regime",
  );
  checkDeep("both regimes are present", regimes.map((r) => r.regime), ["IN-FY2024", "IN-FY2025"]);

  // The two vintages the plan's §6 table and its Phase 1c item disagree about —
  // they are not in conflict, they are different years.
  const fy2024Equity = await rows<{ ltcg: number; stcg: number; exemption: number }>(
    `select ltcg_rate_scaled as ltcg, stcg_rate_scaled as stcg, exemption_limit_minor as exemption
     from tax_rules where regime = 'IN-FY2024' and tax_category = 'LISTED_EQUITY'`,
  );
  check("FY2024 equity LTCG is 10%", fy2024Equity[0].ltcg, 10_000_000);
  check("FY2024 equity STCG is 15%", fy2024Equity[0].stcg, 15_000_000);
  check("FY2024 exemption is ₹1,00,000", fy2024Equity[0].exemption, 10_000_000);

  const fy2025Equity = await rows<{ ltcg: number; stcg: number; exemption: number }>(
    `select ltcg_rate_scaled as ltcg, stcg_rate_scaled as stcg, exemption_limit_minor as exemption
     from tax_rules where regime = 'IN-FY2025' and tax_category = 'LISTED_EQUITY'`,
  );
  check("FY2025 equity LTCG is 12.5%", fy2025Equity[0].ltcg, 12_500_000);
  check("FY2025 equity STCG is 20%", fy2025Equity[0].stcg, 20_000_000);
  check("FY2025 exemption is ₹1,25,000", fy2025Equity[0].exemption, 12_500_000);

  // A NULL stcg rate means "at slab", which is a different claim from zero.
  const debt = await rows<{ stcg: number | null; indexation: number }>(
    `select stcg_rate_scaled as stcg, indexation_allowed as indexation
     from tax_rules where regime = 'IN-FY2025' and tax_category = 'DEBT'`,
  );
  check("post-2023 debt is taxed at slab (NULL rate)", debt[0].stcg, null);
  check("and has no indexation", Number(debt[0].indexation), 0);

  const legacyDebt = await rows<{ indexation: number }>(
    `select indexation_allowed as indexation from tax_rules
     where regime = 'IN-FY2024' and tax_category = 'DEBT_LEGACY'`,
  );
  check("pre-2023 debt kept indexation", Number(legacyDebt[0].indexation), 1);

  const vda = await rows<{ ltcg: number; exemption: number | null }>(
    `select ltcg_rate_scaled as ltcg, exemption_limit_minor as exemption
     from tax_rules where regime = 'IN-FY2025' and tax_category = 'VDA'`,
  );
  check("a VDA is flat 30%", vda[0].ltcg, 30_000_000);
  check("with no exemption", vda[0].exemption, null);

  section("the CII table matches the notified values");

  // The pair the doc's worked example uses: ₹5,00,000 × 331/289.
  const cii = await rows<{ financial_year: string; value: number }>(
    "select financial_year, value from cost_inflation_index where financial_year in ('2019-20','2022-23','2025-26') order by financial_year",
  );
  checkDeep(
    "2019-20, 2022-23 and 2025-26",
    cii.map((r) => `${r.financial_year}=${r.value}`),
    ["2019-20=289", "2022-23=331", "2025-26=376"],
  );
  check("the base year is 100", (await rows<{ value: number }>(
    "select value from cost_inflation_index where financial_year = '2001-02'",
  ))[0].value, 100);

  section("charge rates carry the details a paisa-exact note needs");

  const stt = await rows<{ segment: string; side: string; rate: number; unit: string; ded: string }>(
    `select segment, side, rate_scaled as rate, rounding_unit as unit, deductibility as ded
     from charge_rates where charge_type = 'STT' order by segment`,
  );
  check("delivery STT is 0.1% on both sides", `${stt[0].segment}/${stt[0].side}/${stt[0].rate}`, "EQ_DELIVERY/BOTH/100000");
  check("intraday STT is 0.025% on the SELL leg only", `${stt[1].segment}/${stt[1].side}/${stt[1].rate}`, "EQ_INTRADAY/SELL/25000");
  check("STT rounds to the whole rupee", stt[0].unit, "RUPEE");
  check("STT is not deductible against gains", stt[0].ded, "NON_DEDUCTIBLE");

  const stamp = await rows<{ side: string; unit: string; ded: string }>(
    `select side, rounding_unit as unit, deductibility as ded
     from charge_rates where charge_type = 'STAMP_DUTY' and segment = 'EQ_DELIVERY'`,
  );
  check("stamp duty is buy-side only", stamp[0].side, "BUY");
  check("and rounds to the whole rupee", stamp[0].unit, "RUPEE");
  check("and is capitalised into cost basis", stamp[0].ded, "CAPITALISED");

  const dp = await rows<{ basis: string; side: string; flat: number }>(
    `select basis, side, flat_minor as flat from charge_rates
     where charge_type = 'DP_CHARGES' and broker_id = 'zerodha'`,
  );
  check("Zerodha DP is per scrip per day", dp[0].basis, "PER_SCRIP_DAY");
  check("on the sell side only", dp[0].side, "SELL");
  check("at ₹15.34", dp[0].flat, 1534);

  const gst = await rows<{ basis: string; rate: number }>(
    `select basis, rate_scaled as rate from charge_rates
     where charge_type = 'GST' and segment = 'EQ_DELIVERY'`,
  );
  check("GST is 18%", gst[0].rate, 18_000_000);
  check("levied on brokerage plus fees, not on turnover", gst[0].basis, "BROKERAGE_PLUS_FEES");

  check(
    "delivery brokerage at Zerodha is zero",
    (await rows<{ rate: number }>(
      `select rate_scaled as rate from charge_rates
       where broker_id = 'zerodha' and segment = 'EQ_DELIVERY' and charge_type = 'BROKERAGE'`,
    ))[0].rate,
    0,
  );

  section("the holiday mirror matches MarketCalendar exactly");

  // One transcription of the exchange circulars. The table is a copy for SQL
  // reporting; if the two ever disagree, the copy is what a report would trust.
  const mirrored = await rows<{ holiday_date: string }>(
    "select holiday_date from market_holidays where mic = 'XNSE' order by holiday_date",
  );
  const source = MarketCalendar.nse().holidayDates();
  check("the mirror has the same count", mirrored.length, source.length);
  checkDeep(
    "and the same dates",
    mirrored.map((r) => r.holiday_date).slice(0, 5),
    [...source].slice(0, 5),
  );

  client.close();
  done();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
