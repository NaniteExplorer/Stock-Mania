/**
 * The resilience base every market-data adapter inherits.
 *
 * This is the same design — and the same four mechanisms — as
 * `PriceProvider` in `src/infra/providers.ts`, and it reuses that file's
 * `TokenBucket`, `CircuitBreaker`, `ProviderRuntime` and `ProviderOptions`
 * unchanged rather than re-implementing them. It exists as a separate base only
 * because `PriceProvider`'s single entry point is shaped as
 * `fetchQuotes(QuoteRequest) -> Quote[]`, and the ports here return six different
 * shapes (candidates, bars, FX rates, master rows, FIGI matches, actions). A
 * subclass of `PriceProvider` would have had to smuggle those through a
 * `Quote[]`, which is exactly the kind of lie this layer exists to remove.
 *
 * What a concrete adapter therefore writes is the parsing, and nothing else:
 * `run()` gives it the circuit breaker, the token bucket, the per-attempt
 * timeout, full-jitter backoff and the typed-error taxonomy.
 *
 * The HTTP client is injected and is `FetchHttpClient` in production. **Its
 * browser-shaped User-Agent is load-bearing** (C13): a 23-byte
 * `Edge: Too Many Requests` body means the User-Agent was wrong, not that we were
 * going too fast, so {@link MarketDataSource.assertStatus} says so in the message
 * instead of letting the next reader add a sleep.
 */

import { Err, Ok } from "@/core/kernel";
import { CalendarDate, DateRange } from "@/core/time";
import { HealthStatus, ProviderError, RateLimitBudget } from "@/domain/pricing";
import { CircuitBreaker, ProviderOptions, ProviderRuntime, TokenBucket } from "@/infra/providers";
import type { MarketDataPort, MarketDataResult, MarketDataSourceInfo } from "@/market-data/ports";

/** The Akamai/Yahoo body that means "your User-Agent is wrong", not "slow down". */
const WRONG_USER_AGENT_BODY = "Edge: Too Many Requests";

/**
 * The one CSV reader the archive adapters share.
 *
 * The Indian exchange archives all ship plain comma-separated files with a header
 * row, unquoted, and several of them pad every field with spaces (`  RELIANCE `).
 * Quoted fields are handled anyway because a company name with a comma in it does
 * appear in `EQUITY_L.csv`, and the day that row arrives is not the day to discover
 * that the reader splits on every comma.
 *
 * Returns one record per row keyed by the trimmed, upper-cased header.
 */
export function parseDelimited(body: string): readonly Record<string, string>[] {
  const lines = body.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const splitRow = (line: string): string[] => {
    const fields: string[] = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (quoted) {
        if (char === '"') {
          if (line[i + 1] === '"') {
            field += '"';
            i += 1;
          } else quoted = false;
        } else field += char;
        continue;
      }
      if (char === '"') quoted = true;
      else if (char === ",") {
        fields.push(field);
        field = "";
      } else field += char;
    }
    fields.push(field);
    return fields.map((value) => value.trim());
  };

  const headers = splitRow(lines[0]).map((header) => header.toUpperCase());
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const values = splitRow(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

/**
 * The weekdays in a range, ascending.
 *
 * The exchange archives are one file per trading day, so a range has to be walked.
 * Weekends are skipped because they are never files; holidays are *not* filtered
 * here, because `MarketCalendar`'s coverage ends at a known date and a missing
 * file is already an ordinary answer (see `tryGetText`). Skipping a weekend saves
 * two fetches in five; guessing at holidays would risk skipping a day that traded.
 */
export function weekdaysIn(range: DateRange): readonly CalendarDate[] {
  const days: CalendarDate[] = [];
  for (let day = range.start; day.isOnOrBefore(range.end); day = day.plusDays(1)) {
    const weekday = day.toUtcInstant().getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    days.push(day);
  }
  return days;
}

export abstract class MarketDataSource implements MarketDataPort {
  abstract readonly info: MarketDataSourceInfo;

  protected readonly breaker: CircuitBreaker;
  private readonly bucket: TokenBucket;
  private readonly maxAttempts: number;
  protected readonly requestTimeoutMs: number;
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

  /** Overridden by a source with a known published limit. Politeness, not a ceiling. */
  rateLimit(): RateLimitBudget {
    return { requests: 60, perMillis: 60_000, burst: 10 };
  }

  health(): HealthStatus {
    return this.breaker.health();
  }

  /**
   * Breaker, bucket, timeout, retry — around whatever the adapter does.
   *
   * 4xx is not retried except 429: retrying a 404 makes the same wrong answer
   * arrive three times more slowly.
   */
  protected async run<T>(work: () => Promise<T>): Promise<MarketDataResult<T>> {
    if (!this.breaker.allowsRequest) {
      return Err(
        ProviderError.circuitOpen(
          this.info.id,
          this.breaker.openUntil ?? new Date(this.runtime.now()),
        ),
      );
    }

    let lastError: ProviderError | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      await this.bucket.take();
      try {
        const value = await this.withTimeout(work());
        this.breaker.recordSuccess();
        return Ok(value);
      } catch (thrown) {
        const error = this.asProviderError(thrown);
        lastError = error;
        this.breaker.recordFailure(error.message);
        if (!error.retryable || attempt === this.maxAttempts) break;
        // Full jitter: a uniform draw from [0, base × 2^n). Deterministic backoff
        // synchronises every client into one retry wave.
        const ceiling = this.baseBackoffMs * 2 ** (attempt - 1);
        await this.runtime.sleep(Math.floor(this.runtime.random() * ceiling));
      }
    }

    return Err(
      lastError ?? new ProviderError("UPSTREAM", this.info.id, `${this.info.id} failed.`, true),
    );
  }

  private async withTimeout<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new ProviderError(
              "TIMEOUT",
              this.info.id,
              `${this.info.id} did not respond in ${this.requestTimeoutMs}ms.`,
              true,
            ),
          ),
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
    return new ProviderError("UPSTREAM", this.info.id, `${this.info.id}: ${message}`, true, {
      cause: thrown,
    });
  }

  /* ── Helpers for adapters ──────────────────────────────────────── */

  protected async getJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
    const body = await this.getText(url, headers);
    try {
      return JSON.parse(body) as T;
    } catch (cause) {
      throw new ProviderError(
        "MALFORMED_RESPONSE",
        this.info.id,
        `${this.info.id} returned a body that is not JSON (${body.slice(0, 80)}…).`,
        false,
        { cause },
      );
    }
  }

  protected async getText(url: string, headers?: Record<string, string>): Promise<string> {
    const response = await this.runtime.http.get(url, {
      headers,
      timeoutMs: this.requestTimeoutMs,
    });
    this.assertStatus(response.status, url, response.body);
    return response.body;
  }

  /**
   * Text from a URL whose *payload* may be compressed, not merely its transport.
   *
   * `assets.upstox.com` serves `NSE.json.gz` and `BSE.json.gz` as raw gzip bytes
   * with `content-type: application/gzip` and **no** `content-encoding` header —
   * measured, 1 940 184 bytes starting `1f 8b`. `fetch` therefore does not
   * decompress it, `response.text()` mangles it, and `JSON.parse` throws. That is
   * the whole of defect D-6: the master silently never ingested.
   *
   * A client without `getDecoded` (the test fixtures) falls back to `get`, which
   * is right for a plain-JSON fixture.
   */
  protected async getDecodedText(url: string, headers?: Record<string, string>): Promise<string> {
    const http = this.runtime.http;
    const response = http.getDecoded
      ? await http.getDecoded(url, { headers, timeoutMs: this.requestTimeoutMs })
      : await http.get(url, { headers, timeoutMs: this.requestTimeoutMs });
    this.assertStatus(response.status, url, response.body);
    return response.body;
  }

  /**
   * HTTP status to a typed error — plus the one body sniff that matters.
   *
   * Measured: 775 Yahoo requests in an hour from one IP produced zero 429s, while a
   * single request carrying a `curl` User-Agent 429'd cold, 3 of 3. So a 429 whose
   * body is the Akamai edge string is reported as a User-Agent defect and marked
   * **not** retryable — three more identical requests would fail identically.
   */
  protected assertStatus(status: number, url: string, body = ""): void {
    if (status === 429) {
      if (body.includes(WRONG_USER_AGENT_BODY)) {
        throw new ProviderError(
          "UPSTREAM",
          this.info.id,
          `${this.info.id} rejected the request at the edge ("${WRONG_USER_AGENT_BODY}"). ` +
            `That is a User-Agent problem, not a rate limit — check FetchHttpClient's header.`,
          false,
        );
      }
      throw new ProviderError(
        "RATE_LIMITED",
        this.info.id,
        `${this.info.id} rate-limited the request.`,
        true,
      );
    }
    if (status === 404) {
      throw new ProviderError(
        "UNKNOWN_SYMBOL",
        this.info.id,
        `${this.info.id} has no data at ${url}.`,
        false,
      );
    }
    if (status >= 400 && status < 500) {
      throw new ProviderError(
        "UPSTREAM",
        this.info.id,
        `${this.info.id} rejected the request (${status}).`,
        false,
      );
    }
    if (status >= 500) {
      throw new ProviderError("UPSTREAM", this.info.id, `${this.info.id} is failing (${status}).`, true);
    }
  }

  /**
   * A GET whose "not found" is an ordinary answer rather than a failure.
   *
   * The exchange archives publish one file per trading day, and a day with no file
   * is a holiday, not an outage: 404 means "the market was shut", and treating it
   * as a provider failure would open the breaker on a perfectly healthy source
   * every Republic Day.
   */
  protected async tryGetText(url: string, headers?: Record<string, string>): Promise<string | null> {
    const response = await this.runtime.http.get(url, {
      headers,
      timeoutMs: this.requestTimeoutMs,
    });
    if (response.status === 404 || response.status === 403) return null;
    this.assertStatus(response.status, url, response.body);
    return response.body;
  }

  /** A POST is rare here (OpenFIGI only), so it is spelled out where it is used. */
  protected malformed(why: string, cause?: unknown): ProviderError {
    return new ProviderError("MALFORMED_RESPONSE", this.info.id, `${this.info.id}: ${why}`, false, {
      cause,
    });
  }

  protected unknownSymbol(symbol: string): ProviderError {
    return ProviderError.unknownSymbol(this.info.id, symbol);
  }
}
