/**
 * The same metal on two platforms — buy, buy again, then sell.
 *
 * The regression this exists for: `AddInstrument` looked the **bare** symbol up
 * and nothing else. On the second platform that lookup returned the first
 * platform's row, the institutions differed, and the code fell through to
 * minting a new qualified symbol — every single time. SafeGold kept `GOLD999`;
 * Tanishq got `GOLD999.TANISHQ` on the first buy, `GOLD999.TANISHQ.2` on the
 * second, `.3` on the third. Each was a separate holding with its own cost
 * basis, and a sell resolved to yet another fresh one, so it refused with
 * "there are no units of GOLD999.TANISHQ.2 to sell" for grams the user could
 * see on the screen.
 *
 * Source-text assertions cannot catch that, so this walks the real use cases
 * against real migrations. The claims:
 *
 *  - two platforms are two holdings, and only two, however many buys land;
 *  - a repeat buy on a non-first platform lands in the holding that is already
 *    there;
 *  - grams bought on that platform can be sold;
 *  - both rows keep `quoteRef` pinned to the bare slug, so both still price.
 */

import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { LegalityMatrix } from "@/domain/transactions";
import { Institution, InstitutionId } from "@/domain/institutions";
import {
  DrizzleAccountRepository,
  DrizzleBalanceQuery,
  DrizzleInstitutionRepository,
  DrizzleInstrumentRepository,
  DrizzleLotRepository,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { OpenAccount, SeedChartOfAccounts } from "@/app/ledger.usecases";
import {
  AddInstrument,
  InvestmentWorkspace,
  PortfolioReturns,
  RecordBuy,
  RecordSell,
  ValuePortfolio,
} from "@/app/investing.usecases";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/metal-platform-holdings.db";

async function main() {
  rmSync(DB_FILE, { force: true });
  rmSync(`${DB_FILE}-wal`, { force: true });
  rmSync(`${DB_FILE}-shm`, { force: true });

  const client = createClient({ url: `file:${DB_FILE}` });
  const db = drizzle(client, { schema }) as unknown as Database;
  for (const file of readdirSync("./src/infra/db/migrations").filter((name) => name.endsWith(".sql")).sort()) {
    const sql = readFileSync(`./src/infra/db/migrations/${file}`, "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.execute(trimmed);
    }
  }

  const userId = UserId.from("user_metal_platforms");
  const now = new Date("2026-04-01T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Metals",
    email: "metals@example.test",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const accountRepo = new DrizzleAccountRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  const instrumentRepo = new DrizzleInstrumentRepository(db);
  const txnRepo = new DrizzleTransactionRepository(db);
  const lotRepo = new DrizzleLotRepository(db);
  const institutionRepo = new DrizzleInstitutionRepository(db);

  const openAccount = new OpenAccount(accountRepo, txnRepo, new FixedClock(now));
  await new SeedChartOfAccounts(accountRepo).execute({ userId });

  const bank = await openAccount.execute({
    userId,
    name: "HDFC Savings",
    type: "ASSET",
    subtype: "BANK",
    openingBalance: Money.fromRupees("500000"),
    openingBalanceOn: CalendarDate.parse("2026-01-01"),
  });
  if (!bank.ok) throw new Error("bank account setup failed");
  const bankId: AccountId = bank.value.accountId;

  const platforms = new Map<string, InstitutionId>();
  const ids = {
    SafeGold: "22222222-2222-4222-8222-222222222222",
    Tanishq: "33333333-3333-4333-8333-333333333333",
  } as const;
  for (const name of ["SafeGold", "Tanishq"] as const) {
    const institution = new Institution({
      id: InstitutionId.from(ids[name]),
      userId,
      name,
      kind: "BULLION",
    });
    await institutionRepo.save(institution);
    platforms.set(name, institution.id);
  }

  const addInstrument = new AddInstrument(accountRepo, instrumentRepo, openAccount, institutionRepo);
  const buy = new RecordBuy(accountRepo, instrumentRepo, txnRepo, lotRepo);
  const sell = new RecordSell(accountRepo, instrumentRepo, txnRepo, lotRepo);

  /* The bare slug on every call — what the metal form submits. */
  const add = (platform: string) =>
    addInstrument.execute({
      userId,
      symbol: "GOLD999",
      name: `Digital gold - ${platform}`,
      kind: "DIGITAL_GOLD",
      quoteRef: "GOLD999",
      institutionId: platforms.get(platform)!,
    });

  section("a second platform is a second holding, not a second holding per buy");

  const safegold1 = await add("SafeGold");
  const tanishq1 = await add("Tanishq");
  const tanishq2 = await add("Tanishq");
  const tanishq3 = await add("Tanishq");
  const safegold2 = await add("SafeGold");

  checkTrue(
    "every add succeeded",
    safegold1.ok && tanishq1.ok && tanishq2.ok && tanishq3.ok && safegold2.ok,
  );
  if (!safegold1.ok || !tanishq1.ok || !tanishq2.ok || !tanishq3.ok || !safegold2.ok) {
    throw new Error("metal instrument setup failed");
  }

  check("the first platform keeps the bare symbol", safegold1.value.symbol, "GOLD999");
  check("the second platform is qualified once", tanishq1.value.symbol, "GOLD999.TANISHQ");
  check(
    "a repeat buy on the second platform is the same holding",
    tanishq2.value.instrumentId.value,
    tanishq1.value.instrumentId.value,
  );
  check(
    "and still the same on the third",
    tanishq3.value.instrumentId.value,
    tanishq1.value.instrumentId.value,
  );
  check(
    "the first platform stays idempotent too",
    safegold2.value.instrumentId.value,
    safegold1.value.instrumentId.value,
  );
  checkTrue(
    "the two platforms are genuinely different holdings",
    safegold1.value.instrumentId.value !== tanishq1.value.instrumentId.value,
  );

  section("both rows still price");

  for (const [label, id] of [
    ["SafeGold", safegold1.value.instrumentId],
    ["Tanishq", tanishq1.value.instrumentId],
  ] as const) {
    const row = await instrumentRepo.findById(userId, id);
    check(`${label} prices from the bare slug`, row?.props.quoteRef ?? null, "GOLD999");
    check(`${label} is measured in grams`, row?.unit ?? null, "GRAM");
  }

  section("grams bought on the second platform can be sold");

  const bought = await buy.execute({
    userId,
    instrumentId: tanishq1.value.instrumentId,
    fromAccountId: bankId,
    quantity: Quantity.fromString("10"),
    pricePerUnit: Money.fromRupees("7200.00"),
    tradedOn: CalendarDate.parse("2026-02-01"),
  });
  checkTrue("the Tanishq buy went through", bought.ok);
  if (!bought.ok) throw new Error(`default buy failed: ${bought.error.message}`);
  check("RecordBuy still defaults to quantity times price", bought.value.cashPaid.toDecimalString(), "72000.00");

  section("exact metal consideration does not round-trip through display price");

  const exactMetalCost = Money.fromRupees("33950.00");
  const exactCharges = Money.fromRupees("1050.00");
  const exactQuantity = Quantity.fromString("5.25");
  const exactBuy = await buy.execute({
    userId,
    instrumentId: safegold1.value.instrumentId,
    fromAccountId: bankId,
    quantity: exactQuantity,
    pricePerUnit: exactQuantity.perUnit(exactMetalCost),
    consideration: exactMetalCost,
    tradedOn: CalendarDate.parse("2026-02-02"),
    charges: exactCharges,
  });
  checkTrue("the exact-consideration buy went through", exactBuy.ok);
  if (!exactBuy.ok) throw new Error(`exact buy failed: ${exactBuy.error.message}`);
  check("funding debit stays exactly what the user entered", exactBuy.value.cashPaid.toDecimalString(), "35000.00");
  check("cost basis stays exact", exactBuy.value.costBasis.toDecimalString(), "35000.00");
  const exactLots = await lotRepo.openLots(userId, safegold1.value.instrumentId);
  check("lot price cost excludes charges exactly", exactLots[0].remainingCost.toDecimalString(), "33950.00");
  check("lot keeps buy charges separate", exactLots[0].props.buyCharges.toDecimalString(), "1050.00");
  check("lot total invested equals the funding debit", exactLots[0].totalInvested.toDecimalString(), "35000.00");
  check(
    "bank balance reflects the 72000 default buy and exact 35000 metal buy",
    (await balances.balanceOf(userId, bankId, CalendarDate.parse("2026-02-02"))).toDecimalString(),
    "393000.00",
  );

  /* Resolved the way the action does it: the bare slug goes back in, and the
     platform decides which holding it lands on. */
  const resolved = await add("Tanishq");
  checkTrue("re-resolving finds the holding that has the grams", resolved.ok);
  if (!resolved.ok) throw new Error("re-resolve failed");
  check(
    "the sell targets the instrument the buy landed in",
    resolved.value.instrumentId.value,
    tanishq1.value.instrumentId.value,
  );

  const sold = await sell.execute({
    userId,
    instrumentId: resolved.value.instrumentId,
    toAccountId: bankId,
    quantity: Quantity.fromString("5"),
    pricePerUnit: Money.fromRupees("7500.00"),
    tradedOn: CalendarDate.parse("2026-03-01"),
  });
  checkTrue("five of the ten grams sell", sold.ok);
  if (!sold.ok) throw new Error(`sell refused: ${sold.error.message}`);

  const remaining = await lotRepo.openLots(userId, resolved.value.instrumentId);
  check(
    "five grams remain",
    remaining
      .reduce((total, lot) => total.plus(lot.remaining), Quantity.fromString("0"))
      .toDecimalString(),
    "5",
  );

  section("workspace positions expose their registered platform");

  const tanishqPlatform = await institutionRepo.findById(userId, platforms.get("Tanishq")!);
  if (!tanishqPlatform) throw new Error("Tanishq platform disappeared before archive regression");
  await institutionRepo.save(tanishqPlatform.archive());

  const valuation = new ValuePortfolio(instrumentRepo, lotRepo, {
    priceOn: async () => ({
      price: UnitPrice.of("7500.00"),
      pricedOn: CalendarDate.parse("2026-03-01"),
      isStale: false,
      rung: "FIXTURE",
    }),
  });
  const returnFixture = {
    execute: async () => ({
      ok: true as const,
      value: {
        xirr: { ok: false as const, reason: "TOO_FEW_FLOWS" as const, because: "Fixture." },
        invested: Money.zero(),
        withdrawn: Money.zero(),
        currentValue: null,
        absoluteReturn: null,
        flows: [],
      },
    }),
  } as unknown as PortfolioReturns;
  const workspace = await new InvestmentWorkspace(valuation, returnFixture, institutionRepo).execute({
    userId,
    asOf: CalendarDate.parse("2026-03-01"),
  });
  checkTrue("workspace read succeeds", workspace.ok);
  if (!workspace.ok) throw new Error(workspace.error.message);
  const platformBySymbol = new Map(workspace.value.positions.map((position) => [position.symbol, position.platformName]));
  check("SafeGold is explicit", platformBySymbol.get("GOLD999") ?? null, "SafeGold");
  check("archived assigned Tanishq remains explicit", platformBySymbol.get("GOLD999.TANISHQ") ?? null, "Tanishq");

  section("an account-free purchase cannot be a BUY");

  /*
   * Why the metals lane books an opening position rather than a buy. This is a
   * ledger rule, not a preference: a purchase moves cash out of an account, and
   * equity opening balances are not an account cash leaves. The runtime found
   * this the hard way — IllegalTransactionError, L06 — so it is pinned here.
   */
  const matrix = LegalityMatrix.standard();
  checkTrue(
    "a BUY out of opening balances is refused",
    !matrix.permits("BUY", "EQUITY_OPENING", "ASSET_BROKERAGE"),
  );
  checkTrue(
    "an opening balance into a holding is the legal shape",
    matrix.permits("OPENING_BALANCE", "EQUITY_OPENING", "ASSET_BROKERAGE"),
  );

  done();
}

void main();
