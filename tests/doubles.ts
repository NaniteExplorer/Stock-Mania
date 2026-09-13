/**
 * Test doubles for the pricing layer.
 *
 * Not a `*.spec.ts`, so the runner never picks it up as a spec.
 *
 * Two of these matter beyond convenience:
 *
 *   - {@link FixtureHttpClient} is why **CI never touches the network**. Every
 *     payload here is hand-written to the shape each provider documents (or, for
 *     the undocumented ones, to the shape observed and recorded), so a provider
 *     parser is tested against a fixed artefact rather than against whatever the
 *     upstream is serving today. A suite that calls Yahoo fails for reasons that
 *     have nothing to do with the change under test.
 *   - {@link VirtualRuntime} makes the retry, backoff and rate-limit tests run in
 *     microseconds instead of minutes: `sleep` advances a counter rather than a
 *     clock, so "waits 60 seconds for the circuit to half-open" is instant and
 *     exact. Sleeping for real would make these tests either slow or approximate,
 *     and an approximate rate-limit test passes when the limit is wrong.
 */

import { Money } from "@/core/money";
import { Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import type { HttpClient, HttpResponse, ProviderRuntime } from "@/infra/providers";
import type {
  FxQuote,
  FxRateRepository,
  PriceDivergence,
  Quote,
  QuoteRepository,
  QuoteType,
  StoredFxRate,
} from "@/domain/pricing";
import type { CatalogQuoteKeyState, QuoteKeyCandidateListing } from "@/domain/instrument-catalog";
import type { Bar, BarGranularity, BarRepository } from "@/domain/analysis";
import { makeBar, weekdayGaps } from "@/domain/analysis";
import { mulberry32 } from "./harness";

/* ═══ Virtual runtime ═════════════════════════════════════════════════ */

/**
 * A clock that only moves when something sleeps.
 *
 * That is the useful property: elapsed virtual time is exactly the delay the code
 * under test asked for, so a token-bucket assertion is about the code's arithmetic
 * rather than about how loaded the machine is.
 */
export class VirtualRuntime implements ProviderRuntime {
  private millis: number;
  private readonly rng: () => number;

  /** Every sleep, in order — so a test can assert the backoff shape, not just its total. */
  readonly sleeps: number[] = [];

  constructor(
    readonly http: HttpClient,
    options: { startMillis?: number; seed?: number } = {},
  ) {
    this.millis = options.startMillis ?? Date.parse("2026-08-22T10:00:00Z");
    this.rng = mulberry32(options.seed ?? 7);
  }

  now(): number {
    return this.millis;
  }

  async sleep(millis: number): Promise<void> {
    this.sleeps.push(millis);
    this.millis += millis;
  }

  random(): number {
    return this.rng();
  }

  /** Moves the clock without a sleep — for "sixty seconds later, does it probe?". */
  advance(millis: number): void {
    this.millis += millis;
  }

  get elapsedMillis(): number {
    return this.sleeps.reduce((total, slept) => total + slept, 0);
  }
}

/* ═══ Fixture HTTP ════════════════════════════════════════════════════ */

export interface FixtureRoute {
  /** Matched as a substring of the URL, which keeps a route readable. */
  readonly match: string;
  readonly status?: number;
  readonly body?: string;
  /** Set to hang forever, so the provider's timeout is what ends the call. */
  readonly hang?: boolean;
}

export class FixtureHttpClient implements HttpClient {
  /** Every URL requested, in order. Rate-limit and retry tests count these. */
  readonly requests: string[] = [];

  constructor(private routes: FixtureRoute[]) {}

  /** Replaces the routes mid-test — for inducing an outage and then a recovery. */
  setRoutes(routes: FixtureRoute[]): void {
    this.routes = routes;
  }

  async get(url: string): Promise<HttpResponse> {
    this.requests.push(url);
    const route = this.routes.find((candidate) => url.includes(candidate.match));
    if (!route) {
      return { status: 404, body: "not found", headers: {} };
    }
    if (route.hang) {
      // Never resolves. The provider's own timeout is the thing under test.
      return new Promise<HttpResponse>(() => {});
    }
    return { status: route.status ?? 200, body: route.body ?? "", headers: {} };
  }
}

/* ═══ Provider fixtures ═══════════════════════════════════════════════ */

/**
 * MFAPI: `DD-MM-YYYY`, newest first — its real ordering, kept, because a parser
 * that only works on ascending input would pass a tidied fixture and fail live.
 */
export function mfapiBody(rows: readonly { date: string; nav: string }[]): string {
  return JSON.stringify({
    meta: { scheme_code: 120503, scheme_name: "Test Flexi Cap Fund - Direct - Growth" },
    data: [...rows].reverse(),
    status: "SUCCESS",
  });
}

/** AMFI's `NAVAll.txt`: header lines, a scheme-type banner, then `;`-delimited rows. */
export function amfiBody(rows: readonly { code: string; nav: string; date: string; name?: string }[]): string {
  const lines = [
    "Scheme Code;ISIN Div Payout/ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
    "",
    "Open Ended Schemes(Equity Scheme - Flexi Cap Fund)",
    "",
  ];
  for (const row of rows) {
    lines.push(
      `${row.code};INF209K01VD8;INF209K01VE6;${row.name ?? "Test Flexi Cap Fund"};Direct;Growth;${row.nav};${row.date}`,
    );
  }
  return lines.join("\n");
}

/** Yahoo's chart payload. `null` closes are market holidays, and are kept as such. */
export function yahooBody(
  rows: readonly { date: string; close: number | null }[],
  currency = "INR",
): string {
  return JSON.stringify({
    chart: {
      result: [
        {
          meta: { currency, symbol: "INFY.NS" },
          timestamp: rows.map((row) => Math.floor(CalendarDate.parse(row.date).toUtcInstant().getTime() / 1000)),
          indicators: {
            quote: [{ close: rows.map((row) => row.close) }],
            adjclose: [{ adjclose: rows.map((row) => row.close) }],
          },
        },
      ],
      error: null,
    },
  });
}

export function nseBody(close: number, lastUpdateTime: string): string {
  return JSON.stringify({
    priceInfo: { lastPrice: close, close },
    metadata: { lastUpdateTime },
  });
}

export function ibjaBody(rows: readonly { date: string; metal: string; purity?: string; rate: number }[]): string {
  return JSON.stringify({ rates: rows });
}

export function coinGeckoBody(rows: readonly { date: string; price: number }[]): string {
  return JSON.stringify({
    prices: rows.map((row) => [CalendarDate.parse(row.date).toUtcInstant().getTime(), row.price]),
  });
}

/** ECB's `eurofxref` XML, trimmed to the two attributes anything reads. */
export function ecbBody(days: readonly { date: string; rates: Readonly<Record<string, number>> }[]): string {
  const cubes = days
    .map(
      (day) =>
        `    <Cube time='${day.date}'>\n` +
        Object.entries(day.rates)
          .map(([currency, rate]) => `      <Cube currency='${currency}' rate='${rate}'/>`)
          .join("\n") +
        `\n    </Cube>`,
    )
    .join("\n");

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">\n` +
    `  <Cube>\n${cubes}\n  </Cube>\n</gesmes:Envelope>\n`
  );
}

/* ═══ In-memory repositories ═══════════════════════════════════════════ */

/**
 * Append-only, like the real one.
 *
 * There is deliberately no `update`: if this double allowed a price to be
 * overwritten, a test could pass against behaviour the schema forbids.
 */
export class InMemoryQuoteRepository implements QuoteRepository {
  readonly rows: (Quote & { id: string })[] = [];
  readonly divergences: PriceDivergence[] = [];
  private nextId = 1;

  async append(quotes: readonly Quote[]): Promise<void> {
    for (const quote of quotes) {
      this.rows.push({ ...quote, id: `q${this.nextId++}` });
    }
  }

  async supersede(supersededQuoteId: string, bySupersedingQuoteId: string): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === supersededQuoteId);
    if (index >= 0) {
      this.rows[index] = { ...this.rows[index], supersededBy: bySupersedingQuoteId };
    }
  }

  async findLatestOnOrBefore(
    instrumentId: string,
    quoteType: QuoteType,
    asOf: CalendarDate,
    limit = 50,
  ): Promise<readonly Quote[]> {
    return this.rows
      .filter(
        (row) =>
          row.instrumentId === instrumentId &&
          row.quoteType === quoteType &&
          row.asOf.isOnOrBefore(asOf),
      )
      .sort((a, b) => {
        const byDate = b.asOf.compareTo(a.asOf);
        return byDate !== 0 ? byDate : b.ingestedAt.getTime() - a.ingestedAt.getTime();
      })
      .slice(0, limit);
  }

  async findRange(
    instrumentId: string,
    quoteType: QuoteType,
    range: DateRange,
  ): Promise<readonly Quote[]> {
    return this.rows
      .filter(
        (row) =>
          row.instrumentId === instrumentId && row.quoteType === quoteType && range.contains(row.asOf),
      )
      .sort((a, b) => a.asOf.compareTo(b.asOf));
  }

  async coverage(
    instrumentId: string,
    quoteType: QuoteType,
  ): Promise<{ from: CalendarDate; through: CalendarDate } | null> {
    const mine = this.rows.filter(
      (row) => row.instrumentId === instrumentId && row.quoteType === quoteType,
    );
    if (mine.length === 0) return null;
    const dates = mine.map((row) => row.asOf).sort((a, b) => a.compareTo(b));
    return { from: dates[0], through: dates[dates.length - 1] };
  }

  async recordDivergence(divergence: PriceDivergence): Promise<void> {
    this.divergences.push(divergence);
  }
}

/**
 * Bars in memory, with the same contract as the Drizzle one.
 *
 * `bars.spec.ts` runs one assertion block against this and against the real
 * store, which is the point of the double existing at all: a conformance suite
 * that only ever runs against SQL cannot tell an interface from an
 * implementation, and one that only runs in memory proves nothing about the
 * database.
 */
export class InMemoryBarRepository implements BarRepository {
  readonly rows: (Bar & { id: string })[] = [];
  private nextId = 1;

  async append(bars: readonly Bar[]): Promise<void> {
    for (const bar of bars) {
      // Validated here too: the double must refuse exactly what the store refuses.
      this.rows.push({ ...makeBar(bar), id: `b${this.nextId++}` });
    }
  }

  async findRange(
    instrumentId: string,
    granularity: BarGranularity,
    dateRange: DateRange,
  ): Promise<readonly Bar[]> {
    return this.rows
      .filter(
        (row) =>
          row.instrumentId === instrumentId &&
          row.granularity === granularity &&
          !row.supersededBy &&
          dateRange.contains(row.asOf),
      )
      .sort((a, b) => a.asOf.compareTo(b.asOf));
  }

  async coverage(
    instrumentId: string,
    granularity: BarGranularity,
  ): Promise<{ from: CalendarDate; through: CalendarDate; count: number } | null> {
    const mine = this.rows.filter(
      (row) =>
        row.instrumentId === instrumentId && row.granularity === granularity && !row.supersededBy,
    );
    if (mine.length === 0) return null;
    const dates = mine.map((row) => row.asOf).sort((a, b) => a.compareTo(b));
    return { from: dates[0], through: dates[dates.length - 1], count: mine.length };
  }

  async supersede(supersededBarId: string, bySupersedingBarId: string): Promise<void> {
    const index = this.rows.findIndex((row) => row.id === supersededBarId);
    if (index >= 0) this.rows[index] = { ...this.rows[index], supersededBy: bySupersedingBarId };
  }

  async restate(bars: readonly Bar[]): Promise<{ appended: number; superseded: number }> {
    let superseded = 0;
    for (const bar of bars) {
      const checked = makeBar(bar);
      const id = `b${this.nextId++}`;
      for (let index = 0; index < this.rows.length; index += 1) {
        const row = this.rows[index];
        if (
          row.instrumentId === checked.instrumentId &&
          row.granularity === checked.granularity &&
          row.asOf.toISO() === checked.asOf.toISO() &&
          !row.supersededBy
        ) {
          this.rows[index] = { ...row, supersededBy: id };
          superseded += 1;
        }
      }
      this.rows.push({ ...checked, id });
    }
    return { appended: bars.length, superseded };
  }

  async gaps(
    instrumentId: string,
    granularity: BarGranularity,
    range: DateRange,
  ): Promise<readonly DateRange[]> {
    const present = new Set(
      this.rows
        .filter(
          (row) =>
            row.instrumentId === instrumentId &&
            row.granularity === granularity &&
            !row.supersededBy &&
            range.contains(row.asOf),
        )
        .map((row) => row.asOf.toISO()),
    );
    return weekdayGaps(range, present, granularity);
  }
}

export class InMemoryFxRateRepository implements FxRateRepository {
  readonly rows: StoredFxRate[] = [];

  async append(rates: readonly FxQuote[]): Promise<void> {
    for (const rate of rates) {
      this.rows.push({ ...rate, userId: null, userRate: null });
    }
  }

  async findLatestOnOrBefore(
    base: string,
    quote: string,
    asOf: CalendarDate,
    userIdValue?: { value: string },
    limit = 50,
  ): Promise<readonly StoredFxRate[]> {
    return this.rows
      .filter(
        (row) =>
          row.base === base &&
          row.quote === quote &&
          row.asOf.isOnOrBefore(asOf) &&
          // A user's row is visible only to that user; a provider row to everyone.
          (row.userId === null || row.userId === userIdValue?.value),
      )
      .sort((a, b) => {
        const byDate = b.asOf.compareTo(a.asOf);
        return byDate !== 0 ? byDate : b.ingestedAt.getTime() - a.ingestedAt.getTime();
      })
      .slice(0, limit);
  }

  async setUserRate(rate: FxQuote & { userId: { value: string } }): Promise<void> {
    this.rows.push({ ...rate, userId: rate.userId.value, userRate: rate.rate });
  }
}

/* ═══ Convenience ═════════════════════════════════════════════════════ */

export const rupees = (value: string) => Money.fromRupees(value);
/** A per-unit price, which keeps more decimals than money does. */
export const price = (value: string, currency = Money.fromRupees("0").currency) =>
  UnitPrice.of(value, currency);
export const on = (value: string) => CalendarDate.parse(value);
export const range = (from: string, to: string) => DateRange.of(on(from), on(to));
export const units = (value: string) => Quantity.fromString(value);

/* ═══ Catalogue quote-key gate ═════════════════════════════════════════ */

/**
 * The quote-key half of `InstrumentCatalogRepository`, stubbed.
 *
 * The gate added six methods to the port, and four existing fixtures care about
 * none of them — they are testing search and refresh, not priceability. Extending
 * this keeps each fixture about its own subject while still making it a complete
 * implementation of the interface, which is the property that stops a fixture
 * drifting away from the port it stands in for.
 *
 * Every stub records what it was asked, so a spec that *does* care can assert on
 * it without writing a fifth fixture.
 */
export class CatalogQuoteKeyStubs {
  readonly recordedQuoteKeys: unknown[] = [];
  readonly staleMarks: { listingId: string; reason: string }[] = [];
  readonly touches: string[] = [];
  readonly scIds = new Map<string, string>();

  async listingsDueQuoteKeyCheck(
    _limit: number,
    _asAt: Date,
  ): Promise<readonly (QuoteKeyCandidateListing & CatalogQuoteKeyState)[]> {
    return [];
  }

  /** Defaults to the due-set, so a fixture that overrides one gets both. */
  async listingsForQuoteKeyProbe(
    listingIds: readonly string[],
    asAt: Date,
  ): Promise<readonly (QuoteKeyCandidateListing & CatalogQuoteKeyState)[]> {
    const due = await this.listingsDueQuoteKeyCheck(listingIds.length || 1, asAt);
    return due.filter((row) => listingIds.includes(row.listingId));
  }

  async recordQuoteKey(resolution: unknown): Promise<void> {
    this.recordedQuoteKeys.push(resolution);
  }

  async markQuoteStale(listingId: string, _at: Date, reason: string): Promise<void> {
    this.staleMarks.push({ listingId, reason });
  }

  async touchQuoteKey(listingId: string, _at?: Date): Promise<void> {
    this.touches.push(listingId);
  }

  async recordMoneycontrolScIds(rows: readonly { listingId: string; scId: string }[]): Promise<number> {
    for (const row of rows) this.scIds.set(row.listingId, row.scId);
    return rows.length;
  }

  async moneycontrolScIdMap(): Promise<ReadonlyMap<string, string>> {
    return this.scIds;
  }
}
