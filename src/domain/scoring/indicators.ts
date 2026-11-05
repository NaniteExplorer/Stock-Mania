/**
 * The indicator registry — the contract every score is built on (task 3.0).
 *
 * `PRODUCT-REQUIREMENT.md` §5: **every indicator traces to a named formula and a
 * sourced threshold**, shown with its source in the UI. No invented weights, no
 * invented benchmarks. So an indicator is not a function; it is a declaration —
 * id, pillar, formula in words, benchmark, and the citation for the benchmark —
 * and **an indicator without a citation does not compile**: `Citation` has no
 * optional fields, and `indicator()` will not accept an empty one at runtime.
 *
 * A citation says what kind of authority it is, because they are not equal:
 * - `PRIMARY` — a published study, regulation or dataset, with URL and date;
 * - `CONVENTION` — a widely used rule of thumb, **named as convention** on screen,
 *   with where it is used ("lender convention") — never dressed up as a standard;
 * - `OWN_HISTORY` — banded against the owner's own past, where no public norm
 *   exists. Its "source" is the method, stated.
 *
 * **Protection is presence, not adequacy.** Product §4.1: no authoritative Indian
 * sum-insured threshold exists. The Protect pillar's indicators therefore score
 * cover held / declared absent / unknown, and none of them names a rupee amount
 * or an income multiple. (The Income & Standing mockup scores "term cover of
 * 10–12× income"; that contradicts §4.1 and is not carried over.)
 *
 * **Retirement funding is measured on total net worth** (owner decision
 * 2026-11-03, MEMORY.md): every asset less every liability, not the balance of
 * retirement accounts alone — the same net worth the milestones read.
 */

import { Count, Months, Ratio } from "@/core/units";

/** A benchmark is months, a fraction, or a multiple — each typed as what it is. */
export type BenchmarkValue = Months | Ratio | Count;

export type Pillar = "RUNWAY" | "SAVINGS" | "DEBT" | "STABILITY" | "PROTECT" | "RETIREMENT";

export type Citation =
  | { readonly kind: "PRIMARY"; readonly title: string; readonly url: string; readonly published: string }
  | { readonly kind: "CONVENTION"; readonly title: string; readonly usedBy: string }
  | { readonly kind: "OWN_HISTORY"; readonly title: string; readonly method: string };

/** What "meeting the benchmark" means for an indicator, in the direction it is good. */
export type Benchmark =
  | { readonly direction: "AT_LEAST"; readonly value: BenchmarkValue; readonly unit: string }
  | { readonly direction: "AT_MOST"; readonly value: BenchmarkValue; readonly unit: string }
  | { readonly direction: "PRESENT" }
  | { readonly direction: "OWN_BAND" };

export interface Indicator {
  readonly id: string;
  readonly pillar: Pillar;
  readonly name: string;
  /** The formula in words, as shown on screen: "Liquid assets ÷ average monthly outgo". */
  readonly formula: string;
  readonly benchmark: Benchmark;
  readonly citation: Citation;
  /**
   * Plausible alternative benchmarks for the sensitivity range (§5, task 3.5):
   * "3 vs 6 months", "10× vs 15×". Empty when the benchmark has no alternative.
   */
  readonly alternatives: readonly BenchmarkValue[];
}

/** The runtime half of "an uncited indicator does not compile": empty strings are refused too. */
export function indicator(definition: Indicator): Indicator {
  const texts = Object.values(definition.citation).filter((value): value is string => typeof value === "string");
  if (texts.some((text) => !text.trim())) {
    throw new RangeError(`Indicator ${definition.id} has an empty citation field; every field must be filled.`);
  }
  if (!definition.formula.trim()) throw new RangeError(`Indicator ${definition.id} needs its formula in words.`);
  if (definition.citation.kind === "PRIMARY" && !/^https:\/\//.test(definition.citation.url)) {
    throw new RangeError(`Indicator ${definition.id} cites a primary source without an https URL.`);
  }
  // A snapshot, frozen all the way down: a caller holding the object it passed in
  // must not be able to rewrite a citation or a benchmark after validation.
  return Object.freeze({
    ...definition,
    citation: Object.freeze({ ...definition.citation }),
    benchmark: Object.freeze({ ...definition.benchmark }),
    alternatives: Object.freeze([...definition.alternatives]),
  });
}

export const INDICATORS: readonly Indicator[] = Object.freeze([
  indicator({
    id: "runway-months",
    pillar: "RUNWAY",
    name: "Runway",
    formula: "Liquid assets ÷ average monthly outgo over the trailing 12 months",
    benchmark: { direction: "AT_LEAST", value: Months(6), unit: "months" },
    citation: { kind: "CONVENTION", title: "3 months adequate, 6 comfortable", usedBy: "personal-finance planning convention; no regulator sets it" },
    alternatives: [Months(3), Months(6)],
  }),
  indicator({
    id: "savings-rate",
    pillar: "SAVINGS",
    name: "Savings rate",
    formula: "1 − outgo ÷ income over the trailing 12 months",
    benchmark: { direction: "OWN_BAND" },
    citation: { kind: "OWN_HISTORY", title: "Banded against your own 24 months", method: "Percentile of the trailing-12-month rate within your own last 24 months; no public norm is used" },
    alternatives: [],
  }),
  indicator({
    id: "debt-service-ratio",
    pillar: "DEBT",
    name: "Debt service",
    formula: "Monthly instalments and card minimums ÷ median monthly net income",
    benchmark: { direction: "AT_MOST", value: Ratio(0.2), unit: "fraction of net income" },
    citation: { kind: "CONVENTION", title: "Below 20% of net income", usedBy: "Indian lender underwriting convention (FOIR); not a regulatory limit" },
    alternatives: [Ratio(0.2), Ratio(0.3)],
  }),
  indicator({
    id: "foir-ceiling",
    pillar: "DEBT",
    name: "Fixed obligations ceiling",
    formula: "All fixed monthly obligations ÷ median monthly net income",
    benchmark: { direction: "AT_MOST", value: Ratio(0.5), unit: "fraction of net income" },
    citation: { kind: "CONVENTION", title: "FOIR above 50% bars the top tier", usedBy: "Indian lender FOIR cut-offs; used here as a tier ceiling (task 3.3), not a score" },
    alternatives: [],
  }),
  indicator({
    id: "income-stability",
    pillar: "STABILITY",
    name: "Income stability",
    formula: "Coefficient of variation of monthly income over the trailing 12 months",
    benchmark: { direction: "OWN_BAND" },
    citation: { kind: "OWN_HISTORY", title: "Banded against your own history", method: "Compared with the coefficient of variation of your own prior 24 months" },
    alternatives: [],
  }),
  indicator({
    id: "health-cover-present",
    pillar: "PROTECT",
    name: "Health cover",
    formula: "Whether a health policy is in force today (insurance presence: covered, declared absent, unknown)",
    benchmark: { direction: "PRESENT" },
    citation: {
      kind: "CONVENTION",
      title: "Presence only — no adequacy threshold",
      usedBy: "No authoritative Indian sum-insured threshold exists (product §4.1); presence is scored, amount is shown",
    },
    alternatives: [],
  }),
  indicator({
    id: "term-cover-present",
    pillar: "PROTECT",
    name: "Term life cover",
    formula: "Whether a term life policy is in force today, where anyone depends on your income",
    benchmark: { direction: "PRESENT" },
    citation: {
      kind: "CONVENTION",
      title: "Presence only — no income multiple",
      usedBy: "Income multiples (10–12×) are industry sales convention, not a standard; product §4.1 scores presence",
    },
    alternatives: [],
  }),
  indicator({
    id: "independence-multiple",
    pillar: "RETIREMENT",
    name: "Retirement funding",
    // Owner decision 2026-11-03 (MEMORY.md): measured on total net worth, not on retirement accounts.
    formula: "Total net worth (every asset less every liability) ÷ trailing-12-month expenses",
    benchmark: { direction: "AT_LEAST", value: Count(33), unit: "× annual expenses" },
    citation: {
      kind: "PRIMARY",
      title: "Saraogi (2022): ~3.0% safe withdrawal rate on Indian markets",
      url: "https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4216077",
      published: "2022",
    },
    alternatives: [Count(25), Count(33)],
  }),
]);

/** Every indicator of a pillar. A pillar with none is a registry defect, caught by the spec. */
export function indicatorsFor(pillar: Pillar): readonly Indicator[] {
  return INDICATORS.filter((candidate) => candidate.pillar === pillar);
}
