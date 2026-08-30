/**
 * Gold leasing, end to end — the Phase 9a gate.
 *
 * "The holding's quantity, the income total and the lot's cost basis all move
 * together, and B02 still holds."
 *
 * The claim under test is the one that makes leasing worth wiring into the ledger
 * at all: **interest paid in grams is income now and cost basis later.** Book it
 * any other way and the same gold is taxed twice — once as interest, and again as
 * a larger capital gain when it is sold.
 *
 * Run against a real libSQL file through the real migrations, so the check
 * constraints and the mapper are exercised rather than mocked.
 */

import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import { AccountCode } from "@/domain/accounts";
import { BalanceCalculator } from "@/domain/transactions";
import { InstrumentId, type PriceLookup } from "@/domain/instruments";
import { OpenAccount, SeedChartOfAccounts } from "@/app/ledger.usecases";
import { AddInstrument, RecordBuy } from "@/app/investing.usecases";
import { BuildStatements } from "@/app/reports.usecases";
import {
  AccrueLeaseInterest,
  ListGoldLeases,
  OpenGoldLease,
  SettleGoldLease,
} from "@/app/leasing.usecases";
import {
  DrizzleAccountRepository,
  DrizzleBalanceQuery,
  DrizzleGoldLeaseRepository,
  DrizzleInstrumentRepository,
  DrizzleLotRepository,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/leasing-integration.spec.db";
const on = (value: string) => CalendarDate.parse(value);
const grams = (value: string) => Quantity.fromString(value);
const rupees = (value: string) => Money.fromRupees(value, Currency.INR);

/** A price book that answers with whatever the test set for the date. */
class ScriptedPrices implements PriceLookup {
  constructor(private readonly byDate: Record<string, string | null>) {}

  async priceOn(_ref: Parameters<PriceLookup["priceOn"]>[0], asOf: CalendarDate) {
    const value = this.byDate[asOf.toISO()] ?? null;
    return {
      price: value === null ? null : UnitPrice.of(value, Currency.INR),
      pricedOn: value === null ? null : asOf,
      isStale: false,
      rung: value === null ? "UNAVAILABLE" : "EXACT",
    };
  }
}

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

  const userId = UserId.from("user_leasing_1");
  const now = new Date("2026-08-15T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "leasing@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const accounts = new DrizzleAccountRepository(db);
  const journal = new DrizzleTransactionRepository(db);
  const balances = new DrizzleBalanceQuery(db);
  const instruments = new DrizzleInstrumentRepository(db);
  const lots = new DrizzleLotRepository(db);
  const leaseRepo = new DrizzleGoldLeaseRepository(db);
  const clock = new FixedClock(now);

  await new SeedChartOfAccounts(accounts).execute({ userId });
  const openAccount = new OpenAccount(accounts, journal, clock);

  const bank = await openAccount.execute({
    userId,
    name: "Savings",
    type: "ASSET",
    subtype: "SAVINGS",
    openingBalance: rupees("200000"),
    openingBalanceOn: on("2026-01-01"),
  });
  if (!bank.ok) throw new Error(bank.error.message);

  /* ── The gold, bought before it can be leased ─────────────────────── */

  const added = await new AddInstrument(accounts, instruments, openAccount).execute({
    userId,
    symbol: "SGOLD",
    name: "SafeGold 24k",
    kind: "DIGITAL_GOLD",
  });
  if (!added.ok) throw new Error(added.error.message);
  const goldId = added.value.instrumentId;

  // 4.7165g at ₹15,900/g — the sheet's own figures.
  const bought = await new RecordBuy(accounts, instruments, journal, lots).execute({
    userId,
    instrumentId: goldId,
    fromAccountId: bank.value.accountId,
    quantity: grams("4.7165"),
    pricePerUnit: rupees("15900"),
    tradedOn: on("2025-12-23"),
  });
  if (!bought.ok) throw new Error(bought.error.message);

  section("a lease puts gold to work without moving it");

  const openLease = new OpenGoldLease(instruments, leaseRepo, lots);
  const beforeAnyLease = await new ListGoldLeases(
    instruments,
    leaseRepo,
    lots,
    new ScriptedPrices({}),
  ).execute({
    userId,
    asOf: on("2026-01-15"),
    instrumentId: goldId,
  });
  checkTrue("the lease screen loads before any lease exists", beforeAnyLease.ok);
  if (!beforeAnyLease.ok) return;
  check(
    "all held gold starts available to lease",
    beforeAnyLease.value.unleasedGrams.toDecimalString(),
    "4.7165",
  );

  const opened = await openLease.execute({
    userId,
    instrumentId: goldId,
    platform: "SafeGold",
    quantity: grams("4.3989"),
    startOn: on("2026-01-15"),
    closesOn: on("2027-01-15"),
    annualRate: Percentage.of("4"),
  });
  checkTrue("the lease opened", opened.ok);
  if (!opened.ok) return;
  check("with a generated reference", opened.value.reference, "LEASE-0001");
  check("and the wallet keeps the rest", opened.value.unleased.toDecimalString(), "0.3176");
  check("no warning, because the gold exists", opened.value.warnings.length, 0);

  const balanceAfterOpening = await balances.balanceOf(userId, added.value.accountId, on("2026-01-15"));
  // 4.7165 × 15,900 = 75,  the holding is untouched by the lease.
  check(
    "the holding account is unchanged — leasing is not a disposal",
    balanceAfterOpening.toDecimalString(),
    grams("4.7165").valueAt(rupees("15900")).toDecimalString(),
  );

  section("over-leasing is refused");

  const overLease = await openLease.execute({
    userId,
    instrumentId: goldId,
    platform: "SafeGold",
    quantity: grams("2"),
    startOn: on("2026-02-01"),
    closesOn: on("2027-02-01"),
    annualRate: Percentage.of("4"),
  });
  checkTrue("the second lease cannot exceed the wallet balance", !overLease.ok);
  if (overLease.ok) return;
  checkTrue(
    "and the refusal names the available grams",
    overLease.error.message.includes("Only 0.3176g is currently available"),
  );
  const settle = new SettleGoldLease(leaseRepo);

  section("the accrual books grams as income, and as cost basis");

  const prices = new ScriptedPrices({
    "2026-08-15": "16400",
    "2026-09-15": "16500",
    "2026-11-20": null,
  });
  const accrue = new AccrueLeaseInterest(accounts, instruments, leaseRepo, journal, lots, prices);
  const lease = (await leaseRepo.findByReference(userId, "LEASE-0001"))!;

  const first = await accrue.execute({ userId, leaseId: lease.id, asOf: on("2026-08-15") });
  checkTrue("the accrual ran", first.ok);
  if (!first.ok) return;
  check("seven completed months", first.value.accrual.monthsCompleted, 7);
  check("net grams booked", first.value.postedGrams.toDecimalString(), "0.0923769");
  // 0.102641g gross × ₹16,400 = ₹1,683.3124 → ₹1,683.31; the net 0.0923769g is
  // ₹1,514.98, and the TDS leg is the difference so the three legs balance.
  check("gross income recognised", first.value.grossValue.toDecimalString(), "1683.31");
  check("TDS booked as an asset", first.value.tdsValue.toDecimalString(), "168.33");
  check("and the net reached the holding", first.value.netValue.toDecimalString(), "1514.98");
  checkTrue(
    "the reason names the price it was valued at",
    first.value.because.includes("16400"),
  );

  const incomeAccount = (await accounts.findByCode(userId, AccountCode.parse("Income:Investing:Interest")))!;
  const tdsAccount = (await accounts.findByCode(userId, AccountCode.parse("Assets:Receivables:TDS")))!;

  check(
    "the income account carries the gross",
    (await balances.balanceOf(userId, incomeAccount.id, on("2026-08-15"))).toDecimalString(),
    "1683.31",
  );
  check(
    "the TDS asset carries what was withheld",
    (await balances.balanceOf(userId, tdsAccount.id, on("2026-08-15"))).toDecimalString(),
    "168.33",
  );

  const holdingAfter = await balances.balanceOf(userId, added.value.accountId, on("2026-08-15"));
  check(
    "and the holding grew by exactly the net value",
    holdingAfter.minus(balanceAfterOpening).toDecimalString(),
    "1514.98",
  );

  const openLots = await lots.openLots(userId, goldId);
  check("there are now two lots", openLots.length, 2);
  const interestLot = openLots.find((one) => one.remaining.equals(grams("0.0923769")));
  checkTrue("one for the interest grams", interestLot !== undefined);
  check(
    "opened at the value it was taxed at, so the gold is not taxed twice",
    interestLot?.props.cost.toDecimalString(),
    "1514.98",
  );
  check(
    "total grams held is principal plus interest",
    Quantity.sum(openLots.map((one) => one.remaining)).toDecimalString(),
    "4.8088769",
  );

  section("a second run on the same day books nothing");

  const repeat = await accrue.execute({ userId, leaseId: lease.id, asOf: on("2026-08-15") });
  if (!repeat.ok) return;
  check("no transaction", repeat.value.transactionId, null);
  check("no grams", repeat.value.postedGrams.toDecimalString(), "0");
  checkTrue("and it says why", repeat.value.because.includes("already been booked"));
  check(
    "the income account did not move",
    (await balances.balanceOf(userId, incomeAccount.id, on("2026-08-15"))).toDecimalString(),
    "1683.31",
  );

  section("a month later, one month is booked — not eight");

  const second = await accrue.execute({ userId, leaseId: lease.id, asOf: on("2026-09-15") });
  if (!second.ok) return;
  check("eight completed months now", second.value.accrual.monthsCompleted, 8);
  // Eight months gross is 0.117304g, net 0.1055736g; less the 0.0923769g already
  // booked, this run posts exactly one month.
  check("only the new month is posted", second.value.postedGrams.toDecimalString(), "0.0131967");
  checkTrue("at the newer price", second.value.because.includes("16500"));

  section("no price means no accrual, rather than a zero one");

  const unpriced = await accrue.execute({ userId, leaseId: lease.id, asOf: on("2026-11-20") });
  checkTrue("the accrual is refused", !unpriced.ok);
  if (!unpriced.ok) {
    checkTrue(
      "and the refusal explains itself",
      unpriced.error.message.includes("booking them at nothing would understate"),
    );
  }

  section("B02 still holds after gold arrived as income");

  /*
   * The identity is the real test of an in-kind posting. Income went up by the
   * gross, an asset (the TDS receivable) by the withheld part and the holding by
   * the net — three legs across three account *types*, which is exactly the shape
   * that breaks a ledger when one of them is wrong.
   */
  const statements = await new BuildStatements(balances).execute({
    userId,
    asOf: on("2026-09-15"),
    period: DateRange.of(on("2026-04-01"), on("2026-09-15")),
  });
  checkTrue("the statements built", statements.ok);
  if (!statements.ok) return;
  check("B02 holds", statements.value.identityHolds, true);
  check("with a zero difference", statements.value.identityDifference.toDecimalString(), "0.00");
  checkTrue(
    "and the interest shows up as income",
    statements.value.incomeStatement.income.total.isPositive,
  );

  const page = await journal.find(userId, { limit: 200 });
  const integrity = new BalanceCalculator().verifyIntegrity(page.transactions);
  checkTrue("total debits equal total credits across every posting", integrity.ok);
  check("and no transaction is offending", integrity.offendingTransactionIds.length, 0);

  section("the lease screen answers in grams and in rupees");

  const list = await new ListGoldLeases(instruments, leaseRepo, lots, prices).execute({
    userId,
    asOf: on("2026-09-15"),
  });
  checkTrue("the screen loaded", list.ok);
  if (!list.ok) return;
  check("one valid lease is listed", list.value.rows.length, 1);
  check(
    "grams on lease counts only the active one",
    list.value.portfolio.leasedGrams.toDecimalString(),
    "4.3989",
  );
  check(
    "net interest to date",
    list.value.portfolio.netInterestGrams.toDecimalString(),
    "0.1055736",
  );
  check(
    "nothing is left unposted right after an accrual",
    list.value.portfolio.unpostedGrams.toDecimalString(),
    "0",
  );
  checkTrue("the portfolio has a value", list.value.portfolio.value !== null);

  /*
   * The screen's own contract, asserted rather than eyeballed: the value shown on
   * `/investments` is *principal plus net accrued interest*, at the day's gram
   * price. Computed here from the two grams figures the screen renders beside it,
   * so a change that made the total disagree with its own breakdown would fail —
   * which is the failure a reader of the screen could never catch by looking.
   */
  const expected = UnitPrice.of("16500", Currency.INR).times(
    list.value.portfolio.leasedGrams.plus(list.value.portfolio.netInterestGrams),
  );
  check(
    "the value is the grams on screen times the day's price",
    list.value.portfolio.value?.toDecimalString(),
    expected.toDecimalString(),
  );
  checkTrue("and a return over cost", list.value.returnOnCost !== null);
  check("no lease is overdue for settlement", list.value.portfolio.matured.length, 0);

  section("a settled lease stops accruing and cannot be reopened");

  const matured = await settle.execute({
    userId,
    leaseId: lease.id,
    outcome: "MATURED",
    endedOn: on("2026-09-15"),
  });
  checkTrue("it settles", matured.ok);
  if (matured.ok) {
    check("with nothing left unbooked", matured.value.unpostedGrams.toDecimalString(), "0");
  }
  const reopened = await settle.execute({
    userId,
    leaseId: lease.id,
    outcome: "MATURED",
    endedOn: on("2026-10-15"),
  });
  checkTrue("settling twice is refused", !reopened.ok);

  const afterSettlement = await accrue.execute({ userId, leaseId: lease.id, asOf: on("2027-01-15") });
  if (afterSettlement.ok) {
    check(
      "and a settled lease accrues nothing further",
      afterSettlement.value.postedGrams.toDecimalString(),
      "0",
    );
  }

  section("the store refuses an impossible lease even by raw SQL");

  let rejected = "no";
  try {
    await client.execute(
      `insert into gold_leases (id, user_id, reference, instrument_id, holding_account_id, platform,
        quantity_scaled, start_on, closes_on, annual_rate_scaled, tds_rate_scaled, status,
        credited_quantity_scaled, created_at, updated_at)
       values ('raw-1', '${userId.value}', 'LEASE-RAW', '${goldId.value}', '${added.value.accountId.value}',
        'X', 100000000, '2026-05-01', '2026-01-01', 4000000, 10000000, 'ACTIVE', 0, 1, 1)`,
    );
  } catch {
    rejected = "yes";
  }
  check("a closing date before the start date is rejected by the constraint", rejected, "yes");

  done();
}

void main();
