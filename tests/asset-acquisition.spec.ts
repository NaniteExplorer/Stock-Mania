/**
 * Task 1.8: the expense-to-asset-acquisition link. Acceptance: it does **not**
 * violate L12 — a side table, never a second column on the posting. Plus: the
 * link yields the asset's acquisition cost provenance from the posting, the rules
 * refuse every leg that is not an acquisition, and every write is one audited
 * `mutateAtomic` that never hard-deletes. Made-up figures throughout.
 */
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { FixedClock, UserId, newUuid } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { AssetAcquisitionFor, LinkAssetAcquisition, RestoreAssetAcquisition, UnlinkAssetAcquisition } from "@/app/asset-acquisition.usecases";
import { AccountId } from "@/domain/accounts";
import { acquisitionOf, purchaseMismatch, type AcquisitionAssetFacts, type AcquisitionPostingFacts } from "@/domain/asset-acquisition";
import * as schema from "@/infra/db/schema";
import { DrizzleAssetAcquisitionRepository, DrizzleAssetAcquisitionWriter } from "@/infra/asset-acquisition-store";
import { newRequestContext } from "@/infra/unit-of-work";
import { check, checkDeep, checkTrue, done, section, throws, throwsAsync } from "./harness";

const file = `tmp/asset-acquisition-${newUuid()}.db`;
const client = createClient({ url: `file:${file}` });
const db = drizzle(client, { schema });
const owner = UserId.from("asset-owner"), other = UserId.from("asset-other");
const clock = new FixedClock(new Date("2026-11-03T06:00:00Z"));
const INR = Currency.of("INR");
const on = CalendarDate.parse;
/** Beyond 2^53: proves the cost never passes through a JS number. */
const CAR_PRICE = 9007199254740993n;
const count = async (sql: string) => Number((await client.execute(sql)).rows[0].n);
const audits = () => count("SELECT count(*) AS n FROM audit_events WHERE entity_type = 'asset_acquisition'");

const ids = {
  bank: newUuid(), vehicleExpense: newUuid(), car: newUuid(), laptop: newUuid(), flat: newUuid(), bankAsAsset: newUuid(),
  usdBank: newUuid(), usdExpense: newUuid(), otherBank: newUuid(), otherExpense: newUuid(), otherCar: newUuid(),
};

async function account(id: string, user: UserId, code: string, type: string, subtype: string | null, currency = "INR", isSystem = 0) {
  await client.execute({ sql: "INSERT INTO ledger_accounts(id,user_id,code,name,type,subtype,currency,is_system) VALUES(?,?,?,?,?,?,?,?)", args: [id, user.value, code, code.split(":").pop()!, type, subtype, currency, isSystem] });
}

/** A two-leg purchase: DEBIT `debitAccount` (categorised), CREDIT `creditAccount`. Returns both posting ids. */
async function purchase(user: UserId, date: string, debitAccount: string, creditAccount: string, minor: bigint, options: { currency?: string; forecast?: boolean; reverses?: string; id?: string } = {}) {
  const txn = options.id ?? newUuid(), debit = newUuid(), credit = newUuid(), currency = options.currency ?? "INR";
  await client.execute({ sql: "INSERT INTO transactions(id,user_id,txn_type,txn_date,description,is_forecast,reverses_transaction_id) VALUES(?,?,?,?,?,?,?)", args: [txn, user.value, "WITHDRAWAL", date, `Purchase ${date}`, options.forecast ? 1 : 0, options.reverses ?? null] });
  await client.execute({ sql: "INSERT INTO postings(id,transaction_id,account_id,direction,amount_minor,currency,seq,category_id) VALUES(?,?,?,?,CAST(? AS INTEGER),?,0,?)", args: [debit, txn, debitAccount, options.reverses ? "CREDIT" : "DEBIT", minor.toString(), currency, "cat-major-spend"] });
  await client.execute({ sql: "INSERT INTO postings(id,transaction_id,account_id,direction,amount_minor,currency,seq) VALUES(?,?,?,?,CAST(? AS INTEGER),?,1)", args: [credit, txn, creditAccount, options.reverses ? "DEBIT" : "CREDIT", minor.toString(), currency] });
  return { txn, debit, credit };
}

const assetFacts = (overrides: Partial<AcquisitionAssetFacts> = {}): AcquisitionAssetFacts => ({
  accountId: AccountId.from(ids.car), name: "Car", type: "ASSET", subtype: "VEHICLE", currencyCode: "INR", isSystem: false, ...overrides,
});
const postingFacts = (overrides: Partial<AcquisitionPostingFacts> = {}): AcquisitionPostingFacts => ({
  postingId: "p", transactionId: "t", accountId: AccountId.from(ids.vehicleExpense), accountType: "EXPENSE", direction: "DEBIT",
  amount: Money.fromMinor(85_000_000n, INR), instrumentId: null, on: on("2026-03-14"), description: "Car", isForecast: false,
  isReversal: false, isReversed: false, ...overrides,
});

async function main() {
  await client.execute("PRAGMA foreign_keys=ON");
  const dir = "src/infra/db/migrations";
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${dir}/${name}`, "utf8").split("--> statement-breakpoint")) if (statement.trim()) await client.execute(statement);
  }
  for (const user of [owner, other]) await client.execute({ sql: "INSERT INTO user(id,name,email) VALUES(?,?,?)", args: [user.value, user.value, `${user.value}@example.test`] });
  await account(ids.bank, owner, "Assets:Bank:Savings", "ASSET", "SAVINGS");
  await account(ids.vehicleExpense, owner, "Expenses:Major:Vehicle", "EXPENSE", null);
  await account(ids.car, owner, "Assets:Vehicles:Car", "ASSET", "VEHICLE");
  await account(ids.laptop, owner, "Assets:Gadgets:Laptop", "ASSET", "OTHER");
  await account(ids.flat, owner, "Assets:Property:Flat", "ASSET", "REAL_ESTATE");
  await account(ids.bankAsAsset, owner, "Assets:Bank:Current", "ASSET", "BANK");
  await account(ids.usdBank, owner, "Assets:Bank:USD", "ASSET", "BANK", "USD");
  await account(ids.usdExpense, owner, "Expenses:Major:USD", "EXPENSE", null, "USD");
  await account(ids.otherBank, other, "Assets:Bank:Savings", "ASSET", "SAVINGS");
  await account(ids.otherExpense, other, "Expenses:Major:Vehicle", "EXPENSE", null);
  await account(ids.otherCar, other, "Assets:Vehicles:Car", "ASSET", "VEHICLE");

  const repo = new DrizzleAssetAcquisitionRepository(db);
  const writer = new DrizzleAssetAcquisitionWriter(db, newRequestContext(owner.value, clock, { requestId: "link-request" }));
  const link = new LinkAssetAcquisition(writer), unlink = new UnlinkAssetAcquisition(writer), restore = new RestoreAssetAcquisition(writer);
  const read = new AssetAcquisitionFor(repo);
  const car = AccountId.from(ids.car), laptop = AccountId.from(ids.laptop), flat = AccountId.from(ids.flat);

  section("L12: the link is a side table, never a column on the posting");
  const postingColumns = (await client.execute("PRAGMA table_info(postings)")).rows.map((r) => String(r.name)).sort();
  checkDeep("postings has exactly the pre-1.8 columns", postingColumns,
    ["account_id", "amount_minor", "category_id", "currency", "deleted_at", "direction", "id", "instrument_id", "memo", "quantity_scaled", "seq", "status", "transaction_id", "unit_cost_minor"]);
  const linkColumns = (await client.execute("PRAGMA table_info(asset_acquisitions)")).rows.map((r) => String(r.name)).sort();
  checkDeep("asset_acquisitions stores ids only, no copied date or cost", linkColumns,
    ["asset_account_id", "created_at", "deleted_at", "id", "posting_id", "updated_at", "user_id"]);
  const l12 = (await client.execute("SELECT sql FROM sqlite_master WHERE name = 'postings'")).rows[0].sql as string;
  checkTrue("the L12 CHECK is still on postings", l12.includes("postings_no_category_on_commodity"));

  section("link: a categorised expense becomes the car's acquisition provenance");
  const carBuy = await purchase(owner, "2026-03-14", ids.vehicleExpense, ids.bank, CAR_PRICE);
  const linked = await link.execute({ userId: owner, assetAccountId: ids.car, postingId: carBuy.debit });
  checkTrue("linked", linked.ok);
  const provenance = await repo.forAsset(owner, car);
  check("acquired on the transaction date", provenance?.on.toISO(), "2026-03-14");
  check("cost is the posting amount, exact past 2^53", provenance?.cost.minor, CAR_PRICE);
  check("in the asset's currency", provenance?.cost.currency.code, "INR");
  check("names its transaction", provenance?.transactionId, carBuy.txn);
  check("and the description", provenance?.description, "Purchase 2026-03-14");
  const posting = (await client.execute({ sql: "SELECT category_id, instrument_id FROM postings WHERE id = ?", args: [carBuy.debit] })).rows[0];
  checkDeep("the posting keeps its category and gains no instrument", [posting.category_id, posting.instrument_id], ["cat-major-spend", null]);
  check("one audit event", await audits(), 1);
  check("and one ledger event", await count("SELECT count(*) AS n FROM ledger_events WHERE event_type = 'asset_acquisition.linked'"), 1);
  const viaUseCase = await read.execute({ userId: owner, assetAccountId: ids.car });
  check("the read use case returns the same provenance", viaUseCase.ok ? viaUseCase.value?.postingId : "err", carBuy.debit);
  check("another owner sees nothing", await repo.forAsset(other, car), null);
  check("an unlinked asset reads null, never a zero cost", await repo.forAsset(owner, flat), null);

  section("idempotent and replaceable");
  await link.execute({ userId: owner, assetAccountId: ids.car, postingId: carBuy.debit });
  check("linking the same pair again writes nothing", await audits(), 1);
  const carBuy2 = await purchase(owner, "2026-03-20", ids.vehicleExpense, ids.bank, 86_000_000n);
  const relinked = await link.execute({ userId: owner, assetAccountId: ids.car, postingId: carBuy2.debit });
  checkTrue("relinked to the corrected purchase", relinked.ok);
  check("…which is now the provenance", (await repo.forAsset(owner, car))?.on.toISO(), "2026-03-20");
  check("the old row is tombstoned, not erased", await count(`SELECT count(*) AS n FROM asset_acquisitions WHERE asset_account_id = '${ids.car}' AND deleted_at IS NOT NULL`), 1);
  check("one live row for the asset", await count(`SELECT count(*) AS n FROM asset_acquisitions WHERE asset_account_id = '${ids.car}' AND deleted_at IS NULL`), 1);
  check("the relink is audited as an update", (await client.execute("SELECT action FROM audit_events WHERE entity_type = 'asset_acquisition' ORDER BY rowid DESC LIMIT 1")).rows[0].action, "UPDATE");

  section("refusals, each with its reason");
  const refusal = async (label: string, assetAccountId: string, postingId: string, code: string, fragment = "") => {
    const before = await audits();
    const result = await link.execute({ userId: owner, assetAccountId, postingId });
    const ok = !result.ok && result.error.code === code && result.error.message.includes(fragment);
    checkTrue(label, ok);
    check(`${label}: nothing written`, await audits(), before);
  };
  const laptopBuy = await purchase(owner, "2026-05-02", ids.vehicleExpense, ids.bank, 12_000_000n);
  await refusal("the bank (credit) side is not the acquisition", ids.laptop, laptopBuy.credit, "ASSET_ACQUISITION_REFUSED", "debit");
  const transfer = await purchase(owner, "2026-05-03", ids.bankAsAsset, ids.bank, 1_000_000n);
  await refusal("a debit on some other asset account is not an expense", ids.laptop, transfer.debit, "ASSET_ACQUISITION_REFUSED", "expense");
  await refusal("a bank account is not a physical asset", ids.bankAsAsset, laptopBuy.debit, "ASSET_ACQUISITION_REFUSED", "physical");
  const usd = await purchase(owner, "2026-05-04", ids.usdExpense, ids.usdBank, 50_000n, { currency: "USD" });
  await refusal("a posting in another currency", ids.laptop, usd.debit, "ASSET_ACQUISITION_REFUSED", "USD");
  const forecast = await purchase(owner, "2026-12-01", ids.vehicleExpense, ids.bank, 3_000_000n, { forecast: true });
  await refusal("a forecast has not happened", ids.laptop, forecast.debit, "ASSET_ACQUISITION_REFUSED", "forecast");
  const reversedBuy = await purchase(owner, "2026-05-05", ids.vehicleExpense, ids.bank, 4_000_000n);
  const reversal = await purchase(owner, "2026-05-06", ids.vehicleExpense, ids.bank, 4_000_000n, { reverses: reversedBuy.txn });
  await refusal("a reversed transaction", ids.laptop, reversedBuy.debit, "ASSET_ACQUISITION_REFUSED", "reversed");
  await refusal("a reversal itself (its credit leg is refused first as the paying side)", ids.laptop, reversal.debit, "ASSET_ACQUISITION_REFUSED");
  await refusal("a posting already acquiring another asset", ids.laptop, carBuy2.debit, "ASSET_ACQUISITION_REFUSED", "another asset");
  const theirs = await purchase(other, "2026-05-07", ids.otherExpense, ids.otherBank, 5_000_000n);
  await refusal("another owner's posting is not found", ids.laptop, theirs.debit, "NOT_FOUND");
  await refusal("another owner's asset is not found", ids.otherCar, laptopBuy.debit, "NOT_FOUND");
  const gone = await purchase(owner, "2026-05-08", ids.vehicleExpense, ids.bank, 6_000_000n);
  await client.execute({ sql: "UPDATE postings SET deleted_at = 1 WHERE id = ?", args: [gone.debit] });
  await refusal("a tombstoned posting is not found", ids.laptop, gone.debit, "NOT_FOUND");
  const malformed = await link.execute({ userId: owner, assetAccountId: "not-a-uuid", postingId: laptopBuy.debit });
  check("a malformed asset id is a validation error", malformed.ok ? "ok" : malformed.error.code, "VALIDATION_FAILED");
  await throwsAsync("a writer cannot act for another owner", () => writer.link(other, AccountId.from(ids.otherCar), theirs.debit), "owner");

  section("the database backs the uniqueness rules");
  let duplicate = false;
  try {
    await client.execute({ sql: "INSERT INTO asset_acquisitions(id,user_id,asset_account_id,posting_id) VALUES(?,?,?,?)", args: [newUuid(), owner.value, ids.flat, carBuy2.debit] });
  } catch { duplicate = true; }
  check("a second live link for one posting is refused by the index", duplicate, true);

  section("a link that stops qualifying is hidden, not shown stale");
  const laptopLinked = await link.execute({ userId: owner, assetAccountId: ids.laptop, postingId: laptopBuy.debit });
  checkTrue("laptop linked", laptopLinked.ok);
  check("two live acquisitions listed", (await repo.list(owner)).length, 2);
  await purchase(owner, "2026-05-09", ids.vehicleExpense, ids.bank, 12_000_000n, { reverses: laptopBuy.txn });
  check("once its transaction is reversed the laptop reads null", await repo.forAsset(owner, laptop), null);
  check("and drops out of the list", (await repo.list(owner)).map((a) => a.assetAccountId.value).join(","), ids.car);

  section("unlink tombstones; restore re-judges");
  const unlinked = await unlink.execute({ userId: owner, assetAccountId: ids.car });
  checkTrue("unlinked", unlinked.ok);
  check("the car reads null", await repo.forAsset(owner, car), null);
  const tombstoned = (await client.execute(`SELECT id FROM asset_acquisitions WHERE asset_account_id = '${ids.car}' AND posting_id = '${carBuy2.debit}'`)).rows[0].id as string;
  check("the row is kept, tombstoned", await count(`SELECT count(*) AS n FROM asset_acquisitions WHERE id = '${tombstoned}' AND deleted_at IS NOT NULL`), 1);
  const nothing = await unlink.execute({ userId: owner, assetAccountId: ids.car });
  check("unlinking again is not found", nothing.ok ? "ok" : nothing.error.code, "NOT_FOUND");
  const restored = await restore.execute({ userId: owner, linkId: tombstoned });
  checkTrue("restored", restored.ok);
  check("the provenance is back", (await repo.forAsset(owner, car))?.on.toISO(), "2026-03-20");
  checkDeep("audited as create, update, soft delete, restore", (await client.execute({ sql: "SELECT action FROM audit_events WHERE entity_type = 'asset_acquisition' AND entity_id IN (SELECT id FROM asset_acquisitions WHERE asset_account_id = ?) ORDER BY rowid", args: [ids.car] })).rows.map((r) => r.action), ["CREATE", "UPDATE", "SOFT_DELETE", "RESTORE"]);
  const firstCarRow = (await client.execute(`SELECT id FROM asset_acquisitions WHERE asset_account_id = '${ids.car}' AND posting_id = '${carBuy.debit}'`)).rows[0].id as string;
  const clash = await restore.execute({ userId: owner, linkId: firstCarRow });
  check("restoring an older link while another is live is refused", clash.ok ? "ok" : clash.error.code, "ASSET_ACQUISITION_REFUSED");
  check("hard deletes: none (every link row ever written is still there)", await count("SELECT count(*) AS n FROM asset_acquisitions"), 3);

  section("domain rules, pure");
  throws("a commodity leg is a trade", () => acquisitionOf(assetFacts(), postingFacts({ instrumentId: "inst" })), "trade");
  throws("a system account cannot be linked", () => acquisitionOf(assetFacts({ isSystem: true }), postingFacts()), "maintained by the app");
  throws("a liability is not an asset", () => acquisitionOf(assetFacts({ type: "LIABILITY" }), postingFacts()), "not an asset");
  throws("a reversal is refused", () => acquisitionOf(assetFacts(), postingFacts({ isReversal: true })), "reversal");
  check("a capitalised purchase (debit on the asset itself) is accepted", acquisitionOf(assetFacts(), postingFacts({ accountId: AccountId.from(ids.car), accountType: "ASSET" })).cost.minor, 85_000_000n);
  const acquisition = acquisitionOf(assetFacts(), postingFacts());
  check("matching purchase terms agree", purchaseMismatch(acquisition, { on: on("2026-03-14"), price: Money.fromMinor(85_000_000n, INR) }), null);
  checkTrue("a different date is a mismatch", (purchaseMismatch(acquisition, { on: on("2026-03-15"), price: Money.fromMinor(85_000_000n, INR) }) ?? "").includes("2026-03-14"));
  checkTrue("a different price is a mismatch", (purchaseMismatch(acquisition, { on: on("2026-03-14"), price: Money.fromMinor(85_000_001n, INR) }) ?? "").includes("price"));
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    client.close();
    for (const suffix of ["", "-shm", "-wal"]) {
      try { rmSync(file + suffix, { force: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error; }
    }
    if (process.exitCode !== 1) done();
  });
