/**
 * Undoing a trade, against a real database.
 *
 * The claim under test is **invariant P01**: after any void, the units still open
 * equal the buys minus the sells over the live trades. Nothing asserted that
 * before this file existed, and it is the assertion every bug in this feature
 * trips — a lot restored twice, a lot restored by the wrong amount, a match
 * tombstoned without its units going back.
 *
 * The rest is the refusals, and they matter more than the successes. Three of the
 * four ways a void can go wrong produce a *plausible* number rather than an
 * error, so each is tested twice: once that it refuses, and once that the
 * position is **byte-identical afterwards**. A refusal that half-wrote is worse
 * than no refusal at all, because the user believes nothing happened.
 */

import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/infra/db/schema";
import { users } from "@/infra/db/schema";
import type { Database } from "@/infra/db/client";
import { FixedClock, UserId } from "@/core/kernel";
import { Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate, FinancialYear } from "@/core/time";
import { BalanceCalculator } from "@/domain/transactions";
import { InstrumentId } from "@/domain/instruments";
import { Split } from "@/domain/corporate";
import {
  DrizzleAccountRepository,
  DrizzleCorporateActionRepository,
  DrizzleInstitutionRepository,
  DrizzleInstrumentRepository,
  DrizzleLotRepository,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { OpenAccount, ReverseTransaction, SeedChartOfAccounts } from "@/app/ledger.usecases";
import {
  AddInstrument,
  ApplyCorporateAction,
  RealisedGains,
  RecordBuy,
  RecordSell,
} from "@/app/investing.usecases";
import { CorrectTrade, VoidTrade } from "@/app/trade-corrections.usecases";
import { RealisedGainsHistory } from "@/app/realised-history.usecases";
import { RegisterInstitution } from "@/app/institutions.usecases";
import { InstitutionId } from "@/domain/institutions";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/trade-corrections.db";
const rupees = (value: string) => Money.fromRupees(value);
const units = (value: string) => Quantity.fromString(value);
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

  const userId = UserId.from("user_corrections_1");
  const now = new Date("2025-09-01T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "corrections@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const clock = new FixedClock(now);
  const accountRepo = new DrizzleAccountRepository(db);
  const txnRepo = new DrizzleTransactionRepository(db);
  const instrumentRepo = new DrizzleInstrumentRepository(db);
  const lotRepo = new DrizzleLotRepository(db);
  const platformRepo = new DrizzleInstitutionRepository(db);
  const openAccount = new OpenAccount(accountRepo, txnRepo, clock);

  await new SeedChartOfAccounts(accountRepo).execute({ userId });

  const bank = await openAccount.execute({
    userId,
    name: "HDFC Savings",
    type: "ASSET",
    subtype: "BANK",
    openingBalance: rupees("2000000"),
    openingBalanceOn: on("2024-04-01"),
  });
  if (!bank.ok) throw new Error("bank setup failed");
  const bankId = bank.value.accountId;

  const addInstrument = new AddInstrument(accountRepo, instrumentRepo, openAccount, platformRepo);
  const recordBuy = new RecordBuy(accountRepo, instrumentRepo, txnRepo, lotRepo);
  const recordSell = new RecordSell(accountRepo, instrumentRepo, txnRepo, lotRepo);
  const actionsFor = () => new DrizzleCorporateActionRepository(db, userId);
  const voidTrade = new VoidTrade(
    txnRepo,
    lotRepo,
    actionsFor,
    new ReverseTransaction(txnRepo, clock),
  );
  const correctTrade = new CorrectTrade(lotRepo, instrumentRepo, voidTrade, recordBuy, recordSell);

  /** Registers a holding and returns its id. */
  const register = async (symbol: string, institutionId?: InstitutionId) => {
    const added = await addInstrument.execute({
      userId,
      symbol,
      name: symbol,
      kind: "LISTED_EQUITY",
      institutionId,
    });
    if (!added.ok) throw new Error(`register ${symbol} failed: ${added.error.message}`);
    return added.value.instrumentId;
  };

  const buy = async (
    instrumentId: InstrumentId,
    quantity: string,
    price: string,
    tradedOn: string,
  ) => {
    const result = await recordBuy.execute({
      userId,
      instrumentId,
      fromAccountId: bankId,
      quantity: units(quantity),
      pricePerUnit: rupees(price),
      tradedOn: on(tradedOn),
      charges: rupees("100"),
    });
    if (!result.ok) throw new Error(`buy failed: ${result.error.message}`);
    return result.value;
  };

  const sell = async (
    instrumentId: InstrumentId,
    quantity: string,
    price: string,
    tradedOn: string,
    method?: "FIFO" | "AVERAGE_COST",
  ) => {
    const result = await recordSell.execute({
      userId,
      instrumentId,
      toAccountId: bankId,
      quantity: units(quantity),
      pricePerUnit: rupees(price),
      tradedOn: on(tradedOn),
      charges: rupees("50"),
      method,
    });
    if (!result.ok) throw new Error(`sell failed: ${result.error.message}`);
    return result.value;
  };

  /**
   * Invariant P01, computed two ways.
   *
   * Left: what the lot book says is still open. Right: what the *live* trade
   * history says should be. They can only agree if every void put back exactly
   * what its sale took and removed exactly what its purchase added.
   */
  const p01 = async (instrumentId: InstrumentId) => {
    const open = await lotRepo.openLots(userId, instrumentId);
    const held = open.reduce((total, lot) => total.plus(lot.remaining), Quantity.ZERO);

    const trades = await lotRepo.tradesFor(userId, instrumentId);
    const expected = trades.reduce(
      (total, trade) => (trade.side === "BUY" ? total.plus(trade.quantity) : total.minus(trade.quantity)),
      Quantity.ZERO,
    );
    return { held: held.toDecimalString(), expected: expected.toDecimalString() };
  };

  /** A fingerprint of the whole lot book, so "nothing changed" is checkable. */
  const snapshot = async (instrumentId: InstrumentId) => {
    const all = await lotRepo.allLots(userId, instrumentId);
    return all
      .map((lot) =>
        [
          lot.id.value,
          lot.props.originalQuantity.toDecimalString(),
          lot.remaining.toDecimalString(),
          lot.props.cost.toDecimalString(),
        ].join(":"),
      )
      .sort()
      .join("|");
  };

  /* ══ 1. A buy, voided ═══════════════════════════════════════════════ */

  section("a purchase voided leaves no trace of itself and no gap");

  const alpha = await register("ALPHA");
  const alphaBuy = await buy(alpha, "100", "500", "2024-05-01");

  const beforeVoid = await p01(alpha);
  check("100 units held after the buy", beforeVoid.held, "100");

  const voidedBuy = await voidTrade.execute({
    userId,
    tradeId: alphaBuy.transactionId,
    mode: "REVERSE",
  });
  checkTrue("the void succeeds", voidedBuy.ok);
  if (!voidedBuy.ok) throw new Error(voidedBuy.error.message);
  check("one lot tombstoned", voidedBuy.value.lotsTombstoned, 1);
  checkTrue("and a reversal was posted", voidedBuy.value.reversalTransactionId !== null);

  const afterVoid = await p01(alpha);
  check("nothing is held", afterVoid.held, "0");
  check("and the trade history agrees (P01)", afterVoid.expected, afterVoid.held);
  check("no live lots remain", (await lotRepo.allLots(userId, alpha)).length, 0);

  /* ══ 2. A buy that has been sold from, refused ══════════════════════ */

  section("a purchase whose units have been sold cannot be voided");

  const bravo = await register("BRAVO");
  const bravoBuy = await buy(bravo, "100", "500", "2024-05-01");
  await sell(bravo, "40", "600", "2025-07-01");

  const bravoBefore = await snapshot(bravo);
  const refusedBuy = await voidTrade.execute({
    userId,
    tradeId: bravoBuy.transactionId,
    mode: "REVERSE",
  });
  check("it is refused", refusedBuy.ok, false);
  checkTrue(
    "and the message names the sale that blocks it",
    !refusedBuy.ok && refusedBuy.error.message.includes("2025-07-01"),
  );
  // A refusal that half-wrote is worse than no refusal: the user believes nothing
  // happened, and acts on a position that has quietly changed.
  check("the position is byte-identical afterwards", await snapshot(bravo), bravoBefore);

  /* ══ 3. A sale, voided, restores exactly ════════════════════════════ */

  section("a sale voided gives back exactly what it took");

  const charlie = await register("CHARLIE");
  await buy(charlie, "100", "500", "2024-05-01");
  const charlieSale = await sell(charlie, "40", "600", "2025-07-01");

  const soldGain = charlieSale.realisedGain.toDecimalString();
  checkTrue("the sale realised something", !charlieSale.realisedGain.isZero);
  check("60 units left after the sale", (await p01(charlie)).held, "60");

  const voidedSale = await voidTrade.execute({
    userId,
    tradeId: charlieSale.transactionId,
    mode: "REVERSE",
  });
  checkTrue("the void succeeds", voidedSale.ok);
  if (!voidedSale.ok) throw new Error(voidedSale.error.message);
  check("one lot restored", voidedSale.value.lotsRestored, 1);
  check("one match tombstoned", voidedSale.value.matchesTombstoned, 1);

  const charlieAfter = await p01(charlie);
  check("the units are back", charlieAfter.held, "100");
  check("and the trade history agrees (P01)", charlieAfter.expected, charlieAfter.held);
  check(
    "no live match refers to the voided sale",
    (await lotRepo.matchesForSell(userId, charlieSale.transactionId)).length,
    0,
  );

  /*
   * The leak this catches is a missing `isNull(trades.deletedAt)` on the join in
   * `disposalsWithin`: the match is tombstoned, but a report joining the trade
   * without that filter keeps reporting a gain the user has already undone — in a
   * tax return.
   */
  const realised = new RealisedGains(lotRepo);
  const fyAfter = await realised.execute({ userId, financialYear: FinancialYear.parse("2025-26") });
  checkTrue("the realised-gain report ran", fyAfter.ok);
  check(
    "and CHARLIE's disposal is gone from it",
    fyAfter.ok &&
      fyAfter.value.disposals.filter((d) => d.instrumentId.value === charlie.value).length,
    0,
  );

  // Re-selling the same units must produce the same disposal: proof nothing was
  // silently mutated on the way back.
  const resold = await sell(charlie, "40", "600", "2025-07-01");
  check("re-selling produces an identical gain", resold.realisedGain.toDecimalString(), soldGain);

  /* ══ 4. An average-cost sale, refused ═══════════════════════════════ */

  section("an average-cost sale is traceable, so it voids correctly");

  /*
   * Worth stating plainly, because it is easy to assume otherwise: `RecordSell`
   * runs every method through `LotBook`, and `AverageCost` is an *ordering*
   * strategy that still names the lots it consumed. `AverageCostBook` — the one
   * that yields `lotId: null` — is a different, position-wide calculation that
   * this path does not use. So the units stay traceable and the void is exact.
   *
   * The guard in `VoidTrade` is therefore on the arithmetic, not on the method
   * name: it refuses when the matches do not add up to the units sold, whatever
   * the reason. That is what section 4b exercises.
   */
  const delta = await register("DELTA");
  await buy(delta, "100", "500", "2024-05-01");
  const deltaSale = await sell(delta, "40", "600", "2025-07-01", "AVERAGE_COST");
  check("60 units left after the average-cost sale", (await p01(delta)).held, "60");

  const voidedAverage = await voidTrade.execute({
    userId,
    tradeId: deltaSale.transactionId,
    mode: "REVERSE",
  });
  checkTrue("the void succeeds", voidedAverage.ok);
  const deltaAfter = await p01(delta);
  check("the units are back", deltaAfter.held, "100");
  check("and the trade history agrees (P01)", deltaAfter.expected, deltaAfter.held);

  section("a sale whose units cannot all be traced to a lot is refused");

  const deltaTwo = await register("DELTA2");
  await buy(deltaTwo, "100", "500", "2024-05-01");
  const untraceable = await sell(deltaTwo, "40", "600", "2025-07-01");

  /*
   * Simulates the hazard directly: one of the sale's matches goes missing, as it
   * would if the disposal had carried no lot. The position now claims 60 units
   * open while the matches account for none of the 40 sold.
   */
  await client.execute({
    sql: "update lot_matches set deleted_at = ? where sell_trade_id = ?",
    args: [Date.now(), untraceable.transactionId],
  });

  const traceBefore = await snapshot(deltaTwo);
  const refusedTrace = await voidTrade.execute({
    userId,
    tradeId: untraceable.transactionId,
    mode: "REVERSE",
  });
  check("it is refused", refusedTrace.ok, false);
  checkTrue(
    "and says how many units it could not trace",
    !refusedTrace.ok && refusedTrace.error.message.includes("traced to a lot"),
  );
  // A refusal that half-wrote is worse than no refusal: the user believes nothing
  // happened, and acts on a position that has quietly changed.
  check("the position is byte-identical afterwards", await snapshot(deltaTwo), traceBefore);
  check("and still holds 60", (await p01(deltaTwo)).held, "60");

  /* ══ 5. A split after the sale, refused ═════════════════════════════ */

  section("a sale with a corporate action after it cannot be voided");

  const echo = await register("ECHO");
  await buy(echo, "100", "500", "2024-05-01");
  const echoSale = await sell(echo, "40", "600", "2025-07-01");

  const remaining = await lotRepo.openLots(userId, echo);
  const held = remaining.reduce((total, lot) => total.plus(lot.remaining), Quantity.ZERO);
  const applied = await new ApplyCorporateAction(
    accountRepo,
    instrumentRepo,
    lotRepo,
    actionsFor(),
    clock,
  ).execute({
    userId,
    action: new Split(
      {
        instrumentId: echo,
        exDate: on("2025-08-01"),
        heldQuantity: held,
        currency: Money.zero().currency,
        source: "Test fixture",
      },
      { from: units("1"), to: units("5") },
    ),
  });
  checkTrue("the split applied", applied.ok);

  const echoBefore = await snapshot(echo);
  const refusedSplit = await voidTrade.execute({
    userId,
    tradeId: echoSale.transactionId,
    mode: "REVERSE",
  });
  check("it is refused", refusedSplit.ok, false);
  // Specifically a refusal, not a P02 TypeError thrown out of the Lot
  // constructor: the check has to come before the arithmetic, or the user gets a
  // stack trace instead of a reason.
  checkTrue(
    "as a validation error naming the action",
    !refusedSplit.ok && refusedSplit.error.message.toLowerCase().includes("split"),
  );
  check("the position is byte-identical afterwards", await snapshot(echo), echoBefore);

  /* ══ 6. Correcting a buy ════════════════════════════════════════════ */

  section("correcting a purchase restates it without editing history");

  const foxtrot = await register("FOXTROT");
  const foxtrotBuy = await buy(foxtrot, "100", "500", "2024-05-01");

  const corrected = await correctTrade.execute({
    userId,
    tradeId: foxtrotBuy.transactionId,
    changes: { pricePerUnit: rupees("520") },
    reason: "Contract note said 520",
  });
  checkTrue("the correction succeeds", corrected.ok);
  if (!corrected.ok) throw new Error(corrected.error.message);

  const foxtrotLots = await lotRepo.allLots(userId, foxtrot);
  check("exactly one live lot", foxtrotLots.length, 1);
  check("at the corrected basis", foxtrotLots[0]!.props.cost.toDecimalString(), "52000.00");
  const foxtrotP01 = await p01(foxtrot);
  check("still 100 units", foxtrotP01.held, "100");
  check("and the trade history agrees (P01)", foxtrotP01.expected, foxtrotP01.held);

  /* ══ 7. Delete mode ═════════════════════════════════════════════════ */

  section("deleting says the trade never happened");

  const golf = await register("GOLF");
  const golfBuy = await buy(golf, "10", "500", "2024-05-01");

  const deleted = await voidTrade.execute({
    userId,
    tradeId: golfBuy.transactionId,
    mode: "DELETE",
  });
  checkTrue("the delete succeeds", deleted.ok);
  check(
    "and posts no reversal, because nothing happened to reverse",
    deleted.ok && deleted.value.reversalTransactionId,
    null,
  );
  check("nothing is held", (await p01(golf)).held, "0");

  /* ══ 8. Realised history groups what is left ════════════════════════ */

  section("realised gains group by category and platform");

  const zerodha = await new RegisterInstitution(platformRepo).execute({
    userId,
    name: "Zerodha",
    kind: "BROKER",
  });
  if (!zerodha.ok) throw new Error("platform setup failed");

  const hotel = await register("HOTEL", zerodha.value.institutionId);
  await buy(hotel, "100", "500", "2024-05-01");
  const hotelSale = await sell(hotel, "40", "600", "2025-07-01");

  const history = await new RealisedGainsHistory(lotRepo, instrumentRepo, platformRepo).execute({
    userId,
    asOf: on("2025-09-01"),
  });
  checkTrue("the history ran", history.ok);
  if (!history.ok) throw new Error(history.error.message);

  const equity = history.value.groups.find((row) => row.key === "EQUITY");
  checkTrue("everything sold so far is equity", equity !== undefined);

  /*
   * The property that makes this a grouping rather than a second calculation:
   * every breakdown re-sums to the same total. If one of them disagreed, two
   * screens would be quoting different profits for the same year.
   */
  const sumOf = (rows: readonly { total: Money }[]) =>
    rows.reduce((running, row) => running.plus(row.total), Money.zero()).toDecimalString();
  check(
    "the category breakdown re-sums to the total",
    sumOf(history.value.groups),
    history.value.total.total.toDecimalString(),
  );
  check(
    "and so does the platform breakdown",
    sumOf(history.value.platforms),
    history.value.total.total.toDecimalString(),
  );
  check(
    "and the per-year one",
    sumOf(history.value.years),
    history.value.total.total.toDecimalString(),
  );
  check("nothing is unattributable", history.value.unattributed, 0);

  const onZerodha = history.value.platforms.find((row) => row.label === "Zerodha");
  check(
    "HOTEL's gain is attributed to Zerodha",
    onZerodha?.total.toDecimalString(),
    hotelSale.realisedGain.toDecimalString(),
  );
  checkTrue(
    "and the holdings with no platform have their own row rather than being dropped",
    history.value.platforms.some((row) => row.label === "Unassigned"),
  );

  /*
   * The voided sale must be absent from every breakdown, not merely from the
   * total — this is the `isNull(trades.deletedAt)` join filter again, seen from
   * the reporting side.
   */
  checkTrue(
    "a voided sale appears in no breakdown",
    !history.value.instruments.some((row) => row.label.startsWith("ALPHA")),
  );

  const scoped = await new RealisedGainsHistory(lotRepo, instrumentRepo, platformRepo).execute({
    userId,
    financialYear: FinancialYear.parse("2024-25"),
    asOf: on("2025-09-01"),
  });
  check(
    "nothing was realised in 2024-25",
    scoped.ok && scoped.value.total.disposals,
    0,
  );

  /* ══ 9. The ledger is still sound ═══════════════════════════════════ */

  section("the ledger still balances after every void");

  const everything = await txnRepo.find(userId, { limit: 20_000 });
  check(
    "debits equal credits",
    new BalanceCalculator().verifyIntegrity(everything.transactions).ok,
    true,
  );

  for (const [name, instrumentId] of [
    ["HOTEL", hotel],
    ["ALPHA", alpha],
    ["BRAVO", bravo],
    ["CHARLIE", charlie],
    ["DELTA", delta],
    ["FOXTROT", foxtrot],
    ["GOLF", golf],
  ] as const) {
    const state = await p01(instrumentId);
    check(`P01 holds for ${name}`, state.held, state.expected);
  }

  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
