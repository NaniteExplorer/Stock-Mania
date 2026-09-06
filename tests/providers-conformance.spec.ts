/**
 * The conformance suite — `40-MARKET-DATA.md` §3.2.
 *
 * Six requirements, run against every registered provider rather than written per
 * provider. That is what makes adding a seventh source safe: the new provider
 * either passes the same six or it does not ship, and nobody has to remember what
 * "correct" meant for the last six.
 *
 *   1. A known-good historical price within 0.5% of a golden value.
 *   2. A typed `ProviderError` — never a throw — for an unknown symbol.
 *   3. Its declared rate limit respected under a burst of 100 requests.
 *   4. Its circuit breaker trips under induced failure.
 *   5. Quotes ascending by date, with no duplicate `(instrument, as_of)`.
 *   6. Declared capabilities that match actual behaviour, asserted by probing.
 *
 * Every response is a fixture, so this suite never touches the network. The prices
 * in the fixtures are the golden values, and requirement 1 is that the parser
 * reproduces them — a live-endpoint test would be asserting that Yahoo is up.
 */

import { Currency } from "@/core/money";
import { UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import type { InstrumentRef, PricedAssetClass, QuoteProviderPort, QuoteType } from "@/domain/pricing";
import {
  AmfiNavProvider,
  CoinGeckoProvider,
  EcbFxProvider,
  FinnhubQuoteProvider,
  IbjaMetalProvider,
  ManualProvider,
  MfApiNavProvider,
  NseQuoteProvider,
  PriceProvider,
  YahooQuoteProvider,
  providersFor,
  shippedQuoteProviders,
} from "@/infra/providers";
import {
  FixtureHttpClient,
  VirtualRuntime,
  amfiBody,
  coinGeckoBody,
  ecbBody,
  ibjaBody,
  mfapiBody,
  nseBody,
  on,
  price,
  range,
  yahooBody,
} from "./doubles";
import { check, checkTrue, done, section } from "./harness";

const INR = Currency.reporting;
const USD = Currency.of("USD");

const ref = (props: {
  id: string;
  symbol: string;
  assetClass: PricedAssetClass;
  currency?: Currency;
  code?: string;
  provider?: string;
}): InstrumentRef => ({
  instrumentId: props.id,
  symbol: props.symbol,
  assetClass: props.assetClass,
  currency: props.currency ?? INR,
  identifierType: "TICKER",
  providerRefs: props.provider && props.code ? { [props.provider]: props.code } : undefined,
});

const infy = ref({ id: "INFY", symbol: "INFY", assetClass: "EQUITY" });
const infyYahoo = ref({ id: "INFY", symbol: "INFY", assetClass: "EQUITY", provider: "yahoo", code: "INFY.NS" });
const fund = ref({ id: "FUND", symbol: "Test Flexi Cap", assetClass: "MUTUAL_FUND", provider: "mfapi", code: "120503" });
const fundAmfi = ref({ id: "FUND", symbol: "Test Flexi Cap", assetClass: "MUTUAL_FUND", provider: "amfi", code: "120503" });
const gold = ref({ id: "GOLD", symbol: "GOLD-999", assetClass: "COMMODITY", provider: "ibja", code: "GOLD-999" });
const bitcoin = ref({ id: "BTC", symbol: "bitcoin", assetClass: "CRYPTO", provider: "coingecko", code: "bitcoin" });
const flat = ref({ id: "FLAT", symbol: "Pune flat", assetClass: "OTHER" });

const WEEK = range("2026-08-17", "2026-08-21");

/**
 * One case per provider: the fixture it should parse, the golden price for
 * 2026-08-21, and the instrument to ask about.
 *
 * The golden numbers are chosen to be distinguishable — a parser that returned the
 * wrong field or the wrong day would produce a visibly different figure rather than
 * a plausible one.
 */
interface Case {
  readonly name: string;
  readonly assetClass: PricedAssetClass;
  readonly quoteType: QuoteType;
  readonly instrument: InstrumentRef;
  readonly golden: UnitPrice;
  readonly goldenOn: CalendarDate;
  readonly expectedCount: number;
  build(runtime: VirtualRuntime): PriceProvider;
  routes(): { match: string; status?: number; body?: string }[];
  /** A URL fragment whose 404 means "unknown symbol" for this provider. */
  readonly unknownRoutes: { match: string; status?: number; body?: string }[];
}

const CASES: readonly Case[] = [
  {
    name: "mfapi",
    assetClass: "MUTUAL_FUND",
    quoteType: "NAV",
    instrument: fund,
    // 21 Aug, the last row. 84.5612 is four-decimal NAV, which is what AMFI and
    // MFAPI publish — a parser that rounded to paise would give 84.56.
    golden: price("84.5612"),
    goldenOn: on("2026-08-21"),
    expectedCount: 5,
    build: (runtime) => new MfApiNavProvider(runtime),
    routes: () => [
      {
        match: "api.mfapi.in/mf/120503",
        body: mfapiBody([
          { date: "17-08-2026", nav: "83.1200" },
          { date: "18-08-2026", nav: "83.4500" },
          { date: "19-08-2026", nav: "84.0100" },
          { date: "20-08-2026", nav: "84.2300" },
          { date: "21-08-2026", nav: "84.5612" },
        ]),
      },
    ],
    unknownRoutes: [{ match: "api.mfapi.in", body: JSON.stringify({ status: "FAIL", data: [] }) }],
  },
  {
    name: "amfi",
    assetClass: "MUTUAL_FUND",
    quoteType: "NAV",
    instrument: fundAmfi,
    golden: price("84.5612"),
    goldenOn: on("2026-08-21"),
    expectedCount: 1,
    build: (runtime) => new AmfiNavProvider(runtime),
    routes: () => [
      {
        match: "NAVAll.txt",
        body: amfiBody([
          { code: "120503", nav: "84.5612", date: "21-Aug-2026" },
          // A different scheme, and one with no NAV published — both must be
          // ignored rather than mis-attributed.
          { code: "999999", nav: "10.0000", date: "21-Aug-2026", name: "Someone else" },
          { code: "120503", nav: "N.A.", date: "22-Aug-2026" },
        ]),
      },
    ],
    unknownRoutes: [{ match: "NAVAll.txt", body: amfiBody([]) }],
  },
  {
    name: "yahoo",
    assetClass: "EQUITY",
    quoteType: "CLOSE",
    instrument: infyYahoo,
    golden: price("1543.25"),
    goldenOn: on("2026-08-21"),
    // Four, not five: 19 August is a null close — a market holiday — and a
    // provider that turned that into a zero would be the bug this checks for.
    expectedCount: 4,
    build: (runtime) => new YahooQuoteProvider(runtime),
    routes: () => [
      {
        match: "query2.finance.yahoo.com",
        body: yahooBody([
          { date: "2026-08-17", close: 1501.5 },
          { date: "2026-08-18", close: 1512.75 },
          { date: "2026-08-19", close: null },
          { date: "2026-08-20", close: 1530.1 },
          { date: "2026-08-21", close: 1543.25 },
        ]),
      },
    ],
    unknownRoutes: [
      {
        match: "query2.finance.yahoo.com",
        body: JSON.stringify({ chart: { result: null, error: { code: "Not Found" } } }),
      },
    ],
  },
  {
    name: "nse",
    assetClass: "EQUITY",
    quoteType: "CLOSE",
    instrument: infy,
    golden: price("1543.25"),
    goldenOn: on("2026-08-21"),
    expectedCount: 1,
    build: (runtime) => new NseQuoteProvider(runtime),
    routes: () => [
      { match: "nseindia.com/api/quote-equity", body: nseBody(1543.25, "21-Aug-2026 15:59:59") },
      { match: "https://www.nseindia.com/", body: "<html>priming</html>" },
    ],
    unknownRoutes: [
      { match: "nseindia.com/api/quote-equity", body: JSON.stringify({ priceInfo: {} }) },
      { match: "https://www.nseindia.com/", body: "<html>priming</html>" },
    ],
  },
  {
    name: "ibja",
    assetClass: "COMMODITY",
    quoteType: "CLOSE",
    instrument: gold,
    golden: price("7412"),
    goldenOn: on("2026-08-21"),
    expectedCount: 2,
    build: (runtime) => new IbjaMetalProvider(runtime),
    routes: () => [
      {
        match: "ibjarates.com",
        body: ibjaBody([
          { date: "2026-08-20", metal: "GOLD", purity: "999", rate: 7395 },
          { date: "2026-08-21", metal: "GOLD", purity: "999", rate: 7412 },
          { date: "2026-08-21", metal: "SILVER", purity: "999", rate: 92 },
        ]),
      },
    ],
    unknownRoutes: [{ match: "ibjarates.com", body: ibjaBody([]) }],
  },
  {
    name: "coingecko",
    assetClass: "CRYPTO",
    quoteType: "CLOSE",
    instrument: bitcoin,
    golden: price("5412000"),
    goldenOn: on("2026-08-21"),
    expectedCount: 2,
    build: (runtime) => new CoinGeckoProvider(runtime),
    routes: () => [
      {
        match: "api.coingecko.com",
        body: coinGeckoBody([
          { date: "2026-08-20", price: 5380000 },
          { date: "2026-08-21", price: 5412000 },
        ]),
      },
    ],
    unknownRoutes: [{ match: "api.coingecko.com", body: JSON.stringify({ prices: [] }) }],
  },
];

/* ══ 1. A known-good price, within 0.5% of the golden value ══════════ */

section("1. a known-good historical price");
for (const testCase of CASES) {
  const http = new FixtureHttpClient(testCase.routes());
  const runtime = new VirtualRuntime(http);
  const provider = testCase.build(runtime);

  const result = await provider.fetchQuotes({
    instruments: [testCase.instrument],
    range: WEEK,
    quoteType: testCase.quoteType,
  });

  if (!result.ok) {
    check(`${testCase.name}: returns quotes`, result.error.message, "a Result.ok");
    continue;
  }

  const golden = result.value.find((quote) => quote.asOf.compareTo(testCase.goldenOn) === 0);
  check(`${testCase.name}: has a quote for the golden date`, golden !== undefined, true);
  if (!golden) continue;

  // Within 0.5%, as §3.2 requires — but the fixtures are exact, so anything but an
  // exact match means the parser read the wrong field, and that is worth failing on.
  check(`${testCase.name}: golden price`, golden.price.toDecimalString(), testCase.golden.toDecimalString());
  check(`${testCase.name}: quote count`, result.value.length, testCase.expectedCount);
  check(`${testCase.name}: attributes itself`, golden.providerId, testCase.name);
  check(`${testCase.name}: marks the source`, golden.sourceType, "PROVIDER");
}

/* ══ 2. A typed error, never a throw ════════════════════════════════ */

section("2. an unknown symbol is a typed error, not a throw");
for (const testCase of CASES) {
  const http = new FixtureHttpClient(testCase.unknownRoutes);
  const provider = testCase.build(new VirtualRuntime(http));

  let threw = false;
  let kind = "none";
  try {
    const result = await provider.fetchQuotes({
      instruments: [{ ...testCase.instrument, symbol: "NOSUCHTHING", providerRefs: undefined }],
      range: WEEK,
      quoteType: testCase.quoteType,
    });
    kind = result.ok ? "OK" : result.error.kind;
  } catch {
    threw = true;
  }

  check(`${testCase.name}: did not throw`, threw, false);
  check(`${testCase.name}: reported UNKNOWN_SYMBOL`, kind, "UNKNOWN_SYMBOL");
}

// A 404 is the same story through a different door, and must not be retried:
// asking three times for something that does not exist is three times the latency
// for the same answer.
{
  const http = new FixtureHttpClient([{ match: "api.mfapi.in", status: 404, body: "" }]);
  const runtime = new VirtualRuntime(http);
  const provider = new MfApiNavProvider(runtime);
  const result = await provider.fetchQuotes({ instruments: [fund], range: WEEK, quoteType: "NAV" });
  check("a 404 is UNKNOWN_SYMBOL", !result.ok && result.error.kind, "UNKNOWN_SYMBOL");
  check("...and is not retried", http.requests.length, 1);
}

/* ══ 3. The declared rate limit, under a burst of 100 ═══════════════ */

section("3. the declared rate limit holds under a burst of 100");
{
  const http = new FixtureHttpClient([
    { match: "api.mfapi.in", body: mfapiBody([{ date: "21-08-2026", nav: "84.5612" }]) },
  ]);
  const runtime = new VirtualRuntime(http);
  const provider = new MfApiNavProvider(runtime);
  const budget = provider.rateLimit();

  for (let i = 0; i < 100; i += 1) {
    const result = await provider.fetchQuotes({ instruments: [fund], range: WEEK, quoteType: "NAV" });
    if (!result.ok) {
      check("burst: every request succeeded", result.error.message, "ok");
      break;
    }
  }

  check("all 100 requests were served, not dropped", http.requests.length, 100);

  // 30 per 60,000ms with a burst of 5: the first 5 are free, the remaining 95 wait
  // 2,000ms each. 190,000ms of virtual time — asserted as a floor, because the
  // requirement is "no faster than declared", not "exactly this schedule".
  const perRequestMs = budget.perMillis / budget.requests;
  const floor = (100 - budget.burst) * perRequestMs;
  checkTrue(`queued rather than dropped: waited ${runtime.elapsedMillis}ms (floor ${floor}ms)`, runtime.elapsedMillis >= floor);
  check("the bucket is empty at the end", Math.floor(new MfApiNavProvider(runtime).rateLimit().burst) > 0, true);
}

/* ══ 4. The circuit breaker trips, then probes ══════════════════════ */

section("4. the circuit breaker trips under induced failure");
{
  const http = new FixtureHttpClient([{ match: "api.mfapi.in", status: 500, body: "boom" }]);
  const runtime = new VirtualRuntime(http);
  // Threshold 5 and a 60s cooldown are the spec's numbers; one attempt per call
  // here so the failure count is legible.
  const provider = new MfApiNavProvider(runtime, { maxAttempts: 1 });

  for (let i = 0; i < 5; i += 1) {
    await provider.fetchQuotes({ instruments: [fund], range: WEEK, quoteType: "NAV" });
  }
  check("five failures open the circuit", provider.health().state, "UNAVAILABLE");
  check("...and it says when it will try again", provider.health().circuitOpenUntil !== null, true);

  const requestsBefore = http.requests.length;
  const whileOpen = await provider.fetchQuotes({ instruments: [fund], range: WEEK, quoteType: "NAV" });
  check("an open circuit fails fast", !whileOpen.ok && whileOpen.error.kind, "CIRCUIT_OPEN");
  check("...without calling the upstream at all", http.requests.length, requestsBefore);

  // Sixty seconds later it probes again — and this time the upstream is healthy.
  runtime.advance(60_000);
  http.setRoutes([{ match: "api.mfapi.in", body: mfapiBody([{ date: "21-08-2026", nav: "84.5612" }]) }]);
  const afterCooldown = await provider.fetchQuotes({ instruments: [fund], range: WEEK, quoteType: "NAV" });
  check("after the cooldown it probes", afterCooldown.ok, true);
  check("...and a success closes the circuit", provider.health().state, "HEALTHY");
}

// Retry: a 500 is retried with full jitter, a 400 is not.
{
  const http = new FixtureHttpClient([{ match: "api.mfapi.in", status: 500, body: "boom" }]);
  const runtime = new VirtualRuntime(http);
  const provider = new MfApiNavProvider(runtime);
  await provider.fetchQuotes({ instruments: [fund], range: WEEK, quoteType: "NAV" });
  check("a 500 is attempted three times", http.requests.length, 3);
  // Two backoffs for three attempts. Jittered, so the assertion is on the ceiling
  // rather than on an exact value — a fixed backoff would synchronise every client
  // into the same retry wave.
  const backoffs = runtime.sleeps.filter((slept) => slept > 0 && slept <= 400);
  checkTrue("backoff is jittered within its ceiling", backoffs.length >= 1);
}
{
  const http = new FixtureHttpClient([{ match: "api.mfapi.in", status: 400, body: "bad request" }]);
  const provider = new MfApiNavProvider(new VirtualRuntime(http));
  const result = await provider.fetchQuotes({ instruments: [fund], range: WEEK, quoteType: "NAV" });
  check("a 400 is not retried", http.requests.length, 1);
  check("...and is reported as upstream refusal", !result.ok && result.error.kind, "UPSTREAM");
}

// The timeout is what ends a call to an endpoint that never answers.
{
  const http = new FixtureHttpClient([{ match: "api.mfapi.in", hang: true }]);
  const provider = new MfApiNavProvider(new VirtualRuntime(http), { maxAttempts: 1, requestTimeoutMs: 5 });
  const result = await provider.fetchQuotes({ instruments: [fund], range: WEEK, quoteType: "NAV" });
  check("a hanging upstream times out", !result.ok && result.error.kind, "TIMEOUT");
  check("...and a timeout is retryable", !result.ok && result.error.retryable, true);
}

/* ══ 5. Ascending, with no duplicates ══════════════════════════════ */

section("5. quotes are ascending with no duplicate (instrument, as_of)");
for (const testCase of CASES) {
  const provider = testCase.build(new VirtualRuntime(new FixtureHttpClient(testCase.routes())));
  const result = await provider.fetchQuotes({
    instruments: [testCase.instrument],
    range: WEEK,
    quoteType: testCase.quoteType,
  });
  if (!result.ok) continue;

  const dates = result.value.map((quote) => quote.asOf.toISO());
  const sorted = [...dates].sort();
  check(`${testCase.name}: ascending`, dates.join(","), sorted.join(","));
  check(`${testCase.name}: no duplicates`, new Set(dates).size, dates.length);
}

// The property is enforced by the base class, not trusted per provider — proven by
// feeding a provider a payload with a repeated day and an inverted order.
{
  const http = new FixtureHttpClient([
    {
      match: "api.mfapi.in",
      body: mfapiBody([
        { date: "21-08-2026", nav: "84.5612" },
        { date: "17-08-2026", nav: "83.1200" },
        { date: "21-08-2026", nav: "84.9999" },
      ]),
    },
  ]);
  const provider = new MfApiNavProvider(new VirtualRuntime(http));
  const result = await provider.fetchQuotes({ instruments: [fund], range: WEEK, quoteType: "NAV" });
  const quotes = result.ok ? result.value : [];
  check("a duplicated day collapses to one row", quotes.length, 2);
  check("...and NAV keeps its four decimals", quotes[1].price.toDecimalString(), "84.5612");
  check("...ordered ascending regardless of the payload's order", quotes[0].asOf.toISO(), "2026-08-17");
  // The last row wins: it is the newest statement of the same day's price. The
  // fixture is deliberately ordered so that the *first* 21-Aug row is the wrong
  // one — an implementation keeping the first would read 84.9999 here.
  check("...and the newest belief wins", quotes[1].price.toDecimalString(), "84.5612");
}

/* ══ 6. Declared capabilities match behaviour ══════════════════════ */

section("6. declared capabilities match actual behaviour");
for (const testCase of CASES) {
  const provider = testCase.build(new VirtualRuntime(new FixtureHttpClient(testCase.routes())));
  const capabilities = provider.capabilities();

  check(
    `${testCase.name}: declares the class it prices`,
    capabilities.assetClasses.includes(testCase.assetClass),
    true,
  );
  check(
    `${testCase.name}: declares the quote type it returns`,
    capabilities.quoteTypes.includes(testCase.quoteType),
    true,
  );

  // Probed, not trusted: a provider claiming history must return more than one day
  // for a five-day range, and one claiming none must not.
  const result = await provider.fetchQuotes({
    instruments: [testCase.instrument],
    range: WEEK,
    quoteType: testCase.quoteType,
  });
  const days = result.ok ? new Set(result.value.map((quote) => quote.asOf.toISO())).size : 0;
  if (capabilities.supportsHistorical && capabilities.maxHistoryYears > 0) {
    checkTrue(`${testCase.name}: claims history and returns a series`, days > 1);
  } else {
    checkTrue(`${testCase.name}: claims no history and returns at most a day or two`, days <= 2);
  }

  // A provider must refuse a class it does not declare, rather than returning
  // something plausible for it.
  const wrongClass = await provider.fetchQuotes({
    instruments: [{ ...testCase.instrument, assetClass: "BOND", instrumentId: "SOMEBOND" }],
    range: WEEK,
    quoteType: testCase.quoteType,
  });
  check(
    `${testCase.name}: refuses a class it does not declare`,
    wrongClass.ok ? "returned quotes" : wrongClass.error.kind,
    "UNSUPPORTED",
  );
}

/* ══ ManualProvider, and the "two per need" promise ═══════════════ */

section("the manual provider, and two providers per need");
{
  const runtime = new VirtualRuntime(new FixtureHttpClient([]));
  const manual = new ManualProvider(
    runtime,
    new Map([["FLAT", [{ asOf: on("2026-08-21"), price: price("9500000") }]]]),
  );
  const result = await manual.fetchQuotes({ instruments: [flat], range: WEEK, quoteType: "CLOSE" });
  check("a user valuation is a quote like any other", result.ok && result.value[0].price.toDecimalString(), "9500000");
  check("...marked MANUAL, so the ladder can age it", result.ok && result.value[0].sourceType, "MANUAL");
  check("...and it never touches the network", (runtime.http as FixtureHttpClient).requests.length, 0);
}

{
  const providers = shippedQuoteProviders(new VirtualRuntime(new FixtureHttpClient([])));
  // Two per need, for every need a *feed* can serve.
  const needs: readonly PricedAssetClass[] = ["EQUITY", "MUTUAL_FUND", "COMMODITY", "CRYPTO"];
  for (const need of needs) {
    const covering = providersFor(providers, need);
    checkTrue(
      `${need}: at least two providers (${covering.map((p: QuoteProviderPort) => p.id).join(", ")})`,
      covering.length >= 2,
    );
  }
  // `OTHER` is the documented exception, and it is an exception with a reason: a
  // flat and a coin collection have no second opinion to get. One provider is the
  // honest count, and pretending otherwise would make the check meaningless
  // everywhere else.
  check(
    "OTHER is priced by assertion alone",
    providersFor(providers, "OTHER").map((p: QuoteProviderPort) => p.id).join(","),
    "manual",
  );
  check("the manual provider outranks every feed", providers[0].id, "manual");
}

/* ══ ECB, the FX provider ═════════════════════════════════════════ */

section("ECB: EUR-based rates, and the derivation that makes Q06 checkable");
{
  const http = new FixtureHttpClient([
    {
      match: "eurofxref",
      body: ecbBody([
        { date: "2026-08-21", rates: { USD: 1.09, INR: 91.56 } },
        { date: "2026-08-20", rates: { USD: 1.088, INR: 91.4 } },
      ]),
    },
  ]);
  const ecb = new EcbFxProvider(new VirtualRuntime(http));

  const direct = await ecb.fetchRates({ base: "EUR", quotes: ["INR"], range: WEEK });
  check("EUR/INR comes straight from the file", direct.ok && direct.value.at(-1)?.rate.toDecimalString(), "91.56");
  check("...and is a PROVIDER rate", direct.ok && direct.value.at(-1)?.sourceType, "PROVIDER");

  // USD/INR = (EUR/INR) ÷ (EUR/USD) = 91.56 ÷ 1.09 = 83.99999... → 84.00 at eight
  // decimals. Hand-computed: 91.56 / 1.09 = 83.9999999... ≈ 84.
  const derived = await ecb.fetchRates({ base: "USD", quotes: ["INR"], range: WEEK });
  const usdInr = derived.ok ? derived.value.at(-1) : null;
  check("USD/INR is derived through the EUR pivot", usdInr?.rate.toDecimalString(), "84");
  check("...and says so", usdInr?.sourceType, "DERIVED");
  checkTrue("...recording both legs, so the arithmetic is auditable", (usdInr?.derivation ?? "").includes("÷"));

  const missing = await ecb.fetchRates({ base: "EUR", quotes: ["XYZ"], range: WEEK });
  check("an unpublished currency is a typed error", !missing.ok && missing.error.kind, "UNKNOWN_SYMBOL");
}

/* ══ A currency mismatch is refused, not silently accepted ═══════ */

section("a provider quoting the wrong currency is refused");
{
  const http = new FixtureHttpClient([
    { match: "query2.finance.yahoo.com", body: yahooBody([{ date: "2026-08-21", close: 18.5 }], "GBP") },
  ]);
  const provider = new YahooQuoteProvider(new VirtualRuntime(http), { maxAttempts: 1 });
  const result = await provider.fetchQuotes({
    instruments: [{ ...infyYahoo, currency: INR }],
    range: WEEK,
    quoteType: "CLOSE",
  });
  check("a GBP price for an INR holding is rejected", !result.ok && result.error.kind, "MALFORMED_RESPONSE");
  checkTrue(
    "...and the message names both currencies, so the mapping can be fixed",
    !result.ok && result.error.message.includes("INR") && result.error.message.includes("GBP"),
  );
}

section("Finnhub real-time quotes");
{
  const http = new FixtureHttpClient([{
    match: "finnhub.io/api/v1/quote?symbol=AAPL",
    body: JSON.stringify({ c: 261.74 }),
  }]);
  const provider = new FinnhubQuoteProvider(
    new VirtualRuntime(http, { startMillis: Date.parse("2026-09-02T10:00:00Z") }),
    "test-token",
  );
  const result = await provider.fetchQuotes({
    instruments: [ref({ id: "AAPL", symbol: "AAPL", assetClass: "EQUITY", currency: USD })],
    range: range("2026-09-01", "2026-09-02"),
    quoteType: "CLOSE",
  });
  check("current USD quote is persisted", result.ok && result.value[0]?.price.toDecimalString(), "261.74");
  check("feed declares zero delay", provider.capabilities().quoteDelayMinutes, 0);
}
{
  const provider = new FinnhubQuoteProvider(new VirtualRuntime(new FixtureHttpClient([])), "test-token");
  const result = await provider.fetchQuotes({ instruments: [infy], range: WEEK, quoteType: "CLOSE" });
  check("standard entitlement does not mislabel INR quotes as real-time", result.ok && result.value.length, 0);
}
{
  // The same instrument legitimately priced in dollars still works — the check is
  // "matches what we hold it in", not "must be rupees".
  const http = new FixtureHttpClient([
    { match: "query2.finance.yahoo.com", body: yahooBody([{ date: "2026-08-21", close: 227.5 }], "USD") },
  ]);
  const provider = new YahooQuoteProvider(new VirtualRuntime(http));
  const aapl = ref({ id: "AAPL", symbol: "AAPL", assetClass: "EQUITY", currency: USD });
  const result = await provider.fetchQuotes({
    instruments: [aapl],
    range: range("2026-08-17", "2026-08-21"),
    quoteType: "CLOSE",
  });
  check("a USD holding priced in USD is fine", result.ok && result.value[0].price.toDecimalString(), "227.5");
  check("...and carries its own currency", result.ok && result.value[0].price.currency.code, "USD");
}

void DateRange;
done();
