/**
 * The money-to-ratio boundary (`src/core/ratio.ts`): exact BigInt division,
 * one rounding to a double, no amount ever converted to a float. Made-up figures.
 */
import { Currency, Money } from "@/core/money";
import { compareFractions, exactRatio, moneyRatio } from "@/core/ratio";
import { check, checkTrue, done, mulberry32, section, throws } from "./harness";

const INR = Currency.of("INR");
const USD = Currency.of("USD");

section("ordinary quotients are the nearest double");
{
  check("1/4", exactRatio(1n, 4n), 0.25);
  check("1/3", exactRatio(1n, 3n), 1 / 3);
  check("2/3", exactRatio(2n, 3n), 2 / 3);
  check("-1/8", exactRatio(-1n, 8n), -0.125);
  check("1/-8", exactRatio(1n, -8n), -0.125);
  check("0/7", exactRatio(0n, 7n), 0);
  check("205/1000", exactRatio(205n, 1000n), 0.205);
  const random = mulberry32(20261103);
  let agree = true;
  for (let i = 0; i < 2000; i += 1) {
    const a = BigInt(Math.floor(random() * 1e9)) + 1n;
    const b = BigInt(Math.floor(random() * 1e9)) + 1n;
    if (exactRatio(a, b) !== Number(a) / Number(b)) agree = false;
  }
  checkTrue("2,000 safe-range quotients equal IEEE division exactly", agree);
}

section("huge values: no safe-integer limit, no clamp");
{
  // ₹9,00,71,99,25,47,40,99 a month, twelve months, as minor units: past 2^53.
  const month = Money.fromRupees("900719925474099.00", INR);
  const year = Money.total(Array.from({ length: 12 }, () => month), INR);
  throws("toMinorNumber refuses the year (the defect being fixed)", () => year.toMinorNumber(), "safe");
  check("a month over its year is exactly 1/12", moneyRatio(month, year), 1 / 12);
  check("the year over a month is exactly 12", moneyRatio(year, month), 12);
  check("near-int64 operands", exactRatio(9_223_372_036_854_775_807n, 3n), 3074457345618258602.3333333);
  check("tiny ratio keeps its significant digits", exactRatio(1n, 9_000_000_000_000_000_000n), 1 / 9e18);
  check("ratio above one is not clamped", exactRatio(5n * 10n ** 30n, 10n ** 30n), 5);
  check("negative ratio is not clamped", moneyRatio(Money.fromRupees("-990000", INR), Money.fromRupees("600000", INR)), -1.65);
  throws("a quotient beyond a double is refused, not Infinity", () => exactRatio(10n ** 400n, 1n), "finite");
}

section("binary rounding: correctly rounded nearest double, ties to even");
{
  // The independent-QA counterexample: just above the 1 / 1+2^-52 midpoint.
  check("2^53 / (2^53-1) rounds up", exactRatio(9007199254740992n, 9007199254740991n), 1.0000000000000002);
  check("negated numerator", exactRatio(-9007199254740992n, 9007199254740991n), -1.0000000000000002);
  check("negated denominator", exactRatio(9007199254740992n, -9007199254740991n), -1.0000000000000002);
  check("both negated", exactRatio(-9007199254740992n, -9007199254740991n), 1.0000000000000002);
  // Exact ties: (2^53+1)/1 sits between 2^53 and 2^53+2 -> even (2^53).
  check("tie to even, down", exactRatio(2n ** 53n + 1n, 1n), 2 ** 53);
  check("tie to even, up", exactRatio(2n ** 53n + 3n, 1n), 2 ** 53 + 4);
  check("tie to even after division", exactRatio(2n ** 54n + 2n, 2n), 2 ** 53);
  check("negative tie mirrors", exactRatio(-(2n ** 53n + 3n), 1n), -(2 ** 53 + 4));
  check("just above a tie rounds up", exactRatio((2n ** 53n + 1n) * 3n + 1n, 3n), 2 ** 53 + 2);
  check("smallest subnormal", exactRatio(1n, 2n ** 1074n), 5e-324);
  check("half the smallest subnormal ties to zero", exactRatio(1n, 2n ** 1075n), 0);
  check("above half the smallest subnormal rounds up", exactRatio(2n ** 1075n + 1n, 2n ** 2150n), 5e-324);
  check("largest double", exactRatio((2n ** 53n - 1n) * 2n ** 971n, 1n), Number.MAX_VALUE);

  // Reference: exact rational of a double, and its neighbours.
  const view = new DataView(new ArrayBuffer(8));
  const fraction = (x: number): [bigint, bigint] => {
    view.setFloat64(0, x);
    const bits = view.getBigUint64(0);
    const e = Number((bits >> 52n) & 0x7ffn);
    let m = bits & ((1n << 52n) - 1n);
    if (e !== 0) m += 1n << 52n;
    const p = (e === 0 ? 1 : e) - 1075;
    return p >= 0 ? [m << BigInt(p), 1n] : [m, 1n << BigInt(-p)];
  };
  const step = (x: number, delta: bigint): number => {
    view.setFloat64(0, x);
    view.setBigUint64(0, view.getBigUint64(0) + delta);
    return view.getFloat64(0);
  };
  // |a/b - x| compared exactly against |a/b - y| (b > 0): sign of distance difference.
  const closer = (a: bigint, b: bigint, x: number, y: number): number => {
    const [xn, xd] = fraction(x);
    const [yn, yd] = fraction(y);
    const dx = a * xd - xn * b; // scaled by b*xd
    const dy = a * yd - yn * b; // scaled by b*yd
    const ax = (dx < 0n ? -dx : dx) * yd;
    const ay = (dy < 0n ? -dy : dy) * xd;
    return ax < ay ? -1 : ax > ay ? 1 : 0;
  };
  const isNearest = (a: bigint, b: bigint, r: number): boolean => {
    if (!(r > 0)) return false;
    const below = step(r, -1n);
    const above = step(r, 1n);
    const cb = closer(a, b, r, below);
    const ca = closer(a, b, r, above);
    if (cb > 0 || ca > 0) return false;
    view.setFloat64(0, r);
    const even = (view.getBigUint64(0) & 1n) === 0n;
    return (cb < 0 || even) && (ca < 0 || even);
  };
  const random = mulberry32(20261104);
  const bigOf = (bits: number): bigint => {
    let v = 0n;
    for (let i = 0; i < bits; i += 16) v = (v << 16n) | BigInt(Math.floor(random() * 65536));
    return (v >> BigInt(Math.max(0, Math.ceil(bits / 16) * 16 - bits))) | 1n;
  };
  let nearest = true;
  let signs = true;
  for (let i = 0; i < 3000; i += 1) {
    const a = bigOf(1 + Math.floor(random() * 200));
    const b = bigOf(1 + Math.floor(random() * 200));
    const r = exactRatio(a, b);
    if (!isNearest(a, b, r)) nearest = false;
    if (exactRatio(-a, b) !== -r || exactRatio(a, -b) !== -r || exactRatio(-a, -b) !== r) signs = false;
  }
  checkTrue("3,000 random BigInt pairs (up to 200 bits) are the exact nearest double", nearest);
  checkTrue("sign is symmetric for every sampled pair", signs);
  let midpoints = true;
  for (let i = 0; i < 1000; i += 1) {
    // a/b one part in b above/below an exact binary midpoint of a 53-bit significand.
    const m = (1n << 52n) | bigOf(52);
    const b = bigOf(1 + Math.floor(random() * 60)) + 2n;
    for (const nudge of [-1n, 0n, 1n]) {
      const a = (2n * m + 1n) * b + nudge;
      const r = exactRatio(a, 2n * b);
      if (!isNearest(a, 2n * b, r)) midpoints = false;
    }
  }
  checkTrue("1,000 directed midpoints (below/at/above) round correctly", midpoints);
}

section("refusals");
{
  throws("zero denominator", () => exactRatio(1n, 0n), "non-zero");
  throws("zero whole", () => moneyRatio(Money.fromRupees("1", INR), Money.zero(INR)), "non-zero");
  throws("mixed currencies", () => moneyRatio(Money.fromRupees("1", INR), Money.fromRupees("1", USD)), "one currency");
}

section("exact comparison of fractions");
{
  check("1/3 < 2/5", compareFractions(1n, 3n, 2n, 5n), -1);
  check("2/4 = 1/2", compareFractions(2n, 4n, 1n, 2n), 0);
  check("huge operands still exact", compareFractions(10n ** 30n + 1n, 10n ** 30n, 1n, 1n), 1);
  throws("non-positive denominator refused", () => compareFractions(1n, 0n, 1n, 1n), "positive");
}

done();
