/**
 * Physical asset writes (TASKS 1.4): create via OpenAccount + audited insert,
 * assert a valuation, replace the model, tombstone. Integer minor-unit columns and
 * the currency column round-trip exactly. Made-up figures.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { FixedClock, UserId, newUuid } from "@/core/kernel";
import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { OpenAccount, SeedChartOfAccounts } from "@/app/ledger.usecases";
import { AssertPhysicalValuation, CreatePhysicalAsset, ListPhysicalAssets, RemovePhysicalAsset, ReplacePhysicalModel } from "@/app/physical-asset.usecases";
import * as schema from "@/infra/db/schema";
import { DrizzlePhysicalAssetRepository, DrizzlePhysicalAssetWriter } from "@/infra/physical-asset-store";
import { DrizzleAccountRepository, DrizzleTransactionRepository } from "@/infra/repositories";
import { newRequestContext } from "@/infra/unit-of-work";
import { AcquisitionCandidates, AssetAcquisitionFor, LinkAssetAcquisition } from "@/app/asset-acquisition.usecases";
import { StraightLine } from "@/domain/depreciation";
import { DrizzleAssetAcquisitionRepository, DrizzleAssetAcquisitionWriter } from "@/infra/asset-acquisition-store";
import { check, checkDeep, checkTrue, done, section } from "./harness";

const file = `tmp/physical-writer-${newUuid()}.db`;
const client = createClient({ url: `file:${file}` });
const db = drizzle(client, { schema });
const owner = UserId.from("pa-owner"), other = UserId.from("pa-other");
const clock = new FixedClock(new Date("2026-11-05T06:00:00Z"));
const one = async (sql: string) => (await client.execute(sql)).rows[0];
const d = (iso: string) => CalendarDate.parse(iso);

async function main() {
  await client.execute("PRAGMA foreign_keys=ON");
  const dir = "src/infra/db/migrations";
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of readFileSync(`${dir}/${name}`, "utf8").split("--> statement-breakpoint")) if (statement.trim()) await client.execute(statement);
  }
  for (const user of [owner, other]) await client.execute({ sql: "INSERT INTO user(id,name,email) VALUES(?,?,?)", args: [user.value, user.value, `${user.value}@example.test`] });

  const accounts = new DrizzleAccountRepository(db);
  await new SeedChartOfAccounts(accounts).execute({ userId: owner });
  const openAccount = new OpenAccount(accounts, new DrizzleTransactionRepository(db), clock);
  const writer = new DrizzlePhysicalAssetWriter(db, newRequestContext(owner.value, clock, { requestId: "pa-request" }));
  const create = new CreatePhysicalAsset(openAccount, writer);
  const list = new ListPhysicalAssets(new DrizzlePhysicalAssetRepository(db));

  section("create");
  const created = await create.execute({
    userId: owner, name: "Test hatchback", kind: "VEHICLE",
    purchase: { on: d("2024-04-01"), price: Money.fromRupees("612345.67") },
    model: { kind: "DECLINING", rate: Percentage.of("15"), basis: "Owner's assumption" },
    firstValuation: { on: d("2024-04-01"), value: Money.fromRupees("612345.67"), source: "PURCHASE_PRICE" },
  });
  checkTrue("created", created.ok);
  if (!created.ok) return;
  const id = created.value;
  const header = await one(`SELECT typeof(purchase_price_minor) t, purchase_price_minor p, typeof(rate_percent_scaled) r, currency FROM physical_assets WHERE account_id='${id.value}'`);
  check("price stored as integer", header.t, "integer");
  check("price exact minor units", String(header.p), "61234567");
  check("rate stored as integer", header.r, "integer");
  check("currency stored", header.currency, "INR");
  check("valuation currency stored", (await one("SELECT currency FROM physical_asset_valuations")).currency, "INR");
  check("no ledger posting from creation", Number((await one("SELECT count(*) n FROM postings")).n), 0);
  check("creation audited", Number((await one("SELECT count(*) n FROM audit_events WHERE entity_type='physical_asset'")).n) >= 1, true);

  section("read back");
  let records = await list.execute({ userId: owner });
  checkTrue("one record", records.ok && records.value.length === 1);
  if (!records.ok) return;
  check("model rate round-trips", records.value[0].model?.terms.includes("15") ?? false, true);
  check("other owner sees nothing", ((await list.execute({ userId: other })) as { value: readonly unknown[] }).value.length, 0);

  section("assert valuation");
  const assert = new AssertPhysicalValuation(writer);
  checkTrue("valuation recorded", (await assert.execute({ userId: owner, accountId: id, on: d("2026-10-01"), value: Money.fromRupees("480000"), source: "MARKET_COMPARABLE" })).ok);
  checkTrue("same date refused", !(await assert.execute({ userId: owner, accountId: id, on: d("2026-10-01"), value: Money.fromRupees("1"), source: "SELF_ASSESSED" })).ok);
  checkTrue("before purchase refused", !(await assert.execute({ userId: owner, accountId: id, on: d("2024-01-01"), value: Money.fromRupees("1"), source: "SELF_ASSESSED" })).ok);
  records = await list.execute({ userId: owner });
  if (records.ok) check("latest value", records.value[0].asset.valueOn(d("2026-11-05"))?.minor, 48000000n);

  section("replace model");
  checkTrue("model replaced with schedule", (await new ReplacePhysicalModel(writer).execute({ userId: owner, accountId: id, model: { kind: "SCHEDULE", scheduleId: "MOTOR_IDV" } })).ok);
  check("rate cleared", (await one(`SELECT rate_percent_scaled r FROM physical_assets WHERE account_id='${id.value}'`)).r, null);

  section("replace model: straight line round-trips its floor");
  checkTrue("straight line saved", (await new ReplacePhysicalModel(writer).execute({ userId: owner, accountId: id,
    model: { kind: "STRAIGHT", rate: Percentage.of("12.5"), floor: Percentage.of("7"), basis: "Made-up test basis" } })).ok);
  records = await list.execute({ userId: owner });
  const straight = records.ok ? records.value[0].model : null;
  checkTrue("model is straight line", straight instanceof StraightLine);
  if (straight instanceof StraightLine) {
    check("rate read back", straight.rate.toFixed(4), "12.5000");
    check("floor read back", straight.floor.toFixed(4), "7.0000");
  }
  checkTrue("model cleared", (await new ReplacePhysicalModel(writer).execute({ userId: owner, accountId: id, model: null })).ok);
  records = await list.execute({ userId: owner });
  check("no model after clearing", records.ok ? records.value[0].model : "err", null);

  section("1.8 acquisition: candidates, link and provenance");
  const bank = newUuid(), expense = newUuid(), otherExpense = newUuid();
  const acct = (aid: string, user: UserId, code: string, type: string) => client.execute({ sql: "INSERT INTO ledger_accounts(id,user_id,code,name,type,subtype,currency,is_system) VALUES(?,?,?,?,?,?,?,0)", args: [aid, user.value, code, code.split(":").pop()!, type, type === "ASSET" ? "SAVINGS" : null, "INR"] });
  await acct(bank, owner, "Assets:Bank:Test Savings", "ASSET");
  await acct(expense, owner, "Expenses:Test Vehicle", "EXPENSE");
  await acct(otherExpense, other, "Expenses:Test Vehicle", "EXPENSE");
  const buy = async (user: UserId, date: string, debitAccount: string, creditAccount: string, minor: string, forecast = 0) => {
    const txn = newUuid(), debit = newUuid();
    await client.execute({ sql: "INSERT INTO transactions(id,user_id,txn_type,txn_date,description,is_forecast) VALUES(?,?,?,?,?,?)", args: [txn, user.value, "WITHDRAWAL", date, `Test purchase ${date}`, forecast] });
    await client.execute({ sql: "INSERT INTO postings(id,transaction_id,account_id,direction,amount_minor,currency,seq) VALUES(?,?,?,'DEBIT',CAST(? AS INTEGER),'INR',0)", args: [debit, txn, debitAccount, minor] });
    await client.execute({ sql: "INSERT INTO postings(id,transaction_id,account_id,direction,amount_minor,currency,seq) VALUES(?,?,?,'CREDIT',CAST(? AS INTEGER),'INR',1)", args: [newUuid(), txn, creditAccount, minor] });
    return debit;
  };
  const carDebit = await buy(owner, "2024-04-01", expense, bank, "61234567");
  await buy(owner, "2027-01-01", expense, bank, "11111", 1);
  await buy(other, "2024-05-01", otherExpense, otherExpense, "22222");
  const acqRepo = new DrizzleAssetAcquisitionRepository(db);
  const shortlist = await new AcquisitionCandidates(acqRepo).execute({ userId: owner });
  checkDeep("only the owner's live expense debit is offered", shortlist.ok ? shortlist.value.map((c) => c.postingId) : [], [carDebit]);
  check("candidate amount is exact", shortlist.ok ? shortlist.value[0]?.amount.minor : null, 61234567n);
  const acqWriter = new DrizzleAssetAcquisitionWriter(db, newRequestContext(owner.value, clock));
  checkTrue("asset linked to the expense", (await new LinkAssetAcquisition(acqWriter).execute({ userId: owner, assetAccountId: id.value, postingId: carDebit })).ok);
  const provenance = await new AssetAcquisitionFor(acqRepo).execute({ userId: owner, assetAccountId: id.value });
  check("provenance date", provenance.ok ? provenance.value?.on.toISO() : null, "2024-04-01");
  check("provenance cost", provenance.ok ? provenance.value?.cost.minor : null, 61234567n);

  section("atomic create: a refused insert leaves no orphan account");
  const accountsBefore = Number((await one("SELECT count(*) n FROM ledger_accounts")).n);
  await client.execute("CREATE TRIGGER test_refuse_other BEFORE INSERT ON physical_assets WHEN NEW.kind = 'OTHER' BEGIN SELECT RAISE(ABORT, 'test refusal'); END");
  const refused = await create.execute({ userId: owner, name: "Refused gadget", kind: "OTHER", model: null });
  await client.execute("DROP TRIGGER test_refuse_other");
  checkTrue("create refused", !refused.ok);
  check("no ledger account left behind", Number((await one("SELECT count(*) n FROM ledger_accounts")).n), accountsBefore);
  check("no account by that name", Number((await one("SELECT count(*) n FROM ledger_accounts WHERE name='Refused gadget'")).n), 0);
  const gadget = await create.execute({ userId: owner, name: "Test gadget", kind: "OTHER", model: null });
  checkTrue("same create succeeds without the refusal", gadget.ok);
  check("its account opened with it", Number((await one("SELECT count(*) n FROM ledger_accounts WHERE name='Test gadget' AND type='ASSET' AND subtype='OTHER'")).n), 1);

  section("UI wiring: model form and acquisition link on /assets");
  const page = readFileSync("app/(root)/assets/page.tsx", "utf8"), actions = readFileSync("app/(root)/assets/actions.ts", "utf8");
  checkTrue("page renders the model form", page.includes("<ModelForm"));
  checkTrue("page renders the link form and the provenance", page.includes("<LinkAcquisitionForm") && page.includes("acquisition.cost"));
  checkTrue("model action calls replaceModel", actions.includes("writes.replaceModel.execute"));
  checkTrue("link action calls the acquisition link use case", actions.includes("links.link.execute"));

  section("remove (tombstone)");
  const foreignWriter = new DrizzlePhysicalAssetWriter(db, newRequestContext(other.value, clock));
  checkTrue("other owner cannot remove", !(await new RemovePhysicalAsset(foreignWriter).execute({ userId: other, accountId: id })).ok);
  checkTrue("owner removes", (await new RemovePhysicalAsset(writer).execute({ userId: owner, accountId: id })).ok);
  check("row kept as tombstone", Number((await one("SELECT count(*) n FROM physical_assets WHERE deleted_at IS NOT NULL")).n), 1);
  check("valuations tombstoned", Number((await one(`SELECT count(*) n FROM physical_asset_valuations WHERE deleted_at IS NULL AND asset_account_id='${id.value}'`)).n), 0);
  const closed = await one(`SELECT is_closed c, deleted_at d FROM ledger_accounts WHERE id='${id.value}'`);
  check("ledger account closed in the same unit", Number(closed.c), 1);
  check("ledger account kept, not deleted", closed.d, null);
  check("other assets' accounts stay open", Number((await one("SELECT is_closed c FROM ledger_accounts WHERE name='Test gadget'")).c), 0);
  records = await list.execute({ userId: owner });
  check("only the gadget remains", records.ok ? records.value.map((r) => r.asset.displayName).join() : "err", "Test gadget");
}

main().then(done, (error) => { console.error(error); process.exit(1); });
