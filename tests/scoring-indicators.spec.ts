/**
 * Contract for task 3.0 — the indicator registry.
 *
 * Acceptance (TASKS.md 3.0): an indicator without a primary-source citation does
 * not compile. Interpreted with product §5 ("a named formula and a sourced
 * threshold") as: every indicator carries a non-empty citation of a declared kind;
 * a convention is labelled as one; a primary source has an https URL and a date.
 * Plus product §4.1: the Protect pillar scores presence and names no amount.
 */
import { readFileSync } from "node:fs";
import { INDICATORS, indicator, indicatorsFor, type Indicator, type Pillar } from "@/domain/scoring/indicators";
import { check, checkDeep, done, section, throws } from "./harness";

const PILLARS: readonly Pillar[] = ["RUNWAY", "SAVINGS", "DEBT", "STABILITY", "PROTECT", "RETIREMENT"];

section("every pillar has indicators, and every id is unique");
checkDeep("no pillar is empty", PILLARS.filter((p) => indicatorsFor(p).length === 0), []);
check("ids are unique", new Set(INDICATORS.map((i) => i.id)).size, INDICATORS.length);

section("every indicator is cited, and says what kind of authority it is");
check("every citation has a kind and a title", INDICATORS.every((i) => i.citation.kind.length > 0 && i.citation.title.trim().length > 0), true);
check("every primary source has an https URL and a date", INDICATORS.filter((i) => i.citation.kind === "PRIMARY").every((i) => i.citation.kind === "PRIMARY" && i.citation.url.startsWith("https://") && i.citation.published.length > 0), true);
check("every convention says who uses it", INDICATORS.filter((i) => i.citation.kind === "CONVENTION").every((i) => i.citation.kind === "CONVENTION" && i.citation.usedBy.trim().length > 0), true);

const base: Indicator = {
  id: "x",
  pillar: "RUNWAY",
  name: "x",
  formula: "a ÷ b",
  benchmark: { direction: "PRESENT" },
  citation: { kind: "CONVENTION", title: "t", usedBy: "u" },
  alternatives: [],
};
throws("an empty citation field is refused at runtime", () => indicator({ ...base, citation: { kind: "CONVENTION", title: "t", usedBy: " " } }), "empty citation");
throws("a primary source without https is refused", () => indicator({ ...base, citation: { kind: "PRIMARY", title: "t", url: "ssrn 4216077", published: "2022" } }), "https");
throws("a formula is required in words", () => indicator({ ...base, formula: "" }), "formula");
// Type-checked, never run: the compiler is the test here.
export function compileTimeOnly(): void {
  // @ts-expect-error a citation is not optional — this is "does not compile"
  indicator({ ...base, citation: undefined });
  // @ts-expect-error nor may a primary source omit its URL
  indicator({ ...base, citation: { kind: "PRIMARY", title: "t", published: "2022" } });
}

section("protection is presence, never an amount or an income multiple");
const protect = indicatorsFor("PROTECT");
check("every Protect benchmark is PRESENT", protect.every((i) => i.benchmark.direction === "PRESENT"), true);
check("health cover is one of them", protect.some((i) => i.id === "health-cover-present"), true);

section("the independence benchmark is 33×, and 25× only as a sensitivity alternative");
const independence = INDICATORS.find((i) => i.id === "independence-multiple")!;
check("benchmark is 33", independence.benchmark.direction === "AT_LEAST" ? independence.benchmark.value : null, 33);
checkDeep("25 appears only as the 4% SWR sensitivity case", independence.alternatives, [25, 33]);

section("the registry is frozen");
check("an indicator object cannot be altered", Object.isFrozen(INDICATORS[0]), true);
check("no rupee amounts in the registry", /₹|rupee|lakh|crore/i.test(readFileSync("src/domain/scoring/indicators.ts", "utf8").replace(/\/\*[\s\S]*?\*\//g, "")), false);

section("QA regressions (Codex, 2026-10-28): frozen all the way down");
const caller = { ...base, citation: { kind: "CONVENTION" as const, title: "t", usedBy: "u" }, alternatives: [] as never[] };
const snapshot = indicator(caller);
caller.citation.title = "rewritten";
check("mutating the caller's citation does not reach the registered one", snapshot.citation.title, "t");
check("citation, benchmark and alternatives are frozen", [snapshot.citation, snapshot.benchmark, snapshot.alternatives].every(Object.isFrozen), true);
check("the registry array itself is frozen", Object.isFrozen(INDICATORS), true);
check("every registered indicator's citation is frozen", INDICATORS.every((i) => Object.isFrozen(i.citation) && Object.isFrozen(i.benchmark)), true);

section("QA repair 2026-11-03: retirement funding is on total net worth (owner decision)");
const funding = INDICATORS.find((i) => i.id === "independence-multiple")!;
check("the formula names total net worth", funding.formula.startsWith("Total net worth"), true);
check("and no longer retirement accounts alone", /retirement assets/i.test(funding.formula), false);

done();
