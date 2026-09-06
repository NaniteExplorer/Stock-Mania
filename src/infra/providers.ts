/**
 * Market-data providers: the resilience machinery and the concrete sources.
 *
 * **The resilience lives in the base class, not in each provider.** That is the
 * whole design. `40-MARKET-DATA.md` §3.1 requires retry with jitter, a token
 * bucket, a circuit breaker and a timeout of *every* provider; asking eight
 * authors to remember four mechanisms each is thirty-two chances to get it wrong,
 * and the one that gets it wrong is the one that takes the app down. A concrete
 * provider here implements exactly one method — `fetchRaw` — and inherits all four.
 *
 * Every provider in this file is **keyless**: AMFI, MFAPI, Yahoo, NSE, IBJA,
 * CoinGecko and the ECB all serve without an API key, and `ManualProvider` needs no
 * network at all. That is a deliberate constraint, not an accident of what was
 * easy: a key is a secret to store, rotate and leak, and a free tier that allows 25
 * requests a day (Alpha Vantage, which Paisa uses) is not a data source.
 *
 * The HTTP client is injected. Tests supply a fixture client, so **CI never touches
 * the network** — a test suite that depends on Yahoo's undocumented endpoint is a
 * suite that fails for reasons that have nothing to do with the change under test.
 */

import type {
  BenchmarkSeriesFeed,
  BenchmarkSeriesKey,
  BenchmarkSeriesOutcome,
} from "@/app/gold-benchmark.usecases";
import { Err, Ok, Result } from "@/core/kernel";
import { Currency } from "@/core/money";
import { Quantity, UnitPrice } from "@/core/numeric";
import { CalendarDate, DateRange } from "@/core/time";
import {
  FxProviderPort,
  FxQuote,
  HealthStatus,
  InstrumentRef,
  PricedAssetClass,
  ProviderCapabilities,
  ProviderError,
  Quote,
  QuoteProviderPort,
  QuoteRequest,
  QuoteType,
  RateLimitBudget,
} from "@/domain/pricing";

/* ═══ HTTP port ═══════════════════════════════════════════════════════ */

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * The one thing a provider is allowed to know about the outside world.
 *
 * A port rather than `fetch` directly, so the conformance suite can induce a 500,
 * a timeout and a malformed body without a network — those three are the cases that
 * matter and the ones a live endpoint will not produce on demand.
 */
export interface HttpClient {
  get(url: string, init?: { headers?: Record<string, string>; timeoutMs?: number }): Promise<HttpResponse>;
}

/** The real one. `AbortController` gives the timeout its teeth. */
export class FetchHttpClient implements HttpClient {
  constructor(private readonly defaultTimeoutMs = 10_000) {}

  async get(
    url: string,
    init?: { headers?: Record<string, string>; timeoutMs?: number },
  ): Promise<HttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? this.defaultTimeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          // Several of these endpoints refuse a request without a browser-like
          // user agent. Saying so here rather than per provider keeps the reason
          // in one place.
          "user-agent": "Mozilla/5.0 (compatible; StockMania/1.0)",
          accept: "application/json,text/plain,*/*",
          ...init?.headers,
        },
        signal: controller.signal,
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return { status: response.status, body: await response.text(), headers };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Everything time- and randomness-dependent, injected so tests are deterministic. */
export interface ProviderRuntime {
  readonly http: HttpClient;
  /** Milliseconds since the epoch. */
  now(): number;
  sleep(millis: number): Promise<void>;
  /** `[0, 1)`, for retry jitter. */
  random(): number;
}

export const systemRuntime = (http: HttpClient = new FetchHttpClient()): ProviderRuntime => ({
  http,
  now: () => Date.now(),
  sleep: (millis) => new Promise((resolve) => setTimeout(resolve, millis)),
  random: () => Math.random(),
});

/* ═══ Token bucket ════════════════════════════════════════════════════ */

/**
 * A token bucket that **queues rather than drops**.
 *
 * §3.1 is specific about this, and it is the right call: dropping a request under
 * load means a hole in a price series, and a hole in a price series is a wrong
 * valuation on that day. Waiting means a slow refresh, which is visible and
 * harmless.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefillAt: number;

  constructor(
    private readonly budget: RateLimitBudget,
    private readonly runtime: Pick<ProviderRuntime, "now" | "sleep">,
  ) {
    this.tokens = budget.burst;
    this.lastRefillAt = runtime.now();
  }

  private refill(): void {
    const now = this.runtime.now();
    const elapsed = now - this.lastRefillAt;
    if (elapsed <= 0) return;
    const perMilli = this.budget.requests / this.budget.perMillis;
    this.tokens = Math.min(this.budget.burst, this.tokens + elapsed * perMilli);
    this.lastRefillAt = now;
  }

  /** Waits until a token is free, then takes it. Returns the delay it imposed. */
  async take(): Promise<number> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    const perMilli = this.budget.requests / this.budget.perMillis;
    const waitMs = Math.ceil((1 - this.tokens) / perMilli);
    await this.runtime.sleep(waitMs);
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
    return waitMs;
  }

  /** For tests and for a UI that wants to show remaining headroom. */
  get available(): number {
    this.refill();
    return this.tokens;
  }
}

/* ═══ Circuit breaker ═════════════════════════════════════════════════ */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * Opens after five consecutive failures, probes again after sixty seconds (§3.1).
 *
 * The point is not politeness to the upstream: it is that a dead provider must
 * *stop being asked*, so the registry can fail over to the next one instead of
 * every page load waiting ten seconds for the same timeout.
 */
export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly runtime: Pick<ProviderRuntime, "now">,
    private readonly threshold = 5,
    private readonly cooldownMillis = 60_000,
  ) {}

  get state(): CircuitState {
    if (this.openedAt === null) return "CLOSED";
    return this.runtime.now() - this.openedAt >= this.cooldownMillis ? "HALF_OPEN" : "OPEN";
  }

  get openUntil(): Date | null {
    return this.openedAt === null ? null : new Date(this.openedAt + this.cooldownMillis);
  }

  /** True when a call may be attempted — a half-open circuit allows one probe. */
  get allowsRequest(): boolean {
    return this.state !== "OPEN";
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.lastError = null;
  }

  recordFailure(error: string): void {
    this.lastError = error;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.threshold) {
      // Re-stamped on each further failure, so a provider that fails its half-open
      // probe waits another full cooldown instead of being hammered every request.
      this.openedAt = this.runtime.now();
    }
  }

  health(): HealthStatus {
    const state = this.state;
    return {
      state: state === "OPEN" ? "UNAVAILABLE" : this.consecutiveFailures > 0 ? "DEGRADED" : "HEALTHY",
      consecutiveFailures: this.consecutiveFailures,
      lastError: this.lastError,
      circuitOpenUntil: state === "OPEN" ? this.openUntil : null,
    };
  }
}

/* ═══ The base class ══════════════════════════════════════════════════ */

export interface ProviderOptions {
  readonly maxAttempts?: number;
  readonly requestTimeoutMs?: number;
  readonly batchTimeoutMs?: number;
  readonly baseBackoffMs?: number;
  readonly breakerThreshold?: number;
  readonly breakerCooldownMs?: number;
}

/**
 * What every price provider inherits.
 *
 * `fetchQuotes` is final in spirit — a subclass overriding it would opt out of the
 * resilience this class exists to guarantee, so subclasses implement `fetchRaw` and
 * this method wraps it in:
 *
 *   1. the circuit breaker (skip entirely if open),
 *   2. the token bucket (queue until a token is free),
 *   3. a timeout per attempt,
 *   4. up to three attempts with **full jitter** exponential backoff,
 *   5. normalisation: ascending by date, and one quote per `(instrument, as_of)`.
 *
 * 4xx is not retried, except 429. Retrying a 404 just makes the same wrong answer
 * arrive three times more slowly.
 */
export abstract class PriceProvider implements QuoteProviderPort {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract capabilities(): ProviderCapabilities;

  protected readonly breaker: CircuitBreaker;
  private readonly bucket: TokenBucket;
  private readonly maxAttempts: number;
  private readonly requestTimeoutMs: number;
  private readonly baseBackoffMs: number;

  constructor(
    protected readonly runtime: ProviderRuntime,
    options: ProviderOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.baseBackoffMs = options.baseBackoffMs ?? 200;
    this.breaker = new CircuitBreaker(
      runtime,
      options.breakerThreshold ?? 5,
      options.breakerCooldownMs ?? 60_000,
    );
    this.bucket = new TokenBucket(this.rateLimit(), runtime);
  }

  /** Overridden by providers with a known published limit. */
  rateLimit(): RateLimitBudget {
    return { requests: 60, perMillis: 60_000, burst: 10 };
  }

  health(): HealthStatus {
    return this.breaker.health();
  }

  /**
   * The one method a concrete provider writes.
   *
   * It may throw: this class turns a throw into a typed {@link ProviderError}, which
   * is what keeps "the upstream returned garbage" from propagating as an exception
   * through a page render. A provider that knows *why* it failed should throw a
   * `ProviderError` itself, and that kind is preserved.
   */
  protected abstract fetchRaw(request: QuoteRequest): Promise<readonly Quote[]>;

  async fetchQuotes(request: QuoteRequest): Promise<Result<readonly Quote[], ProviderError>> {
    // Conformance requirement 6, enforced rather than merely declared: a provider
    // asked for a class it does not cover says so, instead of returning whatever
    // its endpoint happens to give for that symbol. The registry already filters by
    // capability, so reaching this is a caller's mistake — and a caller's mistake
    // that returned a plausible number would be the worst possible outcome.
    const capabilities = this.capabilities();
    const unsupported = request.instruments.filter(
      (ref) => !capabilities.assetClasses.includes(ref.assetClass),
    );
    if (unsupported.length > 0) {
      return Err(
        new ProviderError(
          "UNSUPPORTED",
          this.id,
          `${this.id} does not price ${[...new Set(unsupported.map((ref) => ref.assetClass))].join(", ")} ` +
            `(it covers ${capabilities.assetClasses.join(", ")}).`,
        ),
      );
    }
    if (!capabilities.quoteTypes.includes(request.quoteType)) {
      return Err(
        new ProviderError(
          "UNSUPPORTED",
          this.id,
          `${this.id} does not produce ${request.quoteType} quotes.`,
        ),
      );
    }

    if (!this.breaker.allowsRequest) {
      return Err(ProviderError.circuitOpen(this.id, this.breaker.openUntil ?? new Date(this.runtime.now())));
    }

    let lastError: ProviderError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      await this.bucket.take();

      try {
        const raw = await this.withTimeout(this.fetchRaw(request));
        this.breaker.recordSuccess();
        return Ok(this.normalise(raw));
      } catch (thrown) {
        const error = this.asProviderError(thrown);
        lastError = error;
        this.breaker.recordFailure(error.message);

        if (!error.retryable || attempt === this.maxAttempts) break;

        // Full jitter: a uniform draw from [0, base × 2^n). Deterministic backoff
        // synchronises every client into the same retry wave, which is how a
        // recovering upstream is knocked over again.
        const ceiling = this.baseBackoffMs * 2 ** (attempt - 1);
        await this.runtime.sleep(Math.floor(this.runtime.random() * ceiling));
      }
    }

    return Err(lastError ?? new ProviderError("UPSTREAM", this.id, `${this.id} failed.`, true));
  }

  private async withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new ProviderError("TIMEOUT", this.id, `${this.id} did not respond in ${this.requestTimeoutMs}ms.`, true)),
        this.requestTimeoutMs,
      );
    });
    try {
      return await Promise.race([work, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private asProviderError(thrown: unknown): ProviderError {
    if (thrown instanceof ProviderError) return thrown;
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    // An unrecognised throw is treated as retryable: the alternative is giving up on
    // a transient network blip, which is the most common failure of all.
    return new ProviderError("UPSTREAM", this.id, `${this.id}: ${message}`, true, { cause: thrown });
  }

  /**
   * Conformance requirement 5: ascending by date, no duplicate
   * `(instrument, as_of)`.
   *
   * Enforced here rather than trusted per provider, because a duplicate silently
   * doubles a day in any series that walks the rows — and the last row wins, which
   * is the newest belief.
   */
  private normalise(quotes: readonly Quote[]): readonly Quote[] {
    const byKey = new Map<string, Quote>();
    for (const quote of quotes) {
      byKey.set(`${quote.instrumentId}|${quote.asOf.toISO()}|${quote.quoteType}`, quote);
    }
    return [...byKey.values()].sort((a, b) => a.asOf.compareTo(b.asOf));
  }

  /* ── Helpers for subclasses ────────────────────────────────────── */

  /** A GET that turns an HTTP status into the right typed error. */
  protected async getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const response = await this.runtime.http.get(url, { headers, timeoutMs: this.requestTimeoutMs });
    this.assertStatus(response.status, url);
    try {
      return JSON.parse(response.body) as T;
    } catch (cause) {
      throw new ProviderError(
        "MALFORMED_RESPONSE",
        this.id,
        `${this.id} returned a body that is not JSON (${response.body.slice(0, 80)}…).`,
        false,
        { cause },
      );
    }
  }

  protected async getText(url: string, headers?: Record<string, string>): Promise<string> {
    const response = await this.runtime.http.get(url, { headers, timeoutMs: this.requestTimeoutMs });
    this.assertStatus(response.status, url);
    return response.body;
  }

  private assertStatus(status: number, url: string): void {
    if (status === 429) {
      throw new ProviderError("RATE_LIMITED", this.id, `${this.id} rate-limited the request.`, true);
    }
    if (status === 404) {
      throw new ProviderError("UNKNOWN_SYMBOL", this.id, `${this.id} has no data at ${url}.`, false);
    }
    if (status >= 400 && status < 500) {
      throw new ProviderError("UPSTREAM", this.id, `${this.id} rejected the request (${status}).`, false);
    }
    if (status >= 500) {
      throw new ProviderError("UPSTREAM", this.id, `${this.id} is failing (${status}).`, true);
    }
  }

  /** The provider's own code for an instrument, or its symbol. */
  protected codeFor(ref: InstrumentRef): string {
    return ref.providerRefs?.[this.id] ?? ref.symbol;
  }

  protected quote(props: {
    ref: InstrumentRef;
    asOf: CalendarDate;
    quoteType: QuoteType;
    price: UnitPrice;
  }): Quote {
    return {
      instrumentId: props.ref.instrumentId,
      asOf: props.asOf,
      quoteType: props.quoteType,
      price: props.price,
      providerId: this.id,
      sourceType: "PROVIDER",
      ingestedAt: new Date(this.runtime.now()),
    };
  }
}

const EQUITY_CLASSES: readonly PricedAssetClass[] = ["EQUITY", "ETF"];

interface FinnhubQuotePayload {
  c?: number;
  t?: number;
}

/** Authenticated real-time current quotes for USD-denominated US equities. */
export class FinnhubQuoteProvider extends PriceProvider {
  readonly id = "finnhub";
  readonly displayName = "Finnhub (real-time US equities)";

  constructor(
    runtime: ProviderRuntime,
    private readonly token: string,
    options: ProviderOptions = {},
  ) {
    super(runtime, options);
  }

  capabilities(): ProviderCapabilities {
    return {
      assetClasses: EQUITY_CLASSES,
      supportsIntraday: true,
      supportsHistorical: false,
      supportsCorporateActions: false,
      supportsInstrumentSearch: false,
      identifierTypes: ["TICKER", "MIC_TICKER"],
      maxHistoryYears: 0,
      quoteDelayMinutes: 0,
      quoteTypes: ["LAST", "CLOSE"],
    };
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 60, perMillis: 60_000, burst: 10 };
  }

  protected async fetchRaw(request: QuoteRequest): Promise<readonly Quote[]> {
    const today = CalendarDate.fromUtcInstant(new Date(this.runtime.now()));
    if (!request.range.contains(today)) return [];

    const quotes: Quote[] = [];
    for (const ref of request.instruments) {
      // Finnhub's standard real-time entitlement covers US stocks. Do not label
      // international quotes real-time without the corresponding vendor plan.
      if (ref.currency.code !== "USD") continue;
      const symbol = this.codeFor(ref);
      const payload = await this.getJson<FinnhubQuotePayload>(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`,
        { "X-Finnhub-Token": this.token },
      );
      if (!payload.c || payload.c <= 0) continue;
      const asOf = payload.t
        ? CalendarDate.fromUtcInstant(new Date(payload.t * 1000))
        : today;
      if (!request.range.contains(asOf)) continue;
      quotes.push(this.quote({
        ref,
        asOf,
        quoteType: request.quoteType === "LAST" ? "LAST" : "CLOSE",
        price: UnitPrice.of(payload.c.toString(), ref.currency),
      }));
    }
    return quotes;
  }
}

/* ═══ 1. MFAPI — mutual fund NAV ══════════════════════════════════════ */

interface MfApiPayload {
  meta?: { scheme_code?: string | number; scheme_name?: string };
  data?: { date: string; nav: string }[];
  status?: string;
}

/**
 * `api.mfapi.in/mf/{schemeCode}` — full NAV history, free, no key.
 *
 * Paisa and myFinance chose this independently, which is the strongest
 * recommendation a free endpoint gets. Primary for Indian mutual funds.
 *
 * Dates come back as `DD-MM-YYYY`, newest first. Both are handled here rather than
 * anywhere downstream: a provider's job is to turn its own format into ours.
 */
export class MfApiNavProvider extends PriceProvider {
  readonly id = "mfapi";
  readonly displayName = "MFAPI (Indian mutual fund NAV)";

  capabilities(): ProviderCapabilities {
    return {
      assetClasses: ["MUTUAL_FUND"],
      supportsIntraday: false,
      supportsHistorical: true,
      supportsCorporateActions: false,
      supportsInstrumentSearch: false,
      identifierTypes: ["SCHEME_CODE"],
      maxHistoryYears: 25,
      quoteDelayMinutes: 24 * 60,
      quoteTypes: ["NAV"],
    };
  }

  override rateLimit(): RateLimitBudget {
    // Undocumented, so a deliberately modest self-imposed limit: being a good
    // citizen of a free service is what keeps it available.
    return { requests: 30, perMillis: 60_000, burst: 5 };
  }

  protected async fetchRaw(request: QuoteRequest): Promise<readonly Quote[]> {
    const quotes: Quote[] = [];

    for (const ref of request.instruments) {
      const code = this.codeFor(ref);
      const payload = await this.getJson<MfApiPayload>(`https://api.mfapi.in/mf/${code}`);

      if (!payload.data || payload.data.length === 0) {
        throw ProviderError.unknownSymbol(this.id, code);
      }

      for (const row of payload.data) {
        const asOf = MfApiNavProvider.parseIndianDate(row.date);
        if (!asOf || !request.range.contains(asOf)) continue;
        // NAV is published to four decimals; `Money.fromRupees` keeps the exact
        // paise and refuses a value it cannot represent rather than truncating.
        // Four decimals, kept as four: this is the case `UnitPrice` exists for.
        quotes.push(
          this.quote({ ref, asOf, quoteType: "NAV", price: UnitPrice.of(row.nav, ref.currency) }),
        );
      }
    }

    return quotes;
  }

  /** `DD-MM-YYYY`, MFAPI's format. */
  static parseIndianDate(value: string): CalendarDate | null {
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value.trim());
    if (!match) return null;
    return CalendarDate.of(Number(match[3]), Number(match[2]), Number(match[1]));
  }
}

/* ═══ 2. AMFI — the scheme master, and its NAV file ═══════════════════ */

/**
 * `portal.amfiindia.com` — the authoritative Indian scheme master.
 *
 * AMFI is the source of record for what a scheme *is*, which is why it is here
 * rather than only MFAPI: an instrument master built from a convenience API inherits
 * that API's mistakes. The daily NAV file is semicolon-delimited text, one line per
 * scheme, and is the cross-check against MFAPI for the 1% divergence rule.
 */
export class AmfiNavProvider extends PriceProvider {
  readonly id = "amfi";
  readonly displayName = "AMFI (Indian scheme master and NAV)";

  capabilities(): ProviderCapabilities {
    return {
      assetClasses: ["MUTUAL_FUND"],
      supportsIntraday: false,
      supportsHistorical: false,
      supportsCorporateActions: false,
      supportsInstrumentSearch: true,
      identifierTypes: ["SCHEME_CODE", "ISIN"],
      // The daily file is today only. History needs the archive endpoint, which is
      // slow and rate-limited; MFAPI is the right source for history, and saying so
      // in `maxHistoryYears: 0` is what makes the registry ask MFAPI for it.
      maxHistoryYears: 0,
      quoteDelayMinutes: 24 * 60,
      quoteTypes: ["NAV"],
    };
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 10, perMillis: 60_000, burst: 2 };
  }

  protected async fetchRaw(request: QuoteRequest): Promise<readonly Quote[]> {
    const text = await this.getText("https://portal.amfiindia.com/spages/NAVAll.txt");
    const wanted = new Map(request.instruments.map((ref) => [this.codeFor(ref), ref]));
    const quotes: Quote[] = [];

    // Tracked separately from `quotes`: a scheme found but with no NAV published
    // today is a legitimate empty result, while a scheme not in the file at all is
    // an unknown code — and reporting both as "no data" would hide a typo forever.
    const found = new Set<string>();

    for (const line of text.split("\n")) {
      // `code;ISIN growth;ISIN reinvest;name;NAV;date`
      const parts = line.split(";");
      if (parts.length < 6) continue;
      const ref = wanted.get(parts[0].trim());
      if (!ref) continue;
      found.add(parts[0].trim());

      const asOf = AmfiNavProvider.parseAmfiDate(parts[5]);
      const nav = parts[4].trim();
      if (!asOf || !request.range.contains(asOf) || nav === "" || nav === "N.A.") continue;

      quotes.push(
        this.quote({ ref, asOf, quoteType: "NAV", price: UnitPrice.of(nav, ref.currency) }),
      );
    }

    const missing = [...wanted.keys()].filter((code) => !found.has(code));
    if (missing.length === wanted.size) {
      throw ProviderError.unknownSymbol(this.id, missing.join(", "));
    }

    return quotes;
  }

  private static readonly MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  /** `DD-MMM-YYYY`, e.g. `22-Aug-2026`. */
  static parseAmfiDate(value: string): CalendarDate | null {
    const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(value.trim());
    if (!match) return null;
    const month = AmfiNavProvider.MONTHS.findIndex(
      (name) => name.toLowerCase() === match[2].toLowerCase(),
    );
    if (month < 0) return null;
    return CalendarDate.of(Number(match[3]), month + 1, Number(match[1]));
  }
}

/* ═══ 3. Yahoo Finance — equities, everywhere ═════════════════════════ */

interface YahooChartPayload {
  chart?: {
    result?: {
      meta?: { currency?: string; symbol?: string };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[]; adjclose?: { adjclose?: (number | null)[] }[] };
    }[];
    error?: { code?: string; description?: string } | null;
  };
}

/**
 * `query2.finance.yahoo.com/v8/finance/chart/{symbol}`.
 *
 * **An undocumented internal endpoint**, and treated as such: it is registered at
 * low priority, as a fallback and a cross-check, never as the golden source. It
 * breaks without notice and rate-limits by IP. Paisa depends on it as a primary,
 * which is the single-point-of-failure class this whole layer exists to avoid.
 */
export class YahooQuoteProvider extends PriceProvider {
  readonly id = "yahoo";
  readonly displayName = "Yahoo Finance (unofficial)";

  capabilities(): ProviderCapabilities {
    return {
      assetClasses: [...EQUITY_CLASSES, "CRYPTO", "COMMODITY", "FX"],
      supportsIntraday: true,
      supportsHistorical: true,
      supportsCorporateActions: false,
      supportsInstrumentSearch: true,
      identifierTypes: ["TICKER", "MIC_TICKER"],
      maxHistoryYears: 30,
      quoteDelayMinutes: 15,
      quoteTypes: ["CLOSE", "ADJUSTED_CLOSE"],
    };
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 20, perMillis: 60_000, burst: 4 };
  }

  protected async fetchRaw(request: QuoteRequest): Promise<readonly Quote[]> {
    const quotes: Quote[] = [];

    for (const ref of request.instruments) {
      const symbol = this.codeFor(ref);
      const period1 = Math.floor(request.range.start.toUtcInstant().getTime() / 1000);
      // Inclusive of the end date: Yahoo's `period2` is exclusive.
      const period2 = Math.floor(request.range.end.plusDays(1).toUtcInstant().getTime() / 1000);
      const payload = await this.getJson<YahooChartPayload>(
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
          `?period1=${period1}&period2=${period2}&interval=1d`,
      );

      if (payload.chart?.error) {
        throw ProviderError.unknownSymbol(this.id, symbol);
      }
      const result = payload.chart?.result?.[0];
      if (!result?.timestamp || result.timestamp.length === 0) {
        throw ProviderError.unknownSymbol(this.id, symbol);
      }

      const wantAdjusted = request.quoteType === "ADJUSTED_CLOSE";
      const closes = wantAdjusted
        ? result.indicators?.adjclose?.[0]?.adjclose
        : result.indicators?.quote?.[0]?.close;
      if (!closes) {
        throw new ProviderError(
          "MALFORMED_RESPONSE",
          this.id,
          `${this.id} returned no ${request.quoteType} series for ${symbol}.`,
        );
      }

      // Yahoo reports the currency it priced in, so it is checked rather than
      // assumed: a GBP price silently taken as INR is the kind of error that
      // survives every test that does not look for it.
      //
      // Compared as a *string*, before any `Currency` is constructed: an
      // unrecognised code has to read as "this provider quoted something we cannot
      // hold this in", not as `Currency.of`'s registry-lookup failure, which sends
      // whoever reads it to the wrong file.
      const reported = result.meta?.currency?.toUpperCase() ?? ref.currency.code;
      if (reported !== ref.currency.code) {
        throw new ProviderError(
          "MALFORMED_RESPONSE",
          this.id,
          `${symbol} is held in ${ref.currency.code} but ${this.id} quoted ${reported}.`,
        );
      }

      for (let i = 0; i < result.timestamp.length; i += 1) {
        const close = closes[i];
        if (close === null || close === undefined) continue; // A market holiday.
        const asOf = CalendarDate.fromUtcInstant(new Date(result.timestamp[i] * 1000));
        if (!request.range.contains(asOf)) continue;
        quotes.push(
          this.quote({
            ref,
            asOf,
            quoteType: request.quoteType,
            price: UnitPrice.of(close.toFixed(8), ref.currency),
          }),
        );
      }
    }

    return quotes;
  }
}

/* ═══ 4. NSE India — the authoritative Indian close ═══════════════════ */

interface NsePayload {
  priceInfo?: { lastPrice?: number; close?: number };
  metadata?: { lastUpdateTime?: string };
}

/**
 * `nseindia.com/api/quote-equity` — the exchange itself.
 *
 * Authoritative for Indian equities and **cookie-gated**: the API refuses a request
 * that has not first been given a session by the home page. That priming is done
 * here, once per instance, because it is the provider's problem and not the caller's.
 *
 * Today's price only — NSE does not serve history through this endpoint, which its
 * `maxHistoryYears: 0` declares so the registry asks Yahoo for a backfill instead.
 */
export class NseQuoteProvider extends PriceProvider {
  readonly id = "nse";
  readonly displayName = "NSE India";

  private primed = false;

  capabilities(): ProviderCapabilities {
    return {
      assetClasses: EQUITY_CLASSES,
      supportsIntraday: true,
      supportsHistorical: false,
      supportsCorporateActions: true,
      supportsInstrumentSearch: true,
      identifierTypes: ["TICKER"],
      maxHistoryYears: 0,
      quoteDelayMinutes: 0,
      quoteTypes: ["CLOSE", "LAST"],
    };
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 12, perMillis: 60_000, burst: 3 };
  }

  protected async fetchRaw(request: QuoteRequest): Promise<readonly Quote[]> {
    if (!this.primed) {
      // The session cookie the API requires. A failure here is a normal provider
      // failure, so it goes through the same error mapping as everything else.
      await this.getText("https://www.nseindia.com/");
      this.primed = true;
    }

    const quotes: Quote[] = [];
    for (const ref of request.instruments) {
      const symbol = this.codeFor(ref);
      const payload = await this.getJson<NsePayload>(
        `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol)}`,
        { referer: "https://www.nseindia.com/" },
      );

      const price = payload.priceInfo?.close ?? payload.priceInfo?.lastPrice;
      if (price === undefined || price === null) throw ProviderError.unknownSymbol(this.id, symbol);

      // The endpoint reports the last trading session, so the date comes from the
      // payload rather than from "today" — asking on a Sunday must not date
      // Friday's close to Sunday.
      const asOf = NseQuoteProvider.parseUpdateTime(payload.metadata?.lastUpdateTime)
        ?? request.range.end;
      if (!request.range.contains(asOf)) return quotes;

      quotes.push(
        this.quote({
          ref,
          asOf,
          quoteType: request.quoteType === "LAST" ? "LAST" : "CLOSE",
          price: UnitPrice.of(price.toFixed(2), ref.currency),
        }),
      );
    }
    return quotes;
  }

  /** `DD-MMM-YYYY HH:mm:ss`, NSE's format. */
  static parseUpdateTime(value: string | undefined): CalendarDate | null {
    if (!value) return null;
    return AmfiNavProvider.parseAmfiDate(value.split(" ")[0]);
  }
}

/* ═══ 5. IBJA — Indian bullion ════════════════════════════════════════ */

interface IbjaPayload {
  rates?: { date: string; metal: string; purity?: string; rate: number }[];
}

/**
 * IBJA — the authoritative Indian bullion benchmark.
 *
 * The best find in the weakest of the four reference repos. Gold and silver rates
 * per gram, published daily, and the number Indian jewellers actually quote — which
 * makes it the right basis for valuing physical gold and for the 3% GST-inclusive
 * arithmetic a user will compare against.
 */
export class IbjaMetalProvider extends PriceProvider {
  readonly id = "ibja";
  readonly displayName = "IBJA (Indian bullion rates)";

  capabilities(): ProviderCapabilities {
    return {
      assetClasses: ["COMMODITY"],
      supportsIntraday: false,
      supportsHistorical: true,
      supportsCorporateActions: false,
      supportsInstrumentSearch: false,
      identifierTypes: ["METAL"],
      maxHistoryYears: 5,
      quoteDelayMinutes: 24 * 60,
      quoteTypes: ["CLOSE"],
    };
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 10, perMillis: 60_000, burst: 2 };
  }

  protected async fetchRaw(request: QuoteRequest): Promise<readonly Quote[]> {
    // IBJA removed the unauthenticated /api/rates endpoint. Its public rates page
    // remains the official source and publishes the same daily AM/PM table.
    const text = await this.getText("https://www.ibjarates.com/");
    const wanted = new Map(request.instruments.map((ref) => [normaliseMetalCode(this.codeFor(ref)), ref]));
    const quotes: Quote[] = [];

    // Keep the JSON branch for compatible mirrors and deterministic provider
    // conformance fixtures; production currently takes the HTML branch.
    const jsonRows = text.trimStart().startsWith("{")
      ? (JSON.parse(text) as IbjaPayload).rates ?? []
      : null;
    const rows = jsonRows ?? parseIbjaRatesPage(text) ?? [];
    for (const row of rows) {
      const key = normaliseMetalCode(row.purity ? `${row.metal}${row.purity}` : row.metal);
      const ref = wanted.get(key) ?? wanted.get(normaliseMetalCode(row.metal));
      if (!ref) continue;
      const asOf = CalendarDate.parse(row.date);
      if (!request.range.contains(asOf)) continue;
      const divisor = key.startsWith("SILVER") ? 1000 : 10;
      const perGram = jsonRows ? row.rate : row.rate / divisor;
      quotes.push(
        this.quote({ ref, asOf, quoteType: "CLOSE", price: UnitPrice.of(perGram.toFixed(2), ref.currency) }),
      );
    }

    if (quotes.length === 0) {
      throw ProviderError.unknownSymbol(this.id, [...wanted.keys()].join(", "));
    }
    return quotes;
  }
}

function normaliseMetalCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Extracts the official 30-day tables; later PM rows replace AM rows for a date. */
function parseIbjaRatesPage(html: string): IbjaPayload["rates"] {
  const byDateAndMetal = new Map<string, { date: string; metal: string; purity: string; rate: number }>();
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  for (const match of html.matchAll(rowPattern)) {
    const row = match[1];
    const dateMatch = /<strong>\s*(\d{2})\/(\d{2})\/(\d{4})\s*<\/strong>/i.exec(row);
    if (!dateMatch) continue;
    const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
    const cellPattern = /data-label="(Gold|Silver|Platinum)\s*(\d{3})"[^>]*>\s*([\d,.]+)/gi;
    for (const cell of row.matchAll(cellPattern)) {
      const metal = cell[1].toUpperCase();
      const purity = cell[2];
      const rate = Number(cell[3].replace(/,/g, ""));
      if (Number.isFinite(rate) && rate > 0) {
        byDateAndMetal.set(`${date}:${metal}:${purity}`, { date, metal, purity, rate });
      }
    }
  }
  return [...byDateAndMetal.values()];
}

/* ═══ 6. CoinGecko — crypto ═══════════════════════════════════════════ */

interface CoinGeckoPayload {
  prices?: [number, number][];
}

/**
 * `api.coingecko.com/api/v3/coins/{id}/market_chart/range`.
 *
 * Crypto is absent from all four reference repos, and it is not optional for an
 * Indian portfolio: VDA gains are taxed at 30% flat with no set-off, so a holding
 * the app cannot price is a tax line the user has to compute by hand.
 *
 * CoinGecko returns `[epochMillis, price]` pairs, several per day on short ranges.
 * The last of each day wins, which is the day's close.
 */
export class CoinGeckoProvider extends PriceProvider {
  readonly id = "coingecko";
  readonly displayName = "CoinGecko";

  capabilities(): ProviderCapabilities {
    return {
      assetClasses: ["CRYPTO"],
      supportsIntraday: true,
      supportsHistorical: true,
      supportsCorporateActions: false,
      supportsInstrumentSearch: true,
      identifierTypes: ["COIN"],
      maxHistoryYears: 10,
      quoteDelayMinutes: 5,
      quoteTypes: ["CLOSE", "LAST"],
    };
  }

  override rateLimit(): RateLimitBudget {
    // The free tier's published limit is 10–30/min; the low end, deliberately.
    return { requests: 10, perMillis: 60_000, burst: 3 };
  }

  protected async fetchRaw(request: QuoteRequest): Promise<readonly Quote[]> {
    const quotes: Quote[] = [];

    for (const ref of request.instruments) {
      const coin = this.codeFor(ref).toLowerCase();
      const from = Math.floor(request.range.start.toUtcInstant().getTime() / 1000);
      const to = Math.floor(request.range.end.plusDays(1).toUtcInstant().getTime() / 1000);
      const payload = await this.getJson<CoinGeckoPayload>(
        `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(coin)}/market_chart/range` +
          `?vs_currency=${ref.currency.code.toLowerCase()}&from=${from}&to=${to}`,
      );

      if (!payload.prices || payload.prices.length === 0) {
        throw ProviderError.unknownSymbol(this.id, coin);
      }

      for (const [millis, price] of payload.prices) {
        const asOf = CalendarDate.fromUtcInstant(new Date(millis));
        if (!request.range.contains(asOf)) continue;
        quotes.push(
          this.quote({
            ref,
            asOf,
            quoteType: request.quoteType === "LAST" ? "LAST" : "CLOSE",
            price: UnitPrice.of(price.toFixed(8), ref.currency),
          }),
        );
      }
    }

    // Several points per day collapse to the last one — the base class's
    // deduplication keeps the last row per `(instrument, as_of)`.
    return quotes;
  }
}

/* ═══ 7. Manual — the user's own number ═══════════════════════════════ */

/**
 * The user as a provider.
 *
 * Not a stub: a flat, unlisted shares and a collection have no feed, and the number
 * the user asserts is the only one there is. Modelling it as a provider means it
 * goes through the same validation, the same ladder and the same staleness rules as
 * a vendor price — so a five-year-old assertion is *marked stale* rather than
 * treated as current.
 *
 * It touches no network, so it never fails, never rate-limits, and always ranks
 * first for the instruments it covers.
 */
export class ManualProvider extends PriceProvider {
  readonly id = "manual";
  readonly displayName = "Your own valuations";

  constructor(
    runtime: ProviderRuntime,
    /** Asserted prices, by instrument id. */
    private readonly asserted: ReadonlyMap<string, readonly { asOf: CalendarDate; price: UnitPrice }[]>,
    options?: ProviderOptions,
  ) {
    super(runtime, options);
  }

  capabilities(): ProviderCapabilities {
    return {
      assetClasses: ["EQUITY", "ETF", "MUTUAL_FUND", "BOND", "COMMODITY", "CRYPTO", "FX", "OTHER"],
      supportsIntraday: false,
      supportsHistorical: true,
      supportsCorporateActions: false,
      supportsInstrumentSearch: false,
      identifierTypes: ["TICKER", "ISIN", "SCHEME_CODE", "METAL", "COIN", "FIGI", "MIC_TICKER"],
      maxHistoryYears: 100,
      quoteDelayMinutes: 0,
      quoteTypes: ["CLOSE", "NAV", "MARK", "LAST", "MID", "BID", "ASK", "SETTLEMENT", "ADJUSTED_CLOSE"],
    };
  }

  override rateLimit(): RateLimitBudget {
    return { requests: Number.MAX_SAFE_INTEGER, perMillis: 1, burst: Number.MAX_SAFE_INTEGER };
  }

  protected async fetchRaw(request: QuoteRequest): Promise<readonly Quote[]> {
    const quotes: Quote[] = [];
    for (const ref of request.instruments) {
      for (const entry of this.asserted.get(ref.instrumentId) ?? []) {
        if (!request.range.contains(entry.asOf)) continue;
        quotes.push({
          ...this.quote({ ref, asOf: entry.asOf, quoteType: request.quoteType, price: entry.price }),
          sourceType: "MANUAL",
        });
      }
    }
    return quotes;
  }
}

/* ═══ 8. ECB — foreign exchange ═══════════════════════════════════════ */

/**
 * The European Central Bank's daily reference rates.
 *
 * Free, authoritative, documented, and stable — the opposite of every equity
 * endpoint above. It publishes **EUR-based rates only**, so USD/INR is
 * `(EUR/INR) ÷ (EUR/USD)`, and that derivation is recorded on the row rather than
 * silently applied: invariant Q06 (a rate and its inverse agree within 0.1%) is only
 * checkable if the division is visible.
 */
export class EcbFxProvider implements FxProviderPort {
  readonly id = "ecb";
  readonly displayName = "European Central Bank";

  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly runtime: ProviderRuntime,
    private readonly timeoutMs = 10_000,
  ) {
    this.breaker = new CircuitBreaker(runtime);
  }

  capabilities(): ProviderCapabilities {
    return {
      assetClasses: ["FX"],
      supportsIntraday: false,
      supportsHistorical: true,
      supportsCorporateActions: false,
      supportsInstrumentSearch: false,
      identifierTypes: ["TICKER"],
      maxHistoryYears: 25,
      quoteDelayMinutes: 24 * 60,
      quoteTypes: ["CLOSE"],
    };
  }

  health(): HealthStatus {
    return this.breaker.health();
  }

  rateLimit(): RateLimitBudget {
    return { requests: 30, perMillis: 60_000, burst: 5 };
  }

  async fetchRates(request: {
    base: string;
    quotes: readonly string[];
    range: DateRange;
  }): Promise<Result<readonly FxQuote[], ProviderError>> {
    if (!this.breaker.allowsRequest) {
      return Err(ProviderError.circuitOpen(this.id, this.breaker.openUntil ?? new Date(this.runtime.now())));
    }

    try {
      const xml = await this.runtime.http
        .get("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml", { timeoutMs: this.timeoutMs })
        .then((response) => {
          if (response.status >= 400) {
            throw new ProviderError("UPSTREAM", this.id, `ECB returned ${response.status}.`, response.status >= 500);
          }
          return response.body;
        });

      const perDay = EcbFxProvider.parse(xml);
      const rates: FxQuote[] = [];
      const ingestedAt = new Date(this.runtime.now());

      for (const [isoDate, byCurrency] of perDay) {
        const asOf = CalendarDate.parse(isoDate);
        if (!request.range.contains(asOf)) continue;

        for (const quoteCurrency of request.quotes) {
          if (request.base === quoteCurrency) continue;

          // EUR is the pivot, and both legs are recorded in `derivation` so the
          // inverse check can see how the number was made.
          const eurToBase = request.base === "EUR" ? 1 : byCurrency.get(request.base);
          const eurToQuote = quoteCurrency === "EUR" ? 1 : byCurrency.get(quoteCurrency);
          if (eurToBase === undefined || eurToQuote === undefined) continue;

          rates.push({
            base: request.base,
            quote: quoteCurrency,
            asOf,
            rate: Quantity.fromString((eurToQuote / eurToBase).toFixed(8)),
            providerId: this.id,
            sourceType: request.base === "EUR" ? "PROVIDER" : "DERIVED",
            ingestedAt,
            derivation:
              request.base === "EUR"
                ? null
                : `(EUR/${quoteCurrency} = ${eurToQuote}) ÷ (EUR/${request.base} = ${eurToBase})`,
          });
        }
      }

      if (rates.length === 0) {
        this.breaker.recordFailure("no rates in range");
        return Err(
          new ProviderError(
            "UNKNOWN_SYMBOL",
            this.id,
            `ECB published no rates for ${request.quotes.join(", ")} in ${request.range.toString()}.`,
          ),
        );
      }

      this.breaker.recordSuccess();
      return Ok(rates.sort((a, b) => a.asOf.compareTo(b.asOf)));
    } catch (thrown) {
      const error =
        thrown instanceof ProviderError
          ? thrown
          : new ProviderError("UPSTREAM", this.id, `ECB: ${(thrown as Error).message}`, true, { cause: thrown });
      this.breaker.recordFailure(error.message);
      return Err(error);
    }
  }

  /**
   * ECB's `eurofxref` XML: `<Cube time="…"><Cube currency="INR" rate="…"/>…`.
   *
   * Parsed with a regular expression rather than an XML library, because the
   * document is machine-generated with a fixed shape and adding a parser dependency
   * to read two attributes is a dependency to keep patched forever.
   */
  static parse(xml: string): Map<string, Map<string, number>> {
    const perDay = new Map<string, Map<string, number>>();
    const dayPattern = /<Cube\s+time=['"]([\d-]+)['"]\s*>([\s\S]*?)<\/Cube>/g;
    const ratePattern = /<Cube\s+currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]\s*\/?>/g;

    for (const day of xml.matchAll(dayPattern)) {
      const rates = new Map<string, number>();
      for (const rate of day[2].matchAll(ratePattern)) {
        rates.set(rate[1], Number(rate[2]));
      }
      if (rates.size > 0) perDay.set(day[1], rates);
    }
    return perDay;
  }
}

/* ═══ The registry ════════════════════════════════════════════════════ */

/**
 * The shipped provider set, in priority order per need.
 *
 * Priority is a judgement, and it is recorded here rather than configured: NSE
 * before Yahoo because the exchange beats a scraped internal endpoint; MFAPI before
 * AMFI for history because AMFI's daily file has none; AMFI kept anyway because a
 * second opinion is what the 1% divergence check compares against. Two providers
 * minimum per need is `40-MARKET-DATA.md` §1.1, and this is where that promise is
 * either kept or quietly broken.
 */
export function shippedQuoteProviders(
  runtime: ProviderRuntime,
  manual: ReadonlyMap<string, readonly { asOf: CalendarDate; price: UnitPrice }[]> = new Map(),
  options?: ProviderOptions,
  credentials: { finnhubToken?: string } = {},
): readonly QuoteProviderPort[] {
  const providers: QuoteProviderPort[] = [
    // The user's own assertion outranks every feed: for an unpriceable asset it is
    // the only truth, and for a priceable one they had a reason.
    new ManualProvider(runtime, manual, options),
  ];
  if (credentials.finnhubToken) {
    providers.push(new FinnhubQuoteProvider(runtime, credentials.finnhubToken, options));
  }
  providers.push(
    new NseQuoteProvider(runtime, options),
    new MfApiNavProvider(runtime, options),
    new AmfiNavProvider(runtime, options),
    new IbjaMetalProvider(runtime, options),
    new CoinGeckoProvider(runtime, options),
    new YahooQuoteProvider(runtime, options),
  );
  return providers;
}

export function shippedFxProviders(runtime: ProviderRuntime): readonly FxProviderPort[] {
  return [new EcbFxProvider(runtime)];
}

/**
 * Which providers cover an asset class, for the "two minimum" check.
 *
 * A function rather than a comment, so `tests/providers-conformance.spec.ts` can
 * assert the promise instead of trusting it.
 */
export function providersFor(
  providers: readonly QuoteProviderPort[],
  assetClass: PricedAssetClass,
): readonly QuoteProviderPort[] {
  return providers.filter((provider) => provider.capabilities().assetClasses.includes(assetClass));
}

/* ═══ 9. AMFI historical NAV — the citable archive ════════════════════ */

/**
 * `portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx`.
 *
 * The archive {@link AmfiNavProvider} deliberately does not have: an arbitrary
 * date range for one AMC, which is what a benchmark replay over the user's own
 * purchase dates needs. MFAPI can serve history too, but how *much* history is a
 * lottery on scheme age — one gold fund answers with 105 NAVs and another with
 * 978 — so for a replay that must reach a specific first-purchase date, this is
 * the source that can be asked for a range and told to produce it.
 *
 * Two things about the format, both measured rather than assumed:
 *
 *   - It is `;`-delimited **with section headings interleaved** as bare lines
 *     (`Open Ended Schemes ( Exchange Traded Funds (ETFs) - Gold ETF )`). A parser
 *     that assumed every line is a scheme would read a heading as a fund.
 *   - The column order is read from the header row rather than hardcoded, because
 *     this report and the daily `NAVAll.txt` do not share one.
 *
 * Only the `portal.` host serves it; `www.amfiindia.com` returns 404 for the same
 * path. And **the old-format download is stated to sunset on 30 September 2026** —
 * which affects `AmfiNavProvider` above as much as this class, and is a
 * requirement of its own rather than something to paper over here.
 *
 * The instrument's code for this provider is `"<amcId>:<schemeCode>"`, because the
 * endpoint is keyed by AMC and filtered by scheme.
 */
export class AmfiNavHistoryProvider extends PriceProvider {
  readonly id = "amfi-history";
  readonly displayName = "AMFI (historical NAV archive)";

  capabilities(): ProviderCapabilities {
    return {
      assetClasses: ["MUTUAL_FUND", "ETF"],
      supportsIntraday: false,
      supportsHistorical: true,
      supportsCorporateActions: false,
      supportsInstrumentSearch: false,
      identifierTypes: ["SCHEME_CODE"],
      maxHistoryYears: 20,
      quoteDelayMinutes: 24 * 60,
      quoteTypes: ["NAV"],
    };
  }

  override rateLimit(): RateLimitBudget {
    // The report is close to a megabyte per AMC-month. Asking slowly is the only
    // polite way to use it, and the replay needs it once a day at most.
    return { requests: 6, perMillis: 60_000, burst: 2 };
  }

  protected async fetchRaw(request: QuoteRequest): Promise<readonly Quote[]> {
    const quotes: Quote[] = [];

    for (const ref of request.instruments) {
      const [amcId, schemeCode] = this.codeFor(ref).split(":");
      if (!amcId || !schemeCode) {
        throw new ProviderError(
          "UNSUPPORTED",
          this.id,
          `${this.id} needs an "<amcId>:<schemeCode>" reference for ${ref.symbol}; got "${this.codeFor(ref)}".`,
        );
      }

      const text = await this.getText(
        "https://portal.amfiindia.com/DownloadNAVHistoryReport_Po.aspx" +
          `?mf=${encodeURIComponent(amcId)}&tp=1` +
          `&frmdt=${AmfiNavHistoryProvider.formatDate(request.range.start)}` +
          `&todt=${AmfiNavHistoryProvider.formatDate(request.range.end)}`,
      );

      const rows = AmfiNavHistoryProvider.parseReport(text);
      if (rows.length === 0) {
        throw new ProviderError(
          "MALFORMED_RESPONSE",
          this.id,
          `${this.id} returned no parseable rows for AMC ${amcId} (${text.slice(0, 80)}…).`,
        );
      }

      let matched = 0;
      for (const row of rows) {
        if (row.schemeCode !== schemeCode) continue;
        matched += 1;
        if (!request.range.contains(row.on)) continue;
        quotes.push(
          this.quote({ ref, asOf: row.on, quoteType: "NAV", price: UnitPrice.of(row.nav, ref.currency) }),
        );
      }
      if (matched === 0) throw ProviderError.unknownSymbol(this.id, schemeCode);
    }

    return quotes;
  }

  /** `DD-Mon-YYYY`, which is the only date format the endpoint accepts. */
  static formatDate(date: CalendarDate): string {
    const [year, month, day] = date.toISO().split("-");
    return `${day}-${AMFI_MONTHS[Number(month) - 1]}-${year}`;
  }

  /**
   * The `;`-delimited report, minus its section headings.
   *
   * Column positions come from the header row rather than from a constant: the
   * daily file and this report disagree about them, and a fixed index that silently
   * read the repurchase price instead of the NAV would produce numbers that look
   * entirely plausible.
   */
  static parseReport(text: string): readonly { schemeCode: string; nav: string; on: CalendarDate }[] {
    const lines = text.split(/\r?\n/);
    const headerIndex = lines.findIndex(
      (line) => line.includes(";") && /scheme\s*code/i.test(line),
    );
    if (headerIndex < 0) return [];

    const header = lines[headerIndex].split(";").map((cell) => cell.trim().toLowerCase());
    const codeAt = header.findIndex((cell) => /scheme\s*code/.test(cell));
    const navAt = header.findIndex((cell) => /net\s*asset\s*value/.test(cell));
    const dateAt = header.findIndex((cell) => cell === "date");
    if (codeAt < 0 || navAt < 0 || dateAt < 0) return [];

    const rows: { schemeCode: string; nav: string; on: CalendarDate }[] = [];
    for (const line of lines.slice(headerIndex + 1)) {
      const parts = line.split(";");
      // A section heading has no delimiters at all, and a blank line has none
      // either. Both are skipped here rather than being read as a scheme.
      if (parts.length <= Math.max(codeAt, navAt, dateAt)) continue;
      const schemeCode = parts[codeAt].trim();
      const nav = parts[navAt].trim();
      const on = AmfiNavProvider.parseAmfiDate(parts[dateAt]);
      if (!on || schemeCode === "" || nav === "" || nav === "N.A." || !/^\d/.test(schemeCode)) continue;
      rows.push({ schemeCode, nav, on });
    }
    return rows;
  }
}

const AMFI_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/* ═══ The benchmark feed ══════════════════════════════════════════════ */

/**
 * The two external series the gold benchmark replay needs, and nothing more.
 *
 * `GoldBenchmarkReplay` gets its bullion series from the app's own recorded gram
 * quotes, so the only feeds it needs from outside are a gold ETF and the Nifty 50
 * — both of which Yahoo serves, and both of which were measured to work keyless.
 *
 * Three properties this adapter owes the use case:
 *
 *   - **A failure is a value.** Every provider error becomes an `{ ok: false,
 *     because }` outcome carrying the reason in plain English, so an outage costs
 *     the page one row rather than the whole render.
 *   - **One fetch per day.** The results are cached against the runtime's own
 *     calendar day, per key and range, because a holding page that refetches five
 *     years of daily closes on every reload is how an unofficial endpoint starts
 *     rate-limiting the user.
 *   - **No `null` closes.** `YahooQuoteProvider` already drops market holidays, so
 *     the points handed on are real observations; the series' own last date is the
 *     "as of" stamp, never `asOf` itself.
 *
 * `AmfiNavHistoryProvider` is wired as the ETF fallback and used only when an
 * `"<amcId>:<schemeCode>"` reference is supplied, because there is no shipped
 * AMC id this code could assert without inventing one.
 */
export class ProviderBenchmarkFeed implements BenchmarkSeriesFeed {
  private readonly yahoo: YahooQuoteProvider;
  private readonly amfiHistory: AmfiNavHistoryProvider;
  private readonly cache = new Map<string, { day: number; outcome: BenchmarkSeriesOutcome }>();

  constructor(
    private readonly runtime: ProviderRuntime,
    options?: ProviderOptions,
    private readonly symbols: BenchmarkSymbols = DEFAULT_BENCHMARK_SYMBOLS,
  ) {
    this.yahoo = new YahooQuoteProvider(runtime, options);
    this.amfiHistory = new AmfiNavHistoryProvider(runtime, options);
  }

  async load(request: {
    readonly keys: readonly BenchmarkSeriesKey[];
    readonly range: DateRange;
    readonly currency: Currency;
  }): Promise<ReadonlyMap<BenchmarkSeriesKey, BenchmarkSeriesOutcome>> {
    const day = Math.floor(this.runtime.now() / 86_400_000);
    const results = new Map<BenchmarkSeriesKey, BenchmarkSeriesOutcome>();

    for (const key of request.keys) {
      const cacheKey = `${key}|${request.range.toString()}|${request.currency.code}`;
      const cached = this.cache.get(cacheKey);
      if (cached && cached.day === day) {
        results.set(key, cached.outcome);
        continue;
      }
      const outcome = await this.fetchOne(key, request.range, request.currency);
      this.cache.set(cacheKey, { day, outcome });
      results.set(key, outcome);
    }
    return results;
  }

  private async fetchOne(
    key: BenchmarkSeriesKey,
    range: DateRange,
    currency: Currency,
  ): Promise<BenchmarkSeriesOutcome> {
    const spec = this.symbols[key];
    const ref: InstrumentRef = {
      instrumentId: `benchmark:${key}`,
      symbol: spec.symbol,
      assetClass: spec.assetClass,
      currency,
      identifierType: "TICKER",
      providerRefs: {
        yahoo: spec.symbol,
        ...(spec.amfiCode ? { "amfi-history": spec.amfiCode } : {}),
      },
    };

    const attempts: { provider: PriceProvider; quoteType: QuoteType }[] = [
      { provider: this.yahoo, quoteType: "CLOSE" },
    ];
    if (spec.amfiCode) {
      attempts.push({ provider: this.amfiHistory, quoteType: "NAV" });
    }

    const reasons: string[] = [];
    for (const attempt of attempts) {
      // A throw from a provider would be a bug in the base class rather than an
      // outage, but a benchmark row is not worth a failed page render either way.
      let result;
      try {
        result = await attempt.provider.fetchQuotes({
          instruments: [ref],
          range,
          quoteType: attempt.quoteType,
        });
      } catch (thrown) {
        reasons.push(`${attempt.provider.id} threw: ${(thrown as Error).message}`);
        continue;
      }
      if (!result.ok) {
        reasons.push(result.error.message);
        continue;
      }
      const points = result.value
        .filter((quote) => quote.price.isPositive)
        .map((quote) => ({ on: quote.asOf, price: quote.price }));
      if (points.length === 0) {
        reasons.push(`${attempt.provider.id} returned no usable prices for ${spec.symbol}.`);
        continue;
      }
      return {
        ok: true,
        series: { key, symbol: spec.symbol, sourceId: attempt.provider.id, points },
      };
    }

    return {
      ok: false,
      because:
        `No price series for ${spec.symbol} could be fetched, so this row is left out rather ` +
        `than shown as zero. ${reasons.join(" ")}`,
    };
  }
}

export interface BenchmarkSymbolSpec {
  readonly symbol: string;
  readonly assetClass: PricedAssetClass;
  /** `"<amcId>:<schemeCode>"`, when an AMFI archive fallback is configured. */
  readonly amfiCode?: string;
}

export type BenchmarkSymbols = Readonly<Record<BenchmarkSeriesKey, BenchmarkSymbolSpec>>;

/**
 * The shipped symbols, and why these two.
 *
 * `GOLDBEES.NS` is the oldest and most liquid Indian gold ETF, so it has the
 * deepest history to replay against; `^NSEI` is the Nifty 50 itself rather than a
 * fund tracking it, which keeps the index row free of any one fund's tracking
 * error. Both were measured to return five years of daily closes keyless.
 */
export const DEFAULT_BENCHMARK_SYMBOLS: BenchmarkSymbols = {
  GOLD_ETF: { symbol: "GOLDBEES.NS", assetClass: "ETF" },
  NIFTY_50: { symbol: "^NSEI", assetClass: "EQUITY" },
};
