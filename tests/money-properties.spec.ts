import { Money, Currency } from "@/core/money";
import {
  assertProperty, check, section, done, isolate,
  genMinor, genWeights, genOneOf, type Gen,
} from "./harness";

/**
 * Property tests for money.
 *
 * These are four of the nine properties in `_architecture/30-CALCULATIONS.md`
 * §9.1. The others land with the code they describe — lot methods and realised
 * gain in Phase 5, amortisation in Phase 4, event replay in Phase 1f.
 *
 * Every property prints its seed, so a CI failure is replayable with
 * `SEED=<n> npm test money-properties`.
 */

const CURRENCIES = [Currency.INR, Currency.USD] as const;

const genMoney: Gen<Money> = (rng) =>
  Money.fromMinor(genMinor()(rng), genOneOf(CURRENCIES)(rng));

const genAllocateCase: Gen<{ money: Money; weights: number[] }> = (rng) => ({
  money: genMoney(rng),
  weights: genWeights()(rng),
});

section("P-ALLOC-SUM — allocate loses nothing, ever");

// The load-bearing property: this is what makes splitting a fee across lots, or
// a basis across a disposal, safe. 10k runs because it is cheap and this one
// underpins cost basis, charge apportionment and tax allocation alike.
assertProperty(
  "P-ALLOC-SUM  sum(allocate(m, w)) === m",
  genAllocateCase,
  ({ money, weights }) => {
    const parts = money.allocate(weights);
    return Money.total(parts, money.currency).minor === money.minor;
  },
  10_000,
  { show: ({ money, weights }) => `${money.toString()} over [${weights.join(",")}]` },
);

assertProperty(
  "P-ALLOC-COUNT  allocate returns one part per weight",
  genAllocateCase,
  ({ money, weights }) => money.allocate(weights).length === weights.length,
  2_000,
);

section("P-ALLOC-SIGN — no part contradicts the whole");

// A negative total splitting into a positive part would turn a refund into a
// charge somewhere downstream.
assertProperty(
  "P-ALLOC-SIGN  every part carries the sign of the total, or is zero",
  genAllocateCase,
  ({ money, weights }) => {
    const parts = money.allocate(weights);
    if (money.isZero) return parts.every((p) => p.isZero);
    return money.isPositive
      ? parts.every((p) => !p.isNegative)
      : parts.every((p) => !p.isPositive);
  },
  5_000,
);

section("P-ALLOC-ORDER — largest remainder is monotonic in weight");

// A bigger share of the weight must never receive a smaller share of the money.
assertProperty(
  "P-ALLOC-ORDER  weight >= weight' implies part >= part'",
  genAllocateCase,
  ({ money, weights }) => {
    if (!money.isPositive) return true; // ordering is only meaningful one way
    const parts = money.allocate(weights);
    for (let i = 0; i < weights.length; i++) {
      for (let j = 0; j < weights.length; j++) {
        if (weights[i] > weights[j] && parts[i].isLessThan(parts[j])) return false;
      }
    }
    return true;
  },
  3_000,
);

section("P-MONEY-INVERSE — plus and minus undo each other");

const genPair: Gen<{ a: Money; b: Money }> = (rng) => {
  const currency = genOneOf(CURRENCIES)(rng);
  return {
    a: Money.fromMinor(genMinor()(rng), currency),
    b: Money.fromMinor(genMinor()(rng), currency),
  };
};

assertProperty(
  "P-MONEY-INVERSE  m.plus(n).minus(n) === m",
  genPair,
  ({ a, b }) => a.plus(b).minus(b).minor === a.minor,
  5_000,
);

assertProperty(
  "P-MONEY-COMMUTE  m.plus(n) === n.plus(m)",
  genPair,
  ({ a, b }) => a.plus(b).minor === b.plus(a).minor,
  2_000,
);

assertProperty(
  "P-MONEY-NEGATE  m.negated().negated() === m",
  genMoney,
  (m) => m.negated().negated().minor === m.minor,
  2_000,
);

assertProperty(
  "P-MONEY-ABS  abs(m) is never negative and preserves magnitude",
  genMoney,
  (m) => !m.abs().isNegative && (m.abs().minor === m.minor || m.abs().minor === -m.minor),
  2_000,
);

section("round-trip through the decimal string");

// The formatting layer reads `toDecimalString()`; if that is not lossless, every
// figure on screen is suspect.
assertProperty(
  "P-MONEY-STRING  fromRupees(m.toDecimalString()) === m",
  genMoney,
  (m) => Money.fromRupees(m.toDecimalString(), m.currency).minor === m.minor,
  5_000,
  { show: (m) => `${m.toString()} -> "${m.toDecimalString()}"` },
);

section("the harness itself");

// A property test that cannot fail is worse than no property test, so prove the
// runner reports falsification rather than silently passing. `isolate` keeps the
// deliberate failure out of this spec's own tally.
const falsified = isolate(() => {
  assertProperty("deliberately false property", genMoney, () => false, 1);
});
check("assertProperty reports a falsified property", falsified.failures, 1);

const throwing = isolate(() => {
  assertProperty("deliberately throwing property", genMoney, () => {
    throw new Error("boom");
  }, 1);
});
check("assertProperty reports a throwing property", throwing.failures, 1);

const holding = isolate(() => {
  assertProperty("trivially true property", genMoney, () => true, 1);
});
check("assertProperty passes a true property", holding.failures, 0);

done();
