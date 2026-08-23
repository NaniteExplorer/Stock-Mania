/**
 * `PriceBook`, `FxBook`, and the invariants that keep a valuation honest.
 *
 * The four claims under test are the four that decide whether a portfolio screen
 * can be trusted:
 *
 *   1. **A missing price is `null` with a reason, never zero.** A zero is a number
 *      someone will act on.
 *   2. **The ladder ages a price rather than hiding its age**: exact → carried
 *      forward → stale → unavailable.
 *   3. **Two providers that disagree both survive**, the golden record is chosen by
 *      priority, and the disagreement is recorded.
 *   4. **A user-asserted FX rate beats the vendor's**, because it is the rate their
 *      return is assessed on.
 *
 * Every expected number is hand-computed in the comment above it.
 */

import { FixedClock, UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage, Quantity, UnitPrice } from "@/core/numeric";
import {
  FxBook,
  InstrumentRef,
  PriceBook,
  Quote,
  QuoteValidator,
  STALENESS_DAYS,
} from "@/domain/pricing";
import { EcbFxProvider, MfApiNavProvider, YahooQuoteProvider } from "@/infra/providers";
import {
  FixtureHttpClient,
  InMemoryFxRateRepository,
  InMemoryQuoteRepository,
  VirtualRuntime,
  ecbBody,
  mfapiBody,
  on,
  price,
  range,
  units,
  yahooBody,
} from "./doubles";
import { check, checkTrue, done, section, throws } from "./harness";

const INR = Currency.reporting;
const USD = Currency.of("USD");
const userId = UserId.from("user_pricing_1");
const clock = new FixedClock(new Date("2026-08-24T04:00:00Z"));

const infy: InstrumentRef = {
  instrumentId: "INFY",
  symbol: "INFY",
  assetClass: "EQUITY",
  currency: INR,
  identifierType: "TICKER",
  providerRefs: { yahoo: "INFY.NS" },
};

const btc: InstrumentRef = {
  instrumentId: "BTC",
  symbol: "bitcoin",
  assetClass: "CRYPTO",
  currency: INR,
  identifierType: "COIN",
};

const flat: InstrumentRef = {
  instrumentId: "FLAT",
  symbol: "Pune flat",
  assetClass: "OTHER",
  currency: INR,
  identifierType: "TICKER",
};

const quote = (props: {
  instrumentId?: string;
  asOf: string;
  price: string;
  providerId: string;
  ingestedAt?: string;
  supersededBy?: string;
}): Quote => ({
  instrumentId: props.instrumentId ?? "INFY",
  asOf: on(props.asOf),
  quoteType: "CLOSE",
  price: price(props.price),
  providerId: props.providerId,
  sourceType: "PROVIDER",
  ingestedAt: new Date(props.ingestedAt ?? `${props.asOf}T12:00:00Z`),
  supersededBy: props.supersededBy ?? null,
});

/* ══ 1. Missing is not zero ══════════════════════════════════════════ */

section("a missing price is null with a reason, never zero");
{
  const repository = new InMemoryQuoteRepository();
  const book = new PriceBook([], repository);

  const resolution = await book.priceOn(infy, on("2026-08-21"));
  check("rung", resolution.rung, "UNAVAILABLE");
  check("price is null, not zero", resolution.price, null);
  checkTrue("...and says why, in words a UI can show", (resolution.reason ?? "").includes("rather than as zero"));

  // The null propagates: a holding that cannot be priced makes the total unknown,
  // and a total that silently omits it is worse than one that admits the gap.
  const valued = await book.valueOn(infy, units("100"), on("2026-08-21"));
  check("a value built on a missing price is also null", valued.value, null);
}

/* ══ 2. The four-rung ladder ═════════════════════════════════════════ */

section("the ladder: exact, carried forward, stale, unavailable");
{
  const repository = new InMemoryQuoteRepository();
  // Friday's close. Everything below asks about a later day.
  await repository.append([quote({ asOf: "2026-08-21", price: "1543.25", providerId: "nse" })]);
  const book = new PriceBook([], repository);

  const exact = await book.priceOn(infy, on("2026-08-21"));
  check("rung 1: the date itself", exact.rung, "EXACT");
  check("price", exact.price?.toDecimalString(), "1543.25");
  check("age", exact.ageDays, 0);
  check("no explanation needed", exact.reason, null);

  // Monday: Friday's close carried forward, three days for equity — inside the
  // four-day threshold, so usable and dated.
  const monday = await book.priceOn(infy, on("2026-08-24"));
  check("rung 2: carried forward", monday.rung, "CARRIED_FORWARD");
  check("age is 3 days", monday.ageDays, 3);
  check("...and not stale yet", monday.isStale, false);
  check("the source is marked as carried, not as the provider's own", monday.sourceType, "CARRIED_FORWARD");
  check("the price is still Friday's", monday.price?.toDecimalString(), "1543.25");
  check("it reports the date it actually came from", monday.pricedOn?.toISO(), "2026-08-21");

  // Six days later is past the four-day equity threshold.
  const stale = await book.priceOn(infy, on("2026-08-27"));
  check("rung 3: stale", stale.rung, "STALE");
  check("age is 6 days", stale.ageDays, 6);
  check("...and it says so", stale.isStale, true);
  checkTrue("the reason names the limit", (stale.reason ?? "").includes("4-day limit"));
  check("but the price is still returned, not withheld", stale.price?.toDecimalString(), "1543.25");

  // Before any quote exists there is nothing to carry forward.
  const before = await book.priceOn(infy, on("2026-08-20"));
  check("rung 4: nothing to carry forward from", before.rung, "UNAVAILABLE");
}

section("the staleness threshold is per asset class, not global");
{
  const repository = new InMemoryQuoteRepository();
  await repository.append([
    quote({ instrumentId: "BTC", asOf: "2026-08-21", price: "5412000", providerId: "coingecko" }),
    quote({ instrumentId: "FLAT", asOf: "2026-08-21", price: "9500000", providerId: "manual" }),
  ]);
  const book = new PriceBook([], repository);

  // Two days on a market that never closes means a failed fetch, not a weekend.
  const crypto = await book.priceOn(btc, on("2026-08-23"));
  check("crypto goes stale in a day", crypto.isStale, true);
  check("crypto threshold", STALENESS_DAYS.CRYPTO, 1);

  // A flat is valued by assertion; last month's assertion is the best there is.
  const property = await book.priceOn(flat, on("2026-09-10"));
  check("a property valuation survives 20 days", property.isStale, false);
  check("...and still goes stale eventually", (await book.priceOn(flat, on("2026-10-01"))).isStale, true);
}

/* ══ 3. Two providers, both kept ═════════════════════════════════════ */

section("vendor disagreement: both rows survive, priority decides, >1% is recorded");
{
  const repository = new InMemoryQuoteRepository();
  const http = new FixtureHttpClient([
    {
      match: "api.mfapi.in",
      body: mfapiBody([{ date: "21-08-2026", nav: "84.5612" }]),
    },
    {
      match: "query2.finance.yahoo.com",
      // 2% above MFAPI: 84.5612 × 1.02 = 86.2524…, so 86.25 is a >1% disagreement.
      body: yahooBody([{ date: "2026-08-21", close: 86.25 }]),
    },
  ]);
  const runtime = new VirtualRuntime(http);

  const fund: InstrumentRef = {
    instrumentId: "FUND",
    symbol: "Test Flexi Cap",
    assetClass: "MUTUAL_FUND",
    currency: INR,
    identifierType: "SCHEME_CODE",
    providerRefs: { mfapi: "120503", yahoo: "0P00012345.BO" },
  };

  // MFAPI first: for an Indian fund, the NAV endpoint outranks a scraped one.
  const book = new PriceBook(
    [new MfApiNavProvider(runtime), new YahooQuoteProvider(runtime)],
    repository,
  );

  // Yahoo declares CLOSE, MFAPI declares NAV, so a NAV refresh only reaches MFAPI —
  // which is the capability filter working. Both are asked for their own type.
  const navReport = await book.refresh({
    instruments: [fund],
    range: range("2026-08-17", "2026-08-21"),
    quoteType: "NAV",
  });
  check("only the NAV-capable provider was asked", navReport.attempts.filter((a) => a.outcome === "OK").length, 1);
  check("yahoo was skipped, and said so", navReport.attempts.find((a) => a.providerId === "yahoo")?.outcome, "SKIPPED_UNSUPPORTED");

  // Priority, on two stored beliefs about one day. The providers here are stubs
  // carrying only an id, because what is under test is the *order* — a real
  // provider would add a parser to the failure surface for nothing.
  const both = new InMemoryQuoteRepository();
  await both.append([
    quote({ asOf: "2026-08-21", price: "1543.25", providerId: "nse", ingestedAt: "2026-08-21T12:00:00Z" }),
    quote({ asOf: "2026-08-21", price: "1600.00", providerId: "yahoo", ingestedAt: "2026-08-21T13:00:00Z" }),
  ]);
  // NSE first: the exchange beats a scraped internal endpoint.
  const ordered = new PriceBook(
    [
      { id: "nse" } as never,
      { id: "yahoo" } as never,
    ],
    both,
  );

  const resolved = await ordered.priceOn(infy, on("2026-08-21"));
  check("both rows are stored", both.rows.length, 2);
  check("the higher-priority provider wins", resolved.providerId, "nse");
  check("...and its price is the one used", resolved.price?.toDecimalString(), "1543.25");
  // 1600.00 vs 1543.25 is a 3.677…% difference: 56.75 / 1543.25 = 0.036771…
  check(
    "the disagreement is measurable",
    price("1600").percentDifferenceFrom(price("1543.25")).toFixed(3),
    "3.677",
  );
}

section("the refresh records a >1% disagreement rather than choosing silently");
{
  const repository = new InMemoryQuoteRepository();
  const http = new FixtureHttpClient([
    { match: "api.mfapi.in", body: mfapiBody([{ date: "21-08-2026", nav: "84.5612" }]) },
  ]);
  const runtime = new VirtualRuntime(http);

  const fund: InstrumentRef = {
    instrumentId: "FUND",
    symbol: "Test Flexi Cap",
    assetClass: "MUTUAL_FUND",
    currency: INR,
    identifierType: "SCHEME_CODE",
    providerRefs: { mfapi: "120503" },
  };

  // A second provider for the same need, disagreeing by 2%: a stub, because what is
  // under test is the PriceBook's cross-check and not another parser.
  const disagreeing = {
    id: "stub",
    displayName: "A second opinion",
    capabilities: () => new MfApiNavProvider(runtime).capabilities(),
    health: () => ({ state: "HEALTHY" as const, consecutiveFailures: 0, lastError: null, circuitOpenUntil: null }),
    rateLimit: () => ({ requests: 60, perMillis: 60_000, burst: 10 }),
    fetchQuotes: async () => ({
      ok: true as const,
      value: [
        {
          instrumentId: "FUND",
          asOf: on("2026-08-21"),
          quoteType: "NAV" as const,
          price: price("86.2524"),
          providerId: "stub",
          sourceType: "PROVIDER" as const,
          ingestedAt: new Date("2026-08-21T12:00:00Z"),
        },
      ],
      // The Result shape the port promises.
      map: undefined as never,
    }),
  };

  const book = new PriceBook(
    [new MfApiNavProvider(runtime), disagreeing as never],
    repository,
  );
  const report = await book.refresh({
    instruments: [fund],
    range: range("2026-08-17", "2026-08-21"),
    quoteType: "NAV",
  });

  check("both providers answered", report.attempts.filter((a) => a.outcome === "OK").length, 2);
  check("both prices were persisted", report.persisted, 2);
  check("...and both survive in the store", repository.rows.length, 2);
  check("one divergence recorded", report.divergences.length, 1);
  // 86.2524 vs 84.5612: 1.6912 / 84.5612 = 2.0000%
  check("measured at 2%", report.divergences[0].deltaPercent.toFixed(2), "2.00");
  checkTrue(
    "the warning explains which price was used",
    report.warnings.some((warning) => warning.includes("Both kept")),
  );
  check("the divergence reached the repository", repository.divergences.length, 1);
}

section("a provider outage fails over with no user-visible error")
{
  const repository = new InMemoryQuoteRepository();
  const http = new FixtureHttpClient([
    { match: "api.mfapi.in", status: 500, body: "boom" },
    { match: "query2.finance.yahoo.com", body: yahooBody([{ date: "2026-08-21", close: 84.56 }]) },
  ]);
  const runtime = new VirtualRuntime(http);

  const fund: InstrumentRef = {
    instrumentId: "FUND",
    symbol: "Test Fund",
    // Declared EQUITY so both providers are capable of it, which is what makes this
    // a failover test rather than a capability test.
    assetClass: "EQUITY",
    currency: INR,
    identifierType: "TICKER",
    providerRefs: { yahoo: "FUND.BO" },
  };

  const book = new PriceBook(
    [new MfApiNavProvider(runtime, { maxAttempts: 1 }), new YahooQuoteProvider(runtime)],
    repository,
  );
  const report = await book.refresh({
    instruments: [fund],
    range: range("2026-08-17", "2026-08-21"),
    quoteType: "CLOSE",
  });

  // MFAPI does not declare CLOSE, so it is skipped; Yahoo answers. Either way the
  // report names every provider and what happened to it — failover is visible.
  check("a price was still obtained", report.persisted, 1);
  check("every provider is accounted for", report.attempts.length, 2);
  const resolution = await book.priceOn(fund, on("2026-08-21"));
  check("the user sees a price, not an error", resolution.price?.toDecimalString(), "84.56");
  check("...attributed to the provider that answered", resolution.providerId, "yahoo");
}

/* ══ 4. Q01–Q06 at the ingestion boundary ════════════════════════════ */

section("Q01-Q06: what is rejected, and what is merely flagged");
{
  const validator = new QuoteValidator();

  // Q01: a non-positive price is rejected. Options and futures are the documented
  // exception, and neither exists yet.
  const q01 = validator.validate([{ ...quote({ asOf: "2026-08-21", price: "0", providerId: "yahoo" }) }], infy);
  check("Q01 rejects a zero price", q01.rejected[0]?.reason, "Q01_NOT_POSITIVE");
  check("...and accepts nothing", q01.accepted.length, 0);

  // Q02: we cannot know a price before its date.
  const q02 = validator.validate(
    [quote({ asOf: "2026-08-21", price: "1543.25", providerId: "yahoo", ingestedAt: "2026-08-20T12:00:00Z" })],
    infy,
  );
  check("Q02 rejects a price ingested before its date", q02.rejected[0]?.reason, "Q02_INGESTED_BEFORE_AS_OF");

  // Q03 is a WARN: a 60% move is kept, because a real crash looks like this.
  const q03 = validator.validate(
    [quote({ asOf: "2026-08-24", price: "600", providerId: "nse" })],
    infy,
    quote({ asOf: "2026-08-21", price: "1543.25", providerId: "nse" }),
  );
  check("Q03 keeps a suspicious move", q03.accepted.length, 1);
  check("...and flags it", q03.warnings.length, 1);
  checkTrue("...saying a crash looks the same", q03.warnings[0].includes("a real crash looks like this too"));
  // 1543.25 → 600 is a 61.12% fall: 943.25 / 1543.25 = 0.611225…
  checkTrue("with the size of the move", q03.warnings[0].includes("61.1%"));

  // A 40% move is not flagged. The threshold is a real boundary, not decoration.
  const modest = validator.validate(
    [quote({ asOf: "2026-08-24", price: "1000", providerId: "nse" })],
    infy,
    quote({ asOf: "2026-08-21", price: "1543.25", providerId: "nse" }),
  );
  check("a 35% move passes unremarked", modest.warnings.length, 0);

  // Q04: a dollar price for a rupee holding.
  const q04 = validator.validate(
    [
      {
        ...quote({ asOf: "2026-08-21", price: "18.50", providerId: "yahoo" }),
        price: UnitPrice.of("18.50", USD),
      },
    ],
    infy,
  );
  check("Q04 rejects a currency mismatch", q04.rejected[0]?.reason, "Q04_CURRENCY_MISMATCH");

  check("the suspicious-move threshold is 50%", QuoteValidator.SUSPICIOUS_MOVE.toFixed(0), "50");
}

/* ══ 5. FxBook ═══════════════════════════════════════════════════════ */

section("FX: the ladder, and a user-asserted rate that beats the vendor");
{
  const rates = new InMemoryFxRateRepository();
  const http = new FixtureHttpClient([
    {
      match: "eurofxref",
      body: ecbBody([
        { date: "2026-08-20", rates: { USD: 1.088, INR: 91.4 } },
        { date: "2026-08-21", rates: { USD: 1.09, INR: 91.56 } },
      ]),
    },
  ]);
  const runtime = new VirtualRuntime(http);
  const ecb = new EcbFxProvider(runtime);
  const book = new FxBook([ecb], rates, clock);

  const fetched = await ecb.fetchRates({ base: "USD", quotes: ["INR"], range: range("2026-08-17", "2026-08-21") });
  if (fetched.ok) await rates.append(fetched.value);

  // 91.56 ÷ 1.09 = 84.00 (to eight places, 83.99999999… → 84).
  const provider = await book.rateOn("USD", "INR", on("2026-08-21"));
  check("the provider rate", provider.rate?.toDecimalString(), "84");
  check("...is a derived one", provider.sourceType, "DERIVED");
  check("...and is not user-asserted", provider.userAsserted, false);

  // The user actually got 84.40 from their bank. That is the rate their return is
  // assessed on, whatever the ECB published.
  await book.assertUserRate({ userId, base: "USD", quote: "INR", asOf: on("2026-08-21"), rate: Quantity.fromString("84.40") });
  const asserted = await book.rateOn("USD", "INR", on("2026-08-21"), userId);
  check("the user's rate wins", asserted.rate?.toDecimalString(), "84.4");
  check("...and is marked as theirs", asserted.userAsserted, true);
  check("...as MANUAL, so a report can say so", asserted.sourceType, "MANUAL");
  checkTrue("...with the reason", (asserted.reason ?? "").includes("assessed on"));

  // Another user is unaffected: an assertion is scoped to whoever made it.
  const other = await book.rateOn("USD", "INR", on("2026-08-21"), UserId.from("user_pricing_2"));
  check("another user still sees the provider rate", other.rate?.toDecimalString(), "84");

  // Conversion: $1,100 at 84.40 = ₹92,840.00 exactly.
  const converted = await book.convert(Money.fromRupees("1100", USD), INR, on("2026-08-21"), userId);
  check("conversion uses the asserted rate", converted.ok && converted.value.amount.toDecimalString(), "92840.00");
  check("...and reports which rate it used", converted.ok && converted.value.resolution.userAsserted, true);

  // A date with no rate on or before it is a refusal, not a guess and not a zero.
  //
  // (EUR would have been the natural example and is deliberately unavailable: the
  // ECB feed produces EUR *pairs* as currency codes, but EUR is absent from
  // `Currency.REGISTRY`, so a currency the app cannot hold cannot be constructed as
  // one. That is the registry doing its job.)
  const impossible = await book.convert(Money.fromRupees("1100", USD), INR, on("2026-08-10"));
  check("an unconvertible amount is a typed failure", !impossible.ok && impossible.error.code, "FX_RATE_UNAVAILABLE");
  checkTrue(
    "...that tells the user what to do instead",
    !impossible.ok && impossible.error.message.includes("its own currency"),
  );

  // Same currency in, same amount out — and no rate lookup needed.
  const identity = await book.convert(Money.fromRupees("500"), INR, on("2026-08-21"));
  check("converting to the same currency is the identity", identity.ok && identity.value.amount.toDecimalString(), "500.00");

  // The ladder applies to rates too.
  const carried = await book.rateOn("USD", "INR", on("2026-08-23"));
  check("a weekend carries Friday's rate forward", carried.rate?.toDecimalString(), "84");
  check("...with its age", carried.ageDays, 2);
  check("...and not stale at two days", carried.isStale, false);
  check("five days later it is stale", (await book.rateOn("USD", "INR", on("2026-08-26"))).isStale, true);
}

section("Q06: a rate and its inverse agree within 0.1%");
{
  // 84.00 and 1/84 = 0.01190476: the product is 0.99999984, a 0.000016% shortfall
  // from unity — the rounding of the reciprocal at eight places, and well inside
  // the tolerance the invariant allows.
  const consistent = FxBook.inverseConsistency(Quantity.fromString("84"), Quantity.fromString("0.01190476"));
  check("consistent pair passes", consistent.ok, true);
  checkTrue("with a tiny error", consistent.productError.compareTo(Percentage.of("0.001")) < 0);

  // 84.00 against 0.0125 (which is 1/80) is a 5% error, and is caught.
  const inconsistent = FxBook.inverseConsistency(Quantity.fromString("84"), Quantity.fromString("0.0125"));
  check("an inconsistent pair fails", inconsistent.ok, false);
  check("the error is 5%", inconsistent.productError.toFixed(0), "5");
}

/* ══ 6. UnitPrice, the reason prices are not Money ══════════════════ */

section("UnitPrice: four-decimal NAV survives, and rounds once");
{
  const nav = price("84.5612");
  check("a four-decimal NAV is held exactly", nav.toDecimalString(), "84.5612");
  // Money would have rounded this to 84.56 at ingestion. On 10,000 units that is
  // 845,612 vs 845,600 — ₹12 of invented value, from a rounding nobody could see.
  check("10,000 units at the exact NAV", nav.times(units("10000")).toDecimalString(), "845612.00");
  check(
    "...against what Money would have given",
    Money.fromRupees("84.56").times(10_000).toDecimalString(),
    "845600.00",
  );
  check("the difference", nav.times(units("10000")).minus(Money.fromRupees("845600")).toDecimalString(), "12.00");

  // Rounding happens once, at the multiplication, and half-even so a portfolio of
  // many holdings does not drift upward.
  check("a fractional paisa rounds half-even", price("1.005").times(units("1")).toDecimalString(), "1.00");
  check("...and the next one the other way", price("1.015").times(units("1")).toDecimalString(), "1.02");
  throws(
    "a price cannot be compared across currencies",
    () => price("84").percentDifferenceFrom(UnitPrice.of("84", USD)),
    "Cannot compare",
  );
}

done();
