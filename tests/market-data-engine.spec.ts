import { Err, Ok } from "@/core/kernel";
import { Currency } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import { type HealthStatus, ProviderError } from "@/domain/pricing";
import {
  MarketDataChain,
  assertUniformFxKind,
  runChain,
  spliceSeries,
} from "@/market-data/engine/chain";
import {
  DEFAULT_MARKET_DATA_CHAINS,
  InMemoryVendorPins,
  MarketDataRegistry,
} from "@/market-data/engine/registry";
import {
  type DailyBar,
  dailyBar,
  type FxRate,
  type FxRateKind,
  type FxRatePort,
  type FxRateRequest,
  type HistoricalSeries,
  type HistoricalSeriesPort,
  type HistoryRequest,
  type LiveQuote,
  type LiveQuotePort,
  type LiveQuoteRequest,
  type MarketDataResult,
  type MarketDataSourceInfo,
  scaledFromDecimal,
} from "@/market-data/ports";
import { check, checkDeep, checkTrue, done, section, throws } from "./harness";

/**
 * The market-data engine: registry, chain and the two refusals.
 *
 * **No network anywhere in this file.** Every adapter below is a fake that answers
 * from a literal, which is the only way to test "what happens when Yahoo is down"
 * without waiting for Yahoo to be down. The real adapters' parsing is a separate
 * concern; what is under test here is the routing and the refusals, and those are
 * the parts that are wrong silently rather than loudly.
 */

const INR = Currency.of("INR");
const USD = Currency.of("USD");
const DAY = (iso: string) => CalendarDate.parse(iso);
const WEEK = DateRange.of(DAY("2026-09-01"), DAY("2026-09-07"));

const HEALTHY: HealthStatus = {
  state: "HEALTHY",
  consecutiveFailures: 0,
  lastError: null,
  circuitOpenUntil: null,
};
const DEAD: HealthStatus = {
  state: "UNAVAILABLE",
  consecutiveFailures: 5,
  lastError: "down",
  circuitOpenUntil: new Date("2026-09-13T00:00:00Z"),
};

function info(
  id: string,
  capabilities: MarketDataSourceInfo["capabilities"],
): MarketDataSourceInfo {
  return { id, displayName: id, capabilities, markets: ["GLOBAL", "IN", "US"], keyless: true };
}

function bar(iso: string, price: string): DailyBar {
  const scaled = scaledFromDecimal(price);
  return dailyBar("fake", {
    asOf: DAY(iso),
    openScaled: scaled,
    highScaled: scaled,
    lowScaled: scaled,
    closeScaled: scaled,
    volume: null,
  });
}

/* ── Fakes ──────────────────────────────────────────────────────────── */

class FakeHistory implements HistoricalSeriesPort {
  readonly info: MarketDataSourceInfo;
  calls = 0;

  constructor(
    id: string,
    private readonly behaviour:
      | { kind: "series"; adjusted: boolean; bars: readonly DailyBar[] }
      | { kind: "fail"; error: ProviderError },
    private readonly state: HealthStatus = HEALTHY,
  ) {
    this.info = info(id, ["HISTORY"]);
  }

  health(): HealthStatus {
    return this.state;
  }

  async history(request: HistoryRequest): Promise<MarketDataResult<HistoricalSeries>> {
    this.calls += 1;
    if (this.behaviour.kind === "fail") return Err(this.behaviour.error);
    return Ok({
      quoteKey: request.quoteKey,
      currency: request.currency,
      adjusted: this.behaviour.adjusted,
      asOf: this.behaviour.bars[this.behaviour.bars.length - 1].asOf,
      bars: this.behaviour.bars,
      sourceId: this.info.id,
    });
  }
}

class FakeQuote implements LiveQuotePort {
  readonly info: MarketDataSourceInfo;
  calls = 0;

  constructor(
    id: string,
    private readonly price: string | null,
    private readonly state: HealthStatus = HEALTHY,
  ) {
    this.info = info(id, ["QUOTE"]);
  }

  health(): HealthStatus {
    return this.state;
  }

  async quote(request: LiveQuoteRequest): Promise<MarketDataResult<readonly LiveQuote[]>> {
    this.calls += 1;
    if (this.price === null) {
      return Err(new ProviderError("UPSTREAM", this.info.id, `${this.info.id} is broken.`, true));
    }
    return Ok(
      request.subjects.map((subject) => ({
        quoteKey: subject.quoteKey,
        priceScaled: scaledFromDecimal(this.price!),
        currency: subject.currency,
        asOf: DAY("2026-09-07"),
        observedAt: new Date("2026-09-07T10:00:00Z"),
        stale: false,
        sourceId: this.info.id,
      })),
    );
  }
}

class FakeFx implements FxRatePort {
  readonly info: MarketDataSourceInfo;

  constructor(
    id: string,
    readonly rateKind: FxRateKind,
    private readonly rate_: string | null,
    /** What the source says it actually served, whatever was asked for. */
    private readonly servesDate: string | null = null,
  ) {
    this.info = info(id, ["FX"]);
  }

  health(): HealthStatus {
    return HEALTHY;
  }

  async rate(request: FxRateRequest): Promise<MarketDataResult<FxRate>> {
    if (this.rate_ === null) {
      return Err(new ProviderError("UPSTREAM", this.info.id, `${this.info.id} is down.`, true));
    }
    const effectiveDate = DAY(this.servesDate ?? request.on.toISO());
    return Ok({
      base: request.base,
      quote: request.quote,
      rateScaled: scaledFromDecimal(this.rate_),
      requestedDate: request.on,
      effectiveDate,
      clamped: effectiveDate.toISO() !== request.on.toISO(),
      kind: this.rateKind,
      sourceId: this.info.id,
    });
  }
}

/* ── Integer money, by construction ─────────────────────────────────── */

section("prices are exact integers, never floats");

check("a decimal string parses to 1e8 scale", scaledFromDecimal("2924.35"), 292_435_000_000n);
check(
  "the penny that parseFloat loses survives",
  scaledFromDecimal("1234.56") - scaledFromDecimal("1234.55"),
  1_000_000n,
);
check("eight decimal places are kept", scaledFromDecimal("0.00000001"), 1n);

section("an impossible bar cannot be constructed");

throws(
  "high below low is rejected at construction, not validated later",
  () =>
    dailyBar("fake", {
      asOf: DAY("2026-09-01"),
      openScaled: 100n,
      highScaled: 90n,
      lowScaled: 95n,
      closeScaled: 96n,
    }),
  "is below low",
);
throws(
  "a close outside the day's range is rejected",
  () =>
    dailyBar("fake", {
      asOf: DAY("2026-09-01"),
      openScaled: 100n,
      highScaled: 110n,
      lowScaled: 90n,
      closeScaled: 120n,
    }),
  "outside the day",
);
throws(
  "a non-positive low is rejected",
  () =>
    dailyBar("fake", {
      asOf: DAY("2026-09-01"),
      openScaled: 0n,
      highScaled: 0n,
      lowScaled: 0n,
      closeScaled: 0n,
    }),
  "not positive",
);

/* ── Registry ───────────────────────────────────────────────────────── */

section("the registry rejects a mis-wired chain when it is built");

throws(
  "a chain naming an unregistered adapter fails at construction",
  () => new MarketDataRegistry([], { HISTORY: { IN: ["nope"] } }),
  "not registered",
);
throws(
  "a chain naming an adapter of the wrong capability fails at construction",
  () =>
    new MarketDataRegistry([new FakeQuote("q", "1")], { HISTORY: { IN: ["q"] } }),
  "which serves QUOTE",
);
throws(
  "two adapters cannot claim one id",
  () => new MarketDataRegistry([new FakeQuote("dup", "1"), new FakeQuote("dup", "2")], {}),
  "claim the id",
);

section("the shipped chain is the documented one");

{
  // Every id the shipped HISTORY chain names, stood up as a fake: the registry
  // validates the real constant, so a typo in it fails here rather than in prod.
  const shipped = ["yahoo-chart", "nse-bhavcopy-history", "bse-bhavcopy-history", "nasdaq-chart-history"].map(
    (id) => new FakeHistory(id, { kind: "series", adjusted: true, bars: [bar("2026-09-01", "10")] }),
  );
  const registry = new MarketDataRegistry(shipped, {
    HISTORY: DEFAULT_MARKET_DATA_CHAINS.HISTORY,
  });
  checkDeep(
    "IN history is Yahoo first, then the exchange archives",
    registry.historyChain("IN").map((a) => a.info.id),
    ["yahoo-chart", "nse-bhavcopy-history", "bse-bhavcopy-history"],
  );
  checkTrue(
    "describe() renders the chain a reader can check",
    registry.describe().some((line) => line.startsWith("HISTORY IN: yahoo-chart -> nse-bhavcopy-history")),
  );
}

/* ── Failover ───────────────────────────────────────────────────────── */

section("failover: the next source answers when the first fails");

{
  const dead = new FakeHistory("dead", {
    kind: "fail",
    error: new ProviderError("UPSTREAM", "dead", "boom", true),
  });
  const alive = new FakeHistory("alive", {
    kind: "series",
    adjusted: true,
    bars: [bar("2026-09-01", "100"), bar("2026-09-02", "101")],
  });
  const chain = new MarketDataChain(
    new MarketDataRegistry([dead, alive], { HISTORY: { IN: ["dead", "alive"] } }),
  );

  const result = await chain.history({
    quoteKey: "RELIANCE.NS",
    currency: INR,
    market: "IN",
    range: WEEK,
    adjusted: true,
  });
  checkTrue("the chain succeeded", result.ok);
  if (result.ok) {
    check("the fallback answered", result.value.resolvedBy, "alive");
    check("the failure was recorded, not swallowed", result.value.attempts.length, 1);
    check("and it names the source that failed", result.value.attempts[0].sourceId, "dead");
  }
  check("the dead source was actually tried", dead.calls, 1);
}

section("a source whose circuit is open is skipped without being called");

{
  const open = new FakeHistory(
    "open-circuit",
    { kind: "series", adjusted: true, bars: [bar("2026-09-01", "1")] },
    DEAD,
  );
  const alive = new FakeHistory("alive", {
    kind: "series",
    adjusted: true,
    bars: [bar("2026-09-01", "100")],
  });
  const chain = new MarketDataChain(
    new MarketDataRegistry([open, alive], { HISTORY: { IN: ["open-circuit", "alive"] } }),
  );

  const result = await chain.history({
    quoteKey: "X.NS",
    currency: INR,
    market: "IN",
    range: WEEK,
    adjusted: true,
  });
  checkTrue("the chain still answered", result.ok);
  check(
    "the open-circuit source was never called — that is the point of the breaker",
    open.calls,
    0,
  );
  if (result.ok) check("the healthy source answered", result.value.resolvedBy, "alive");
}

section("when every source fails, the error names all of them");

{
  const a = new FakeHistory("a", { kind: "fail", error: new ProviderError("UPSTREAM", "a", "a-down", true) });
  const b = new FakeHistory("b", { kind: "fail", error: new ProviderError("UPSTREAM", "b", "b-down", true) });
  const chain = new MarketDataChain(new MarketDataRegistry([a, b], { HISTORY: { IN: ["a", "b"] } }));
  const result = await chain.history({
    quoteKey: "X.NS",
    currency: INR,
    market: "IN",
    range: WEEK,
    adjusted: true,
  });
  checkTrue("it failed", !result.ok);
  if (!result.ok) {
    checkTrue("a-down is in the message", result.error.message.includes("a-down"));
    checkTrue("b-down is in the message", result.error.message.includes("b-down"));
  }
}

section("an empty chain is UNSUPPORTED, not a mysterious upstream error");

{
  const outcome = await runChain("nothing", [], async () => Ok(1));
  checkTrue("it failed", !outcome.ok);
  if (!outcome.ok) check("with the right kind", outcome.error.kind, "UNSUPPORTED");
}

/* ── Vendor pinning ─────────────────────────────────────────────────── */

section("a vendor pin puts the adapter that worked last time first");

{
  const primary = new FakeQuote("primary", "100");
  const pinned = new FakeQuote("pinned", "200");
  const pins = new InMemoryVendorPins();
  const registry = new MarketDataRegistry(
    [primary, pinned],
    { QUOTE: { IN: ["primary", "pinned"] } },
    pins,
  );
  const chain = new MarketDataChain(registry, pins);
  const subject = { quoteKey: "RELIANCE.NS", currency: INR, market: "IN" as const };

  const before = await chain.quote("IN", { subjects: [subject] });
  if (before.ok) check("unpinned, the configured order wins", before.value.resolvedBy, "primary");

  pins.pin("QUOTE", "RELIANCE.NS", "pinned");
  const after = await chain.quote("IN", { subjects: [subject] });
  if (after.ok) {
    check("pinned, the pin wins", after.value.resolvedBy, "pinned");
    check("and the pinned price is the one returned", after.value.value[0].priceScaled, 20_000_000_000n);
  }
  checkDeep(
    "the pin reorders rather than truncates the chain",
    registry.quoteChain("IN", "RELIANCE.NS").map((a) => a.info.id),
    ["pinned", "primary"],
  );
  checkDeep(
    "and the pin is per instrument, not global",
    registry.quoteChain("IN", "INFY.NS").map((a) => a.info.id),
    ["primary", "pinned"],
  );
}

/* ── The adjusted/unadjusted refusal ────────────────────────────────── */

section("adjusted and unadjusted series are never spliced (C3)");

{
  const adjusted: HistoricalSeries = {
    quoteKey: "NVDA",
    currency: USD,
    adjusted: true,
    asOf: DAY("2026-09-02"),
    bars: [bar("2026-09-01", "100"), bar("2026-09-02", "101")],
    sourceId: "yahoo-chart",
  };
  const unadjusted: HistoricalSeries = {
    ...adjusted,
    adjusted: false,
    bars: [bar("2026-09-03", "4000")],
    sourceId: "nse-bhavcopy-history",
  };

  const refused = spliceSeries([adjusted, unadjusted]);
  checkTrue("the splice is refused", !refused.ok);
  if (!refused.ok) {
    checkTrue(
      "and the message names both sources",
      refused.error.message.includes("yahoo-chart") &&
        refused.error.message.includes("nse-bhavcopy-history"),
    );
  }

  const same = spliceSeries([adjusted, { ...adjusted, bars: [bar("2026-09-03", "102")] }]);
  checkTrue("two same-adjusted parts splice fine", same.ok);
  if (same.ok) {
    check("all three days are present", same.value.bars.length, 3);
    check("ascending by date", same.value.bars[0].asOf.toISO(), "2026-09-01");
    check("asOf is the last bar", same.value.asOf.toISO(), "2026-09-03");
  }

  const currencies = spliceSeries([adjusted, { ...adjusted, currency: INR, sourceId: "other" }]);
  checkTrue("mixed currencies are refused too", !currencies.ok);
}

section("the chain refuses a series whose adjustment is not what was asked for");

{
  const archive = new FakeHistory("archive", {
    kind: "series",
    adjusted: false,
    bars: [bar("2026-09-01", "100")],
  });
  const chain = new MarketDataChain(
    new MarketDataRegistry([archive], { HISTORY: { IN: ["archive"] } }),
  );

  const asked = await chain.history({
    quoteKey: "RELIANCE.NS",
    currency: INR,
    market: "IN",
    range: WEEK,
    adjusted: true,
  });
  checkTrue("an adjusted request served by an unadjusted source is refused", !asked.ok);
  if (!asked.ok) check("and it is UNSUPPORTED, not UPSTREAM", asked.error.kind, "UNSUPPORTED");

  const honest = await chain.history({
    quoteKey: "RELIANCE.NS",
    currency: INR,
    market: "IN",
    range: WEEK,
    adjusted: false,
  });
  checkTrue("asking for what the source has works", honest.ok);
  if (honest.ok) check("and the flag is carried through", honest.value.value.adjusted, false);
}

/* ── FX ─────────────────────────────────────────────────────────────── */

section("FX: effectiveDate is what the source served, not what was asked for");

{
  // Frankfurter's real behaviour: a pre-2000-01-13 request comes back 200 with
  // the 2000-01-13 rate and no warning.
  const clamping = new FakeFx("frankfurter", "ECB_REFERENCE", "43.50", "2000-01-13");
  const chain = new MarketDataChain(
    new MarketDataRegistry([clamping], { FX: { GLOBAL: ["frankfurter"] } }),
  );

  const result = await chain.fx({ base: USD, quote: INR, on: DAY("1995-06-01") });
  checkTrue("it answered", result.ok);
  if (result.ok) {
    const rate = result.value.value;
    check("requestedDate is what we asked", rate.requestedDate.toISO(), "1995-06-01");
    check("effectiveDate is what it served", rate.effectiveDate.toISO(), "2000-01-13");
    checkTrue("and the clamp is visible rather than silent", rate.clamped);
  }
}

section("FX rate kinds are never mixed inside one history (C12)");

{
  const mixed = assertUniformFxKind([
    {
      base: USD,
      quote: INR,
      rateScaled: scaledFromDecimal("88.10"),
      requestedDate: DAY("2026-09-01"),
      effectiveDate: DAY("2026-09-01"),
      clamped: false,
      kind: "ECB_REFERENCE",
      sourceId: "frankfurter",
    },
    {
      base: USD,
      quote: INR,
      rateScaled: scaledFromDecimal("88.26"),
      requestedDate: DAY("2026-09-02"),
      effectiveDate: DAY("2026-09-02"),
      clamped: false,
      kind: "INDICATIVE_LIVE",
      sourceId: "exchangerate-dev",
    },
  ]);
  checkTrue("a mixture is refused", !mixed.ok);
  if (!mixed.ok) {
    checkTrue(
      "and the message names both kinds",
      mixed.error.message.includes("ECB_REFERENCE") && mixed.error.message.includes("INDICATIVE_LIVE"),
    );
  }
}

section("fxSeries fails over per series, never per date");

{
  const down = new FakeFx("frankfurter", "ECB_REFERENCE", null);
  const backup = new FakeFx("exchangerate-dev", "INDICATIVE_LIVE", "88.26");
  const chain = new MarketDataChain(
    new MarketDataRegistry([down, backup], { FX: { GLOBAL: ["frankfurter", "exchangerate-dev"] } }),
  );

  const dates = ["2026-09-01", "2026-09-02", "2026-09-03"].map((iso) => ({
    base: USD,
    quote: INR,
    on: DAY(iso),
  }));
  const result = await chain.fxSeries(dates);
  checkTrue("the whole series came from the backup", result.ok);
  if (result.ok) {
    check("one source for every date", result.value.resolvedBy, "exchangerate-dev");
    check("every date is present", result.value.value.length, 3);
    check(
      "and every rate is the same kind",
      new Set(result.value.value.map((rate) => rate.kind)).size,
      1,
    );
  }
}

section("a quote failover keeps the price of whoever answered");

{
  const broken = new FakeQuote("yahoo-chart", null);
  const backup = new FakeQuote("moneycontrol-quote", "1499.95");
  const chain = new MarketDataChain(
    new MarketDataRegistry([broken, backup], {
      QUOTE: { IN: ["yahoo-chart", "moneycontrol-quote"] },
    }),
  );
  const result = await chain.quote("IN", {
    subjects: [{ quoteKey: "RELIANCE.NS", currency: INR, market: "IN" }],
  });
  checkTrue("it answered", result.ok);
  if (result.ok) {
    check("from the failover", result.value.resolvedBy, "moneycontrol-quote");
    check(
      "with the exact integer price, to the paisa",
      result.value.value[0].priceScaled,
      149_995_000_000n,
    );
  }
}

done();
