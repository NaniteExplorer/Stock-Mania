import { Money, ROUNDING } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate, FinancialYear } from "@/core/time";
import { TaxEngine, type TaxableEvent, type TaxSettings } from "@/domain/tax";
import { check, checkDeep, section, done, assertProperty, genInt, genOneOf, type Gen } from "./harness";

/**
 * Provenance.
 *
 * `70` Phase 1c: "the UI can render *why this number* for any line without
 * recomputation". This spec is the audit of that claim — every line must name a
 * registered rule, and every tax figure must be recomputable from the `inputs`
 * the line carries. If it is not, the explanation and the number have drifted,
 * and the explanation is the one people will believe.
 */

const engine = new TaxEngine();

const SETTINGS: TaxSettings = {
  slabRate: Percentage.of("30"),
  totalIncome: Money.fromRupees("1500000"),
  residentStatus: "RESIDENT",
};

/** Every rule the shipped regimes can emit. A line naming anything else is a bug. */
const REGISTERED_RULES = new Set([
  "IN.EXEMPT_SCHEME",
  "IN.GRANDFATHERING_2018",
  "IN.INDEXATION_CII",
  "IN.CLASSIFY_TERM",
  "IN.SLAB_INCOME",
  "IN.LOSS_SET_OFF",
  "IN.LTCG_EXEMPTION",
  "IN.APPLY_RATE",
]);

interface Case {
  category: "LISTED_EQUITY" | "DEBT" | "GOLD" | "VDA" | "DEBT_LEGACY";
  proceeds: number;
  cost: number;
  holdingDays: number;
  grandfathered: boolean;
}

const genCase: Gen<Case> = (rng) => ({
  category: genOneOf(["LISTED_EQUITY", "DEBT", "GOLD", "VDA", "DEBT_LEGACY"] as const)(rng),
  proceeds: genInt(1, 5_000_000)(rng),
  cost: genInt(1, 5_000_000)(rng),
  holdingDays: genInt(1, 4_000)(rng),
  grandfathered: rng() < 0.25,
});

function eventFor(c: Case): TaxableEvent {
  const proceeds = Money.fromRupees(String(c.proceeds));
  const cost = Money.fromRupees(String(c.cost));
  const acquiredOn = c.grandfathered
    ? CalendarDate.parse("2015-06-01")
    : CalendarDate.parse("2022-06-01");
  return {
    id: "e1",
    kind: "CAPITAL_GAIN",
    onDate: CalendarDate.parse("2025-09-10"),
    taxCategory: c.category,
    instrumentId: "X",
    acquiredOn,
    holdingDays: c.holdingDays,
    proceeds,
    costBasis: cost,
    gain: proceeds.minus(cost),
    deductibleCharges: Money.zero(),
    fmvOnGrandfatherDate:
      c.grandfathered && c.category === "LISTED_EQUITY"
        ? Money.fromRupees(String(Math.floor(c.cost * 2)))
        : null,
    sourceTransactionId: "t1",
    sourceLotId: "l1",
  };
}

const assess = (c: Case) =>
  engine.assess(FinancialYear.parse("2025-26"), [eventFor(c)], SETTINGS);

section("every line names a registered rule and the regime that ran it");

const sample = assess({
  category: "LISTED_EQUITY",
  proceeds: 900000,
  cost: 100000,
  holdingDays: 3714,
  grandfathered: true,
});

checkDeep(
  "no line names an unregistered rule",
  sample.lines.map((l) => l.rule).filter((r) => !REGISTERED_RULES.has(r)),
  [],
);
checkDeep(
  "every line records its regime",
  [...new Set(sample.lines.map((l) => l.ruleVersion))],
  ["IN-FY2025"],
);
check("every line has a human label", sample.lines.every((l) => l.label.length > 0), true);
check("and carries its event id", sample.lines.every((l) => l.eventId === "e1"), true);

section("the chain is ordered, and each line records what came before it");

// `derivedFrom` is what lets the UI show the sequence of reliefs rather than a
// pile of unrelated adjustments.
checkDeep(
  "the grandfathered chain in order",
  sample.lines.map((l) => l.rule),
  ["IN.GRANDFATHERING_2018", "IN.CLASSIFY_TERM", "IN.LTCG_EXEMPTION", "IN.APPLY_RATE"],
);
check("the first line derives from nothing", sample.lines[0].derivedFrom.length, 0);
check(
  "the rate line derives from all three before it",
  sample.lines[sample.lines.length - 1].derivedFrom.length,
  3,
);

section("the inputs are sufficient to recompute the figure");

const rateLine = sample.lines.find((l) => l.rule === "IN.APPLY_RATE");
check("proceeds recorded", rateLine?.inputs.proceeds, "900000.00");
check("cost recorded", rateLine?.inputs.cost, "100000.00");
check("the stepped-up basis recorded", rateLine?.inputs.adjustedBasis, "200000.00");
check("the exemption consumed recorded", rateLine?.inputs.exemptionConsumed, "125000.00");
check("the rate recorded", rateLine?.inputs.rate, "12.50");
check("the holding period recorded", rateLine?.inputs.holdingDays, "3714");

section("self-audit — every tax figure recomputes from its own line");

/*
 * This is the assertion that keeps the explanation honest. If `tax` could differ
 * from `rate × taxableAmount`, the "why this number" panel would be describing a
 * calculation the engine did not perform — and the panel is what a person would
 * believe.
 */
assertProperty(
  "P-TAX-RECOMPUTE  tax === rate applied to taxableAmount",
  genCase,
  (c) => {
    const assessment = assess(c);
    return assessment.lines
      .filter((l) => l.rule === "IN.APPLY_RATE")
      .every((line) => {
        const expected = line.taxableAmount.isPositive
          ? line.rate.applyTo(line.taxableAmount, ROUNDING.tax)
          : Money.zero(line.gain.currency);
        return line.tax.minor === expected.minor;
      });
  },
  5_000,
  { show: (c) => `${c.category} ${c.proceeds}/${c.cost} ${c.holdingDays}d gf=${c.grandfathered}` },
);

section("gain is never rewritten by a relief");

/*
 * The single discipline the whole design rests on: `gain` is the economic figure,
 * written once by classification; every relief writes only `taxableAmount`. If a
 * relief could move `gain`, the two columns would converge and "you made X and
 * are taxed on Y" would become unsayable.
 */
assertProperty(
  "P-TAX-GAIN-STABLE  every line reports the same gain",
  genCase,
  (c) => {
    const lines = assess(c).lines;
    if (lines.length === 0) return true;
    const first = lines[0].gain.minor;
    return lines.every((l) => l.gain.minor === first);
  },
  3_000,
);

assertProperty(
  "P-TAX-GAIN-IS-ECONOMIC  gain always equals proceeds less cost",
  genCase,
  (c) => {
    const event = eventFor(c);
    const lines = assess(c).lines;
    return lines.every((l) => l.gain.minor === event.gain.minor);
  },
  3_000,
);

section("tax is never negative, and a loss is never taxed");

assertProperty(
  "P-TAX-NON-NEGATIVE  no line carries negative tax",
  genCase,
  (c) => assess(c).lines.every((l) => !l.tax.isNegative),
  3_000,
);

assertProperty(
  "P-TAX-LOSS-UNTAXED  a negative taxable amount yields no tax",
  genCase,
  (c) =>
    assess(c)
      .lines.filter((l) => l.taxableAmount.isNegative)
      .every((l) => l.tax.isZero),
  3_000,
);

section("relief never increases the taxable amount");

/*
 * Every rule in the chain is a relief — a step-up, an indexation, a set-off, an
 * exemption. None may make the taxable amount larger than the raw gain, and a rule
 * that did would be an unannounced surcharge.
 */
assertProperty(
  "P-TAX-RELIEF-MONOTONIC  taxable never exceeds gain when gain is positive",
  genCase,
  (c) => {
    const lines = assess(c).lines;
    return lines.every(
      (l) => !l.gain.isPositive || l.taxableAmount.isLessThanOrEqual(l.gain),
    );
  },
  3_000,
);

section("the assessment totals agree with its lines");

assertProperty(
  "P-TAX-TOTALS  bucket totals sum the rate lines exactly",
  genCase,
  (c) => {
    const a = assess(c);
    const rateLines = a.lines.filter((l) => l.rule === "IN.APPLY_RATE");
    let summed = Money.zero();
    for (const bucket of Object.values(a.totals)) summed = summed.plus(bucket.tax);
    let expected = Money.zero();
    for (const line of rateLines) expected = expected.plus(line.tax);
    return summed.minor === expected.minor;
  },
  3_000,
);

done();
