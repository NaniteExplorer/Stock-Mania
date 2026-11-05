import { spawnSync } from "node:child_process";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { check, checkTrue, done, section } from "./harness";

type Source = { path: string; source: string };
type Diagnostic = { path: string; line: number; rule: string; message: string };
const { analyzeSources } = await import(pathToFileURL(resolve("scripts/architecture-conformance.mjs")).href) as {
  analyzeSources: (files: Source[]) => Diagnostic[];
};
const analyze = (source: string) => analyzeSources([{ path: "src/domain/fixture.ts", source }]);
const fails = (label: string, source: string, rule: string) => {
  const found = analyze(source);
  checkTrue(label, found.some((item) => item.rule === rule));
  checkTrue(`${label}: useful location`, found.every((item) => item.path === "src/domain/fixture.ts" && item.line > 0 && item.message.length > 10));
};
const passes = (label: string, source: string) => check(label, analyze(source).length, 0);

section("domain behavior delegates rather than checking runtime classes");
fails("instanceof is rejected", "export const yes = value instanceof Split;", "domain-instanceof");
passes("strings and comments are not executable instanceof", '// instanceof Split\nexport const label = "value instanceof Split";');
passes("polymorphic delegation", "export function inverse(action) { return action.inverse(); }");

section("domain imports cannot name infrastructure through any dependency syntax");
for (const [name, source] of [
  ["relative import", 'import { db } from "../infra/db";'],
  ["nested relative import", 'import { db } from "./nested/../../infra/db";'],
  ["alias import", 'import { db } from "@/infra/db";'],
  ["type-only import", 'import type { Row } from "@/infra/db";'],
  ["barrel re-export", 'export { Row } from "../infra/db";'],
  ["star re-export", 'export * from "@/infra/db";'],
  ["dynamic import", 'async function load() { return import("@/infra/db"); }'],
  ["CommonJS require", 'const db = require("../infra/db");'],
  ["import equals", 'import db = require("../infra/db");'],
  ["inline import type", 'export type Row = import("@/infra/db").Row;'],
  ["normalized alias import", 'import { DB } from "@/domain/../infra/db";'],
  ["static module-name alias", 'const path = "@/infra/db"; async function load() { return import(path); }'],
  ["static concatenated module name", 'async function load() { return import("@/" + "infra/db"); }'],
] as const) fails(name, source, "domain-infra-import");
passes("core and domain dependencies allowed", 'import { Money } from "../core/money"; export { Account } from "./accounts";');
passes("similarly named package is not infra", 'import { x } from "infrared"; import { y } from "../infrastructure-types";');

section("factory exemption is structural and cannot hide engine behavior");
passes("tag switch factory", 'function make(kind) { switch(kind) { case "A": return new A(); default: return new B(); } }');
passes("shared labels retain loanFor factory", 'function make(terms) { switch(terms.kind) { case "A": case "B": return new B(); } }');
passes("if factory", 'function make(input) { if(input.type === "A") return new A(); else if(input.type === "B") { return new B(); } else return new C(); }');
fails("calculation in switch arm", 'function f(x) { switch(x.kind) { case "A": const fee = 2; return new A(fee); default: return new B(); } }', "domain-tag-dispatch");
fails("prose-named factory has no exemption", 'function factory(kind) { switch(kind) { case "A": return compute(); default: return new B(); } }', "domain-tag-dispatch");
fails("empty final arm is not a factory", 'function factory(kind) { switch(kind) { case "A": return new A(); default: } }', "domain-tag-dispatch");
fails("break arm is not a factory", 'function f(x) { switch(x.type) { case "A": break; default: return new B(); } }', "domain-tag-dispatch");
fails("single tag if is behavior", 'if (row.kind === "A") apply(row);', "domain-tag-dispatch");
fails("if calculation is not factory", 'if (row.kind === "A") { count++; return new A(); } else return new B();', "domain-tag-dispatch");
fails("missing final fallback is not if factory", 'if (row.type === "A") return new A();', "domain-tag-dispatch");
fails("tag nested in unrelated else-if detected", 'if (ready) serve(); else if(row.kind === "A") mutate();', "domain-tag-dispatch");
fails("tag compound guard detected", 'if (ready && row.type !== "A") mutate();', "domain-tag-dispatch");
passes("ordinary switches and guards", 'switch(frequency) { case "MONTHLY": return 12; default: return 1; } if (balance.isPositive) spend();');

section("simple aliases cannot conceal tag dispatch");
fails("static element tag access", 'switch(row["kind"]) { case "A": apply(); break; }', "domain-tag-dispatch");
fails("computed static element tag access", 'const key = "kind"; switch(row[key]) { case "A": apply(); break; }', "domain-tag-dispatch");
fails("variable tag alias", 'const tag = row.kind; switch(tag) { case "A": apply(); break; }', "domain-tag-dispatch");
fails("destructured renamed tag", 'const { kind: classification } = row; if(classification === "A") apply();', "domain-tag-dispatch");
fails("parameter destructuring alias", 'function run({ type: classification }) { if(classification === "A") apply(); }', "domain-tag-dispatch");
fails("cast does not hide a tag", 'switch((row.kind as Kind)) { case "A": apply(); break; }', "domain-tag-dispatch");
passes("lexically shadowed non-tag alias", 'const tag = row.kind; function use() { const tag = frequency; switch(tag) { case "MONTHLY": return 12; } }');

section("exported numeric boundaries require real units, not semantic names");
for (const name of ["periods", "period", "count", "rowCount", "index", "rowIndex", "length", "limit", "offset", "depth", "rank", "attempt", "decimals", "scale", "perYear", "paymentsPerYear"]) {
  fails(`formerly permitted ${name} now needs a unit`, `export interface Data { ${name}: number }`, "domain-raw-number");
}
for (const name of ["Count", "Ordinal", "Days", "DaySpan", "Months", "Years", "Minutes", "Millis", "Ratio", "PriceLevel", "IndexPoints", "SortKey", "Sign", "Polarity"]) {
  passes(`real ${name} brand is accepted`, `import type { ${name} } from "../core/units"; export interface Data { value: ${name} }`);
}
passes("brand import aliases remain nominal", 'import type { Count as Rows } from "../core/units"; export function count(rows: Rows): Rows { return rows; }');
passes("brands in containers and callback signatures remain typed", 'import type { Ratio, Count } from "../core/units"; export interface Data { values: readonly Ratio[]; run: (rows: Count) => Promise<Ratio> }');
passes("explicit signed direction union is bounded", "export type Direction = 1 | -1; export function sign(value: Direction): Direction { return value; }");
passes("type guard before subtype construction switch is an exact factory", 'function classify(account) { if(account.type !== "ASSET") return null; switch(account.subtype) { case "BANK": case "SAVINGS": return new Bank(account); default: return null; } }');
passes("type and subtype null guards before construction remain an exact factory", 'function classify(account) { if(account.type !== "LIABILITY") return null; if(account.subtype !== "CARD") return null; return new Card(account); }');
fails("mixed-selector factory cannot hide branch work", 'function classify(account) { if(account.type !== "ASSET") return null; switch(account.subtype) { case "BANK": audit(account); return new Bank(account); default: return null; } }', "domain-tag-dispatch");
fails("mixed-selector factory cannot hide guard work", 'function classify(account) { if(account.type !== "LIABILITY") return null; if(account.subtype !== "CARD") { audit(account); return null; } return new Card(account); }', "domain-tag-dispatch");
fails("empty intersection is no brand", "export type Fake = number & {}; export interface Data { count: Fake }", "domain-raw-number");
fails("untrusted local marker is no approved brand", 'declare const marker: unique symbol; type Count = number & { [marker]: "count" }; export interface Data { count: Count }', "domain-raw-number");
fails("generic Unit cannot invent an unapproved rank", 'import type { Unit } from "../core/units"; type Fake = Unit<"rupees">; export interface Data { value: Fake }', "domain-raw-number");
passes("recursive domain types do not loop during boundary inspection", 'class Node { next(): Node { return this; } } export function node(): Node { return new Node(); }');
fails("brand name alone is no exemption", "type Ratio = number; export interface Data { value: Ratio }", "domain-raw-number");
fails("numeric literal is not a count unit", "export const count = 2;", "domain-raw-number");
fails("numeric enum is not a monetary unit", "export enum Amount { Rupees = 100, Paise = 1 }; export interface Data { amount: Amount }", "domain-raw-number");
passes("approved price alias retains real marker", 'import type { PriceLevel } from "../core/units"; type Price = PriceLevel; export interface Data { value: Price }');
passes("bounded numeric literal unions follow settled contract", "export type Mode = 1 | 2;");
passes("nullable aliased polarity remains bounded", "type Neutral = -1 | 0 | 1; export interface Data { side: Neutral | null }");
fails("a bounded alias widened to number is still raw", "type Mode = 1 | 2; export interface Data { side: Mode | number }", "domain-raw-number");
fails("exported money cannot be a number", "export function total(amount: number): number { return amount; }", "domain-raw-number");
fails("years carry a unit", "export interface Term { years: number }", "domain-raw-number");
fails("numeric type alias cannot hide raw quantity", "type Raw = number; export interface Quote { price: Raw }", "domain-raw-number");
fails("inferred public member is still a number", "export class Quote { price = 2; }", "domain-raw-number");
fails("inferred exported return is still a number", "export function yieldRate() { return 1 / 2; }", "domain-raw-number");
fails("array contains raw numeric quantities", "export interface Quotes { prices: readonly number[] }", "domain-raw-number");
fails("generic wrapper cannot hide numeric quantities", "export interface Box<T> { value: T }; export function quote(): Box<number> { return {value: 2}; }", "domain-raw-number");
fails("record cannot hide numeric quantities", "export type Prices = Record<string, number>;", "domain-raw-number");
fails("callback parameter is part of boundary", "export function run(callback: (amount: number) => void) {}", "domain-raw-number");
fails("export list alias does not hide declaration", "function rate() { return 2; } export { rate };", "domain-raw-number");
fails("inherited public signatures remain exported", "class Base { rate(): number { return 2; } } export class Derived extends Base {}", "domain-raw-number");
passes("actual value objects encapsulate internal representation", 'import { Money } from "../core/money"; export function total(amount: Money): Money { return amount; }');
fails("plain class name cannot impersonate value object", "class Money { internal = 2; } export function total(amount: Money): Money { return amount; }", "domain-raw-number");
passes("local alias of approved brand remains typed", 'import type { Count } from "../core/units"; type Rows = Count; export interface Data { rows: Rows }');
fails("brand cannot hide an extra raw metadata quantity", 'import type { Count } from "../core/units"; type Rows = Count & { price: number }; export interface Data { rows: Rows }', "domain-raw-number");
passes("approved brand plus metadata remains branded", 'import type { Count } from "../core/units"; type Rows = Count & { readonly context: "rows" }; export interface Data { rows: Rows }');
passes("private arithmetic is not an exported signature", "export class Calc { private rate = 2; private compute(): number { return this.rate; } }");
fails("inferred count return still requires a unit", "export const count = () => 2;", "domain-raw-number");
fails("unitless semantic names cannot hide raw arrays", "export interface Result { rowCount: number[] }", "domain-raw-number");

section("exact invariant, filter and null factory exceptions");
const importedBoundary = (label: string, foreign: string, consumer: string, expected: boolean) => {
  const diagnostics = analyzeSources([
    { path: "src/core/boundary-fixture.ts", source: foreign },
    { path: "src/domain/consumer-fixture.ts", source: consumer },
  ]).filter((item) => item.path === "src/domain/consumer-fixture.ts" && item.rule === "domain-raw-number");
  check(label, diagnostics.length > 0, expected);
  checkTrue(`${label}: consumer location`, diagnostics.every((item) => item.line > 0 && item.line <= consumer.split("\n").length));
};
section("imported boundaries remain visible at their consumer");
importedBoundary("imported DTO cannot hide raw quantity", "export interface Data { quantity: number }", 'import type { Data } from "../core/boundary-fixture"; export function use(data: Data): void {}', true);
importedBoundary("imported callback cannot hide raw input", 'import type { Ratio } from "./units"; export type Callback = (value: number) => Ratio;', 'import type { Callback } from "../core/boundary-fixture"; export interface Data { run: Callback }', true);
importedBoundary("imported generic callback inspects instantiated input", "export type Callback<T> = (value: T) => T;", 'import type { Callback } from "../core/boundary-fixture"; export interface Data { run: Callback<number> }', true);
importedBoundary("imported callback cannot hide raw return", "export type Callback = () => number;", 'import type { Callback } from "../core/boundary-fixture"; export interface Data { run: Callback }', true);
importedBoundary("imported constructor cannot hide raw input", "export type Constructor = new (value: number) => object;", 'import type { Constructor } from "../core/boundary-fixture"; export interface Data { make: Constructor }', true);
importedBoundary("recursive imported DTO still finds raw quantity", "export interface Data { next?: Data; count: number }", 'import type { Data } from "../core/boundary-fixture"; export interface Output { data: Data }', true);
importedBoundary("recursive generic methods terminate and retain numeric payload", "export interface Data<T> { optional(): Data<Data<T>>; value: T }", 'import type { Data } from "../core/boundary-fixture"; export interface Output { data: Data<number> }', true);
importedBoundary("fake UnitFactory has no constructor exemption", 'import type { Ratio } from "./units"; export type UnitFactory = (value: number) => Ratio;', 'import type { UnitFactory } from "../core/boundary-fixture"; export interface Data { unit: UnitFactory }', true);
importedBoundary("branded imported generic callback remains valid", "export type Callback<T> = (value: T) => T;", 'import type { Ratio } from "../core/units"; import type { Callback } from "../core/boundary-fixture"; export interface Data { run: Callback<Ratio> }', false);
importedBoundary("imported brand metadata cannot hide raw quantity", 'import type { Count } from "./units"; export type Data = Count & { price: number };', 'import type { Data } from "../core/boundary-fixture"; export interface Output { data: Data }', true);
importedBoundary("factory return metadata cannot hide raw quantity", 'import type { Ratio, UnitFactory } from "./units"; export type Data = UnitFactory<Ratio & { hidden: number }>;', 'import type { Data } from "../core/boundary-fixture"; export interface Output { data: Data }', true);
importedBoundary("imported generic numeric constraint remains numeric", "export interface Data { run<T extends number>(value: T): T }", 'import type { Data } from "../core/boundary-fixture"; export interface Output { data: Data }', true);
passes("genuine continuous-unit constructor is permitted", 'import type { UnitFactory, Ratio } from "../core/units"; export interface Data { unit: UnitFactory<Ratio> }');
passes("generic continuous-unit constructor is permitted", 'import type { UnitFactory, Ratio, PriceLevel } from "../core/units"; export function dispersion<U extends Ratio | PriceLevel>(unit: UnitFactory<U>): U { return unit(0); }');
fails("genuine factory cannot convert arbitrary raw data", 'import type { UnitFactory } from "../core/units"; export interface Data { unit: UnitFactory<number> }', "domain-raw-number");
fails("integer-unit factory is outside continuous constructor contract", 'import type { UnitFactory, Count } from "../core/units"; export interface Data { unit: UnitFactory<Count> }', "domain-raw-number");
passes("standard Date methods are not DTO payload", "export interface Input { on: Date }");
fails("standard container still inspects numeric payload", "export interface Input { values: Map<string, number> }", "domain-raw-number");
passes("throw-only tag guard refuses invalid input", 'class Loan { constructor(row) { if (row.kind !== "LOAN") throw new Error("Invalid"); this.row = row; } }');
passes("continue-only tag filter", 'for(const row of rows) { if(row.type !== "ASSET") continue; record(row); }');
passes("switch factory can return null", 'function make(row) { switch(row.kind) { case "A": return new A(); default: return null; } }');
passes("null guards precede a construction factory", 'function make(row) { if(row.type !== "A") return null; if(row.kind !== "B") return null; return new A(row); }');
passes("null guard precedes switch factory", 'function make(row) { if(row.type !== "ASSET") return null; switch(row.kind) { case "A": return new A(); default: return null; } }');
fails("null guard cannot hide behavioral processing", 'function make(row) { if(row.kind === "A") return null; compute(row); return new B(); }', "domain-tag-dispatch");
fails("invariant guard cannot compute before throw", 'if(row.type !== "A") { record(row); throw new Error(); }', "domain-tag-dispatch");
fails("filter cannot compute before continue", 'for(const row of rows) { if(row.kind !== "A") { audit(row); continue; } }', "domain-tag-dispatch");
fails("throwing branch with behavioral else is no guard", 'if(row.type === "A") throw new Error(); else mutate(row);', "domain-tag-dispatch");
fails("null arm cannot compute before returning", 'function make(row) { switch(row.kind) { case "A": return new A(); default: audit(); return null; } }', "domain-tag-dispatch");

section("diagnostics are stable and the CLI fails actual violations");
const two = analyze('const x = item instanceof A;\nimport type { DB } from "@/infra/db";');
check("line numbers follow source", two.map((item) => item.line).join(","), "1,2");
const directory = mkdtempSync(join(tmpdir(), "stock-mania-architecture-"));
const cleanFile = join(directory, "clean.ts");
try {
  writeFileSync(cleanFile, "export class Value {}\n");
  const cli = spawnSync(process.execPath, ["scripts/architecture-conformance.mjs", cleanFile], { encoding: "utf8" });
  check("clean CLI passes all implemented rules", cli.status, 0);
  checkTrue("CLI clearly reports conformance", cli.stdout.includes("Architecture conformance: PASS"));
} finally { unlinkSync(cleanFile); rmdirSync(directory); }
done();
