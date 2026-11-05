/**
 * Card minimum due (card-minimum-due.md): the owner's typed figure per statement
 * overrides the card's user-entered percentage-and-floor rule for that statement only;
 * refusals; class-B store with audit and tombstone; migration 0025 rollback; and the
 * add-card form carries no 5% / ₹500 pre-fill. Made-up figures throughout.
 */
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Ok, FixedClock, UserId, newUuid } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { BillingCycle, CardStatement } from "@/domain/assets";
import { withEnteredMinimumDue } from "@/domain/card-minimum-due";
import { MUTATION_CLASSES, allows } from "@/domain/mutation-classes";
import { LoadCardMinimumDues, RecordCardMinimumDue, RemoveCardMinimumDue, resolveMinimumDue, type CardStatementsReader } from "@/app/card-minimum-due.usecases";
import * as schema from "@/infra/db/schema";
import { CardMinimumDueRefusedError, DrizzleCardMinimumDueReader, DrizzleCardMinimumDueWriter } from "@/infra/card-minimum-due-store";
import { newRequestContext } from "@/infra/unit-of-work";
import { check, checkTrue, done, section } from "./harness";

const d = CalendarDate.parse;
const inr = (rupees: string) => Money.fromRupees(rupees);
// Made-up statement: opened at 0, one spend of ₹12,345.00; rule-computed minimum ₹617.25.
const cycle = new BillingCycle(d("2026-09-19"), d("2026-10-18"), d("2026-11-07"));
const statement = new CardStatement(cycle, inr("0"), [{ on: d("2026-10-02"), amount: inr("12345.00"), kind: "SPEND" }], inr("617.25"));
const open = new CardStatement(new BillingCycle(d("2026-10-19"), d("2026-11-18"), d("2026-12-08")), inr("0"), [], inr("0"));

async function main() {
  section("domain resolution");
  const rule = withEnteredMinimumDue(statement, null);
  checkTrue("no typed figure: the rule's minimum, marked as rule", !rule.entered && rule.statement.minimumDue.equals(inr("617.25")));
  const typed = withEnteredMinimumDue(statement, inr("800.00"));
  checkTrue("typed figure overrides for this statement", typed.entered && typed.statement.minimumDue.equals(inr("800.00")));
  check("the statement itself is otherwise unchanged", typed.statement.totalDue.toString(), statement.totalDue.toString());
  const tooHigh = resolveMinimumDue(statement, "card-1", [{ accountId: "card-1", statementThrough: d("2026-10-18"), amount: inr("20000.00") }]);
  checkTrue("a typed figure above the total is refused, rule shown, refusal reported", !tooHigh.entered && tooHigh.refused !== null && tooHigh.statement.minimumDue.equals(inr("617.25")));
  const otherCard = resolveMinimumDue(statement, "card-2", [{ accountId: "card-1", statementThrough: d("2026-10-18"), amount: inr("800.00") }]);
  checkTrue("another card's typed figure does not apply", !otherCard.entered);
  const otherStatement = resolveMinimumDue(statement, "card-1", [{ accountId: "card-1", statementThrough: d("2026-09-18"), amount: inr("800.00") }]);
  checkTrue("another statement's typed figure does not apply", !otherStatement.entered);
  let currencyRefused = false;
  try { withEnteredMinimumDue(statement, Money.fromRupees("10.00", Currency.of("USD"))); } catch { currencyRefused = true; }
  checkTrue("a figure in another currency is refused", currencyRefused);

  section("mutation class");
  check("card_minimum_dues is class B", MUTATION_CLASSES.card_minimum_dues.class, "B");
  checkTrue("updated and tombstoned, never posted", allows("card_minimum_dues", "update") && allows("card_minimum_dues", "tombstone") && !allows("card_minimum_dues", "post"));

  section("store + use cases against the real migrations");
  const file = `tmp/card-minimum-due-${newUuid()}.db`;
  const client = createClient({ url: `file:${file}` });
  const db = drizzle(client, { schema });
  await client.execute("PRAGMA foreign_keys=ON");
  const dir = "src/infra/db/migrations";
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of readFileSync(`${dir}/${name}`, "utf8").split("--> statement-breakpoint")) if (sql.trim()) await client.execute(sql);
  }
  const owner = UserId.from("cmd-owner");
  await client.execute({ sql: "INSERT INTO user(id,name,email) VALUES(?,?,?)", args: [owner.value, owner.value, "cmd-owner@example.test"] });
  const accountCols = (await client.execute("PRAGMA table_info(ledger_accounts)")).rows;
  const required = accountCols.filter((c) => Number(c.notnull) === 1 && c.dflt_value === null).map((c) => String(c.name));
  const card = AccountId.from(newUuid());
  const values: Record<string, unknown> = { id: card.value, user_id: owner.value, type: "LIABILITY", subtype: "CREDIT_CARD", currency: "INR" };
  for (const col of required) if (!(col in values)) values[col] = col === "type" ? "LIABILITY" : col.endsWith("_at") ? 0 : `made-up-${col}`;
  const cols = Object.keys(values);
  const inserted = await client.execute({ sql: `INSERT INTO ledger_accounts(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`, args: cols.map((c) => values[c] as string) }).then(() => true, () => false);
  checkTrue("a made-up card account is inserted for the foreign key", inserted);

  const clock = new FixedClock(new Date("2026-11-05T06:00:00Z"));
  const statements: CardStatementsReader = { execute: async () => Ok({ statements: [statement, open] }) };
  const writer = new DrizzleCardMinimumDueWriter(db, newRequestContext(owner.value, clock, { requestId: "cmd-request" }));
  const record = new RecordCardMinimumDue(statements, writer), remove = new RemoveCardMinimumDue(writer);
  const load = new LoadCardMinimumDues(new DrizzleCardMinimumDueReader(db));
  const asOf = d("2026-11-05");
  const base = { userId: owner, accountId: card, asOf };

  const over = await record.execute({ ...base, statementThrough: "2026-10-18", amount: "12345.01" });
  checkTrue("above the statement total is refused", !over.ok && over.error.code === "VALIDATION_FAILED");
  const notClosed = await record.execute({ ...base, statementThrough: "2026-11-18", amount: "10.00" });
  checkTrue("an open statement is refused", !notClosed.ok && notClosed.error.message.includes("not closed"));
  const missing = await record.execute({ ...base, statementThrough: "2026-08-18", amount: "10.00" });
  checkTrue("an unknown statement is refused", !missing.ok && missing.error.message.includes("no statement"));
  const bad = await record.execute({ ...base, statementThrough: "2026-10-18", amount: "-5" });
  checkTrue("a negative or malformed amount is refused", !bad.ok);
  check("refusals wrote nothing", Number((await client.execute("SELECT count(*) AS n FROM card_minimum_dues")).rows[0].n), 0);

  const saved = await record.execute({ ...base, statementThrough: "2026-10-18", amount: "800.00" });
  checkTrue("a valid typed figure is stored", saved.ok);
  const corrected = await record.execute({ ...base, statementThrough: "2026-10-18", amount: "750.50" });
  checkTrue("re-recording corrects in place", corrected.ok);
  const loaded = await load.execute({ userId: owner, accountIds: [card.value] });
  checkTrue("one live row with the corrected amount", loaded.ok && loaded.value.length === 1 && loaded.value[0]!.amount.equals(inr("750.50")));
  check("each write is audited", Number((await client.execute("SELECT count(*) AS n FROM audit_events WHERE entity_type='card_minimum_dues'")).rows[0].n), 2);

  const removed = await remove.execute({ userId: owner, accountId: card, statementThrough: "2026-10-18" });
  checkTrue("clearing tombstones it", removed.ok);
  const afterRemove = await load.execute({ userId: owner, accountIds: [card.value] });
  checkTrue("the rule applies again", afterRemove.ok && afterRemove.value.length === 0);
  check("the row is kept as a tombstone", Number((await client.execute("SELECT count(*) AS n FROM card_minimum_dues WHERE deleted_at IS NOT NULL")).rows[0].n), 1);
  const again = await remove.execute({ userId: owner, accountId: card, statementThrough: "2026-10-18" });
  checkTrue("clearing twice is refused", !again.ok);

  section("QA regressions (Codex 2026-11-05): exact money, parent ownership");
  const huge = Money.fromMinor(9007199254740993n);
  await writer.record(owner, { accountId: card.value, statementThrough: d("2026-07-18"), amount: huge });
  const exact = await load.execute({ userId: owner, accountIds: [card.value] });
  checkTrue("minor units above 2^53 round-trip exactly", exact.ok && exact.value.some((e) => e.amount.minor === 9007199254740993n));
  check("stored as the exact integer", String((await client.execute("SELECT CAST(amount_minor AS TEXT) AS v FROM card_minimum_dues WHERE statement_through='2026-07-18'")).rows[0].v), "9007199254740993");
  const intruder = UserId.from("cmd-intruder");
  await client.execute({ sql: "INSERT INTO user(id,name,email) VALUES(?,?,?)", args: [intruder.value, intruder.value, "cmd-intruder@example.test"] });
  const intruderWriter = new DrizzleCardMinimumDueWriter(db, newRequestContext(intruder.value, clock, { requestId: "cmd-intruder" }));
  let refusedForeign = false;
  try { await intruderWriter.record(intruder, { accountId: card.value, statementThrough: d("2026-06-18"), amount: inr("1.00") }); } catch { refusedForeign = true; }
  checkTrue("a first write against another owner's card is refused", refusedForeign);
  check("and nothing was written", Number((await client.execute("SELECT count(*) AS n FROM card_minimum_dues WHERE user_id='cmd-intruder'")).rows[0].n), 0);

  section("QA regressions (2026-11-05): store refuses non-cards and currency mismatch, checks inside the transaction");
  const insertAccount = async (id: string, overrides: Record<string, string>) => {
    const v: Record<string, unknown> = { ...values, id, code: `made-up-code-${id}`, ...overrides };
    const c = Object.keys(v);
    await client.execute({ sql: `INSERT INTO ledger_accounts(${c.join(",")}) VALUES(${c.map(() => "?").join(",")})`, args: c.map((k) => v[k] as string) });
  };
  const savings = newUuid(), loan = newUuid();
  await insertAccount(savings, { type: "ASSET", subtype: "SAVINGS" });
  await insertAccount(loan, { type: "LIABILITY", subtype: "LOAN" });
  const refusal = async (fn: () => Promise<void>) => { try { await fn(); return "none"; } catch (e) { return e instanceof CardMinimumDueRefusedError ? e.code : "untyped"; } };
  check("a savings account is refused with a typed error", await refusal(() => writer.record(owner, { accountId: savings, statementThrough: d("2026-05-18"), amount: inr("42.00") })), "NOT_A_CARD");
  check("a non-card liability is refused", await refusal(() => writer.record(owner, { accountId: loan, statementThrough: d("2026-05-18"), amount: inr("42.00") })), "NOT_A_CARD");
  check("a currency other than the card's is refused", await refusal(() => writer.record(owner, { accountId: card.value, statementThrough: d("2026-05-18"), amount: Money.fromMinor(4200n, Currency.of("USD")) })), "CURRENCY_MISMATCH");
  check("the foreign-card refusal is typed too", await refusal(() => intruderWriter.record(intruder, { accountId: card.value, statementThrough: d("2026-05-18"), amount: inr("1.00") })), "NOT_OWNER");
  check("none of these wrote a row", Number((await client.execute("SELECT count(*) AS n FROM card_minimum_dues WHERE statement_through='2026-05-18'")).rows[0].n), 0);
  check("nor an audit event", Number((await client.execute("SELECT count(*) AS n FROM audit_events WHERE entity_type='card_minimum_dues' AND entity_id LIKE '%:2026-05-18'")).rows[0].n), 0);
  const auditBefore = Number((await client.execute("SELECT count(*) AS n FROM audit_events WHERE entity_type='card_minimum_dues'")).rows[0].n);
  // The check runs inside the transaction: if the card's currency changes before the write, the write is refused.
  await client.execute({ sql: "UPDATE ledger_accounts SET currency='USD' WHERE id=?", args: [card.value] });
  check("a check made after a concurrent change sees the change", await refusal(() => writer.record(owner, { accountId: card.value, statementThrough: d("2026-07-18"), amount: inr("5.00") })), "CURRENCY_MISMATCH");
  await client.execute({ sql: "UPDATE ledger_accounts SET currency='INR' WHERE id=?", args: [card.value] });
  check("a refused write rolls back its audit", Number((await client.execute("SELECT count(*) AS n FROM audit_events WHERE entity_type='card_minimum_dues'")).rows[0].n), auditBefore);
  const sourceText = readFileSync("src/infra/card-minimum-due-store.ts", "utf8");
  checkTrue("lookups are made through the transaction executor", !/await this\.db\s*\.select\(\{ userId: ledgerAccounts/.test(sourceText) && /this\.find\(tx,/.test(sourceText));

  section("rollback 0025");
  for (const sql of readFileSync(`${dir}/rollback/0025_bands_and_card_minimums.down.sql`, "utf8").split("--> statement-breakpoint")) if (sql.trim()) await client.execute(sql);
  const tables = (await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('card_minimum_dues','rebalancing_bands')")).rows;
  check("both 0025 tables are gone", tables.length, 0);
  check("0024's table is untouched", (await client.execute("SELECT name FROM sqlite_master WHERE name='target_allocations'")).rows.length, 1);
  client.close();

  section("add-card form: no pre-filled minimum rule");
  const form = readFileSync("app/(root)/cards/add-card-form.tsx", "utf8");
  checkTrue("no 5% default", !/name="minimumDuePercent"[^>]*defaultValue/.test(form));
  checkTrue("no ₹500 floor default", !/name="minimumDueFloor"[^>]*defaultValue/.test(form));
  done();
}

main();
