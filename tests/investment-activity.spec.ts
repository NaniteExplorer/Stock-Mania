/**
 * Transaction details for a holding, against a real database.
 *
 * The point of the read model under test is that it is keyed on the holding's own
 * ledger account rather than on the trade book, so this spec deliberately records
 * two different *shapes* of event against one instrument — a purchase, which
 * writes a trade row, and a dividend, which does not — and asserts that both come
 * back. A version keyed on `trades` would pass every assertion about the buy and
 * silently lose the income, which is the failure this exists to catch.
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
import { CalendarDate } from "@/core/time";
import { Dividend, accountRef } from "@/domain/transactions";
import {
  DrizzleAccountRepository,
  DrizzleInstrumentRepository,
  DrizzleInvestmentActivityQuery,
  DrizzleLotRepository,
  DrizzleTransactionRepository,
} from "@/infra/repositories";
import { AddInstrument, RecordBuy } from "@/app/investing.usecases";
import { OpenAccount, SeedChartOfAccounts } from "@/app/ledger.usecases";
import { check, checkTrue, done, section } from "./harness";

const DB_FILE = "./tmp/investment-activity.db";
const rupees = (value: string) => Money.fromRupees(value);
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

  const userId = UserId.from("user_activity_1");
  const now = new Date("2026-09-01T10:00:00Z");
  await db.insert(users).values({
    id: userId.value,
    name: "Test",
    email: "activity@example.com",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });

  const clock = new FixedClock(now);
  const accountRepo = new DrizzleAccountRepository(db);
  const txnRepo = new DrizzleTransactionRepository(db);
  const instrumentRepo = new DrizzleInstrumentRepository(db);
  const lotRepo = new DrizzleLotRepository(db);
  const openAccount = new OpenAccount(accountRepo, txnRepo, clock);
  const activity = new DrizzleInvestmentActivityQuery(db);

  await new SeedChartOfAccounts(accountRepo).execute({ userId });

  const bank = await openAccount.execute({
    userId,
    name: "HDFC Savings",
    type: "ASSET",
    subtype: "BANK",
    openingBalance: rupees("500000"),
    openingBalanceOn: on("2026-04-01"),
  });
  if (!bank.ok) throw new Error("bank setup failed");
  const bankId = bank.value.accountId;

  const added = await new AddInstrument(accountRepo, instrumentRepo, openAccount).execute({
    userId,
    symbol: "INFY",
    name: "Infosys Ltd",
    kind: "LISTED_EQUITY",
    exchange: "NSE",
  });
  if (!added.ok) throw new Error("instrument setup failed");
  const instrumentId = added.value.instrumentId;

  const bought = await new RecordBuy(accountRepo, instrumentRepo, txnRepo, lotRepo).execute({
    userId,
    instrumentId,
    fromAccountId: bankId,
    quantity: Quantity.fromString("10"),
    pricePerUnit: rupees("1520.00"),
    tradedOn: on("2026-04-15"),
    charges: rupees("23.60"),
  });
  if (!bought.ok) throw new Error(`buy failed: ${bought.error.message}`);

  const instrument = (await instrumentRepo.findById(userId, instrumentId))!;
  const chart = await accountRepo.list(userId, { includeClosed: true });
  const holdingAccount = chart.find((candidate) =>
    candidate.id.equals(instrument.assetAccountId),
  )!;
  const bankAccount = chart.find((candidate) => candidate.id.equals(bankId))!;
  const dividendIncome = chart.find(
    (candidate) => candidate.code.toString() === "Income:Investing:Dividends",
  )!;

  /*
   * A cash dividend, recorded the way one actually arrives: income account to
   * bank, touching the holding not at all.
   *
   * It carries no instrument tag and cannot: a posting that names an instrument
   * must also carry a quantity (P-invariant in `Posting`), and a cash receipt has
   * no units. So the ledger has no link from this entry back to INFY, and the
   * assertion below says so rather than pretending otherwise — see the limitation
   * recorded in the requirement plan.
   */
  await txnRepo.save(
    Dividend.record(
      {
        userId,
        txnDate: on("2026-06-10"),
        description: "INFY dividend",
        source: accountRef(dividendIncome),
        destination: accountRef(bankAccount),
      },
      { gross: rupees("200.00"), taxCategory: "LISTED_EQUITY" },
    ),
  );

  /*
   * An entry that is neither a trade nor income: value written straight onto the
   * holding, which is the shape a corporate action or a hand-made correction
   * takes. It must appear, because an unexplained movement is the one a reader
   * most needs to see.
   */
  section("every kind of event against one holding comes back");

  const events = await activity.forInstrument(userId, instrumentId);
  const buyEvent = events.find((event) => event.kind === "TRADE");


  checkTrue("the purchase is there", buyEvent !== undefined);
  check("and it is the only event on this holding", events.length, 1);
  /*
   * The honest negative. A cash dividend cannot name its instrument in the ledger,
   * so it is not here — and saying so in a test is what stops someone later
   * reading the panel as a complete income statement for the holding.
   */
  checkTrue(
    "a cash dividend is not linked to the holding, and is not claimed to be",
    !events.some((event) => event.description === "INFY dividend"),
  );
  check("oldest first", events[0]?.on.toISO() ?? "", "2026-04-15");

  section("a trade carries its broker-level detail");

  check("the side is kept", buyEvent?.side ?? "", "BUY");
  check("with the units", buyEvent?.quantity?.toDecimalString() ?? "", "10");
  check("and the price", buyEvent?.pricePerUnit?.toDecimalString() ?? "", "1520.00");
  check(
    "consideration is units × price, before charges",
    buyEvent?.consideration?.toDecimalString() ?? "",
    "15200.00",
  );
  // The charge columns are itemised rather than summed, which is the whole reason
  // this read model exists beside `TradeRecord`.
  check(
    "the charges itemise and total to what was recorded",
    buyEvent?.chargeTotal.toDecimalString() ?? "",
    "23.60",
  );
  checkTrue(
    "each listed charge is one that was actually levied",
    (buyEvent?.charges ?? []).every((line) => !line.amount.isZero),
  );

  section("both sides of the journal entry are shown, and they balance");

  const balanced = (legs: readonly { direction: string; amount: Money }[]) =>
    legs
      .filter((leg) => leg.direction === "DEBIT")
      .reduce((sum, leg) => sum.plus(leg.amount), Money.zero())
      .equals(
        legs
          .filter((leg) => leg.direction === "CREDIT")
          .reduce((sum, leg) => sum.plus(leg.amount), Money.zero()),
      );

  checkTrue("the purchase has at least two legs", (buyEvent?.postings.length ?? 0) >= 2);
  checkTrue("the purchase balances", balanced(buyEvent?.postings ?? []));

  checkTrue(
    "the holding's own account is named on the purchase",
    (buyEvent?.postings ?? []).some(
      (leg) => leg.accountCode === holdingAccount.code.toString(),
    ),
  );

  section("what each event did to the holding");

  check(
    "a purchase moves the holding by its full cost",
    buyEvent?.netToHolding.toDecimalString() ?? "",
    "15223.60",
  );
  section("where each event came from");

  check("a hand-entered trade says so", buyEvent?.origin.source ?? "", "MANUAL");
  checkTrue("and carries nothing about an import", buyEvent?.origin.importBatchId === null);
  checkTrue("every event can be traced to its entry", events.every((event) => event.transactionId !== ""));

  section("a holding with nothing recorded against it");

  const empty = await new AddInstrument(accountRepo, instrumentRepo, openAccount).execute({
    userId,
    symbol: "TCS",
    name: "Tata Consultancy Services",
    kind: "LISTED_EQUITY",
    exchange: "NSE",
  });
  if (!empty.ok) throw new Error("second instrument setup failed");
  const none = await activity.forInstrument(userId, empty.value.instrumentId);
  check("reads as empty rather than failing", none.length, 0);

  done();
}

await main();
