/**
 * The test harness.
 *
 * `scripts/run-tests.mjs` bundles each `tests/*.spec.ts` with esbuild and runs it
 * as a plain Node script, so there is no framework and no `describe`/`it`. This
 * module supplies what the specs were each redefining locally, plus property
 * testing, which is what actually catches money bugs — examples only catch the
 * ones you thought of.
 *
 * Not a `*.spec.ts`, so the runner never picks it up as a spec.
 *
 * Failure counting lives here rather than in each spec: `done()` at the end of a
 * spec sets the exit code, so a spec cannot forget to fail the build.
 */

let failures = 0;
let assertions = 0;

/** Compared by `String()`, deliberately: it makes bigint, Money and Date all printable and comparable without per-type overloads. */
export function check(label: string, actual: unknown, expected: unknown): void {
  assertions++;
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`,
  );
}

/** For arrays and plain objects, where `String()` would flatten too much. */
export function checkDeep(label: string, actual: unknown, expected: unknown): void {
  assertions++;
  const ok = json(actual) === json(expected);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n      actual   ${json(actual)}\n      expected ${json(expected)}`}`,
  );
}

export function checkTrue(label: string, actual: boolean): void {
  check(label, actual, true);
}

/** Asserts `fn` throws, and that the message carries `fragment`. */
export function throws(label: string, fn: () => unknown, fragment: string): void {
  assertions++;
  try {
    fn();
    failures++;
    console.log(`FAIL  ${label}: no throw`);
  } catch (e) {
    const msg = (e as Error).message;
    const ok = msg.includes(fragment);
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${label}: ${(e as Error).name}${ok ? "" : ` — got "${msg}"`}`,
    );
  }
}

export async function throwsAsync(
  label: string,
  fn: () => Promise<unknown>,
  fragment: string,
): Promise<void> {
  assertions++;
  try {
    await fn();
    failures++;
    console.log(`FAIL  ${label}: no throw`);
  } catch (e) {
    const msg = (e as Error).message;
    const ok = msg.includes(fragment);
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}: ${(e as Error).name}`);
  }
}

export function section(label: string): void {
  console.log(`-- ${label} --`);
}

/** Ends a spec: prints the tally and sets the exit code. */
export function done(): never {
  console.log(
    failures === 0
      ? `\nALL PASS (${assertions} assertions)`
      : `\n${failures} FAILURE(S) of ${assertions} assertions`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

/**
 * Runs `fn` with the pass/fail counters isolated, and reports what it recorded
 * without affecting the spec's own tally.
 *
 * This exists for one purpose: letting a spec assert that the harness actually
 * fails when it should. A property runner that silently passes everything is
 * worse than none, and that failure mode is invisible by construction — every
 * test goes green.
 */
export function isolate(fn: () => void): { failures: number; assertions: number } {
  const beforeF = failures;
  const beforeA = assertions;
  const realLog = console.log;
  console.log = () => {};
  try {
    fn();
  } finally {
    console.log = realLog;
  }
  const observed = { failures: failures - beforeF, assertions: assertions - beforeA };
  failures = beforeF;
  assertions = beforeA;
  return observed;
}

/* ═══ Property testing ═══════════════════════════════════════════════ */

/**
 * A deterministic PRNG. Reproducibility is the whole point: a property failure
 * that cannot be replayed is a rumour, not a bug report.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;
export type Gen<T> = (rng: Rng) => T;

/** `JSON.stringify` throws on a bigint, and every generated value here contains one. */
function json(value: unknown): string {
  return JSON.stringify(
    value,
    (_k, v) => (typeof v === "bigint" ? `${v}n` : v),
    0,
  );
}

const DEFAULT_SEED = Number(process.env.SEED ?? 0xc0ffee);

/**
 * Runs `predicate` over `runs` generated values.
 *
 * Run `i` draws from `mulberry32(seed + i)`, so a failure names the exact seed
 * and index to replay — `SEED=<n> npm test <spec>` reproduces it byte for byte.
 * The seed is printed on every property, passing or failing, so a CI log is
 * always enough to reproduce.
 *
 * No shrinking. A seeded replay plus the printed counterexample is most of the
 * value for a fraction of the machinery; if a counterexample is ever too large
 * to read, narrow the generator rather than building a shrinker.
 */
export function assertProperty<T>(
  name: string,
  gen: Gen<T>,
  predicate: (value: T) => boolean,
  runs = 1000,
  options: { seed?: number; show?: (value: T) => string } = {},
): void {
  assertions++;
  const seed = options.seed ?? DEFAULT_SEED;
  const show = options.show ?? json;

  for (let i = 0; i < runs; i++) {
    const value = gen(mulberry32(seed + i));
    let held: boolean;
    try {
      held = predicate(value);
    } catch (e) {
      failures++;
      console.log(
        `FAIL  ${name}: threw on run ${i} (seed ${seed})\n      value ${show(value)}\n      ${(e as Error).name}: ${(e as Error).message}`,
      );
      return;
    }
    if (!held) {
      failures++;
      console.log(
        `FAIL  ${name}: falsified on run ${i} (seed ${seed})\n      value ${show(value)}\n      replay with SEED=${seed}`,
      );
      return;
    }
  }
  console.log(`PASS  ${name}: ${runs} runs (seed ${seed})`);
}

/* ═══ Generators ═════════════════════════════════════════════════════ */

/** An integer in `[min, max]`, inclusive. */
export const genInt = (min: number, max: number): Gen<number> =>
  (rng) => min + Math.floor(rng() * (max - min + 1));

export const genBigInt = (min: bigint, max: bigint): Gen<bigint> => (rng) => {
  const span = max - min + 1n;
  // Two draws, so the range can exceed 2^32 without losing uniformity badly.
  const r = BigInt(Math.floor(rng() * 0x100000000)) * 0x100000000n
    + BigInt(Math.floor(rng() * 0x100000000));
  return min + (r % span);
};

/** Biased toward the values that break things: 0, ±1, and the extremes. */
export const genMinor = (bound = 10n ** 12n): Gen<bigint> => (rng) => {
  const pick = rng();
  if (pick < 0.05) return 0n;
  if (pick < 0.1) return 1n;
  if (pick < 0.15) return -1n;
  if (pick < 0.2) return bound;
  if (pick < 0.25) return -bound;
  return genBigInt(-bound, bound)(rng);
};

export const genOneOf = <T>(items: readonly T[]): Gen<T> =>
  (rng) => items[Math.floor(rng() * items.length)];

export const genArray = <T>(item: Gen<T>, minLen: number, maxLen: number): Gen<T[]> =>
  (rng) => {
    const n = minLen + Math.floor(rng() * (maxLen - minLen + 1));
    return Array.from({ length: n }, () => item(rng));
  };

/**
 * Weight vectors for `Money.allocate`, biased to the shapes that expose remainder
 * bugs: all-equal (the classic 100/3), one dominant, and many zeros.
 */
export const genWeights = (maxLen = 12): Gen<number[]> => (rng) => {
  const n = 1 + Math.floor(rng() * maxLen);
  const shape = rng();
  if (shape < 0.25) return Array.from({ length: n }, () => 1);
  if (shape < 0.4) {
    const w: number[] = Array.from({ length: n }, () => 0);
    w[Math.floor(rng() * n)] = 1;
    return w;
  }
  const w: number[] = Array.from({ length: n }, () =>
    rng() < 0.3 ? 0 : Math.floor(rng() * 1_000_000),
  );
  // `some(x => x !== 0)` rather than `every(x => x === 0)`: TypeScript infers a
  // type predicate from the latter and narrows `w` to `0[]`, which then rejects
  // the assignment below. `allocate` rejects an all-zero weight vector.
  if (!w.some((x) => x !== 0)) w[0] = 1;
  return w;
};
