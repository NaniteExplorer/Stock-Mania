/**
 * `api.openfigi.com/v3/mapping` — ISIN and ticker to FIGI, keyless.
 *
 * A **mapping** adapter, not a search one. OpenFIGI's free-text `/search` ranks
 * futures and options above the ordinary share (C11), so it is not offered here at
 * all: this file does the one thing OpenFIGI is excellent at, which is answering
 * "what is this ISIN, everywhere".
 *
 * What it is for is `shareClassFIGI`: the identity that survives a ticker change.
 * `TATAMOTORS.NS` going 404 after the demerger (C6) is exactly the event a
 * ticker-keyed catalogue cannot follow and a share-class-keyed one can.
 *
 * Limits are the free tier's, and they are enforced here rather than hoped for:
 * **10 jobs per request, 25 requests per minute**, no key. Exceeding either gets a
 * 429 that looks like an outage.
 *
 * Transport: this is the one POST in the layer, and `HttpClient` in
 * `src/infra/providers.ts` is GET-only. Rather than modify that file, the POST is a
 * tiny injected port with the same browser-shaped User-Agent (C13). When the shared
 * client grows a `post`, this should move onto it and the local transport deleted.
 */

import { RateLimitBudget } from "@/domain/pricing";
import { ProviderOptions, ProviderRuntime } from "@/infra/providers";
import { MarketDataSource } from "@/market-data/engine/source";
import type {
  MarketDataResult,
  MarketDataSourceInfo,
  SymbologyJob,
  SymbologyMatch,
  SymbologyPort,
} from "@/market-data/ports";

export const OPENFIGI_MAPPING_URL = "https://api.openfigi.com/v3/mapping";

/** Free tier: 10 jobs per request. A longer batch is rejected wholesale. */
export const OPENFIGI_MAX_JOBS_PER_REQUEST = 10;

export interface HttpPostResponse {
  readonly status: number;
  readonly body: string;
}

/** The narrow POST this one adapter needs. Injected, so tests never hit the network. */
export interface HttpPostClient {
  post(
    url: string,
    body: string,
    init?: { headers?: Record<string, string>; timeoutMs?: number },
  ): Promise<HttpPostResponse>;
}

/** The real one. Same User-Agent as `FetchHttpClient`, deliberately (C13). */
export class FetchPostClient implements HttpPostClient {
  constructor(private readonly defaultTimeoutMs = 10_000) {}

  async post(
    url: string,
    body: string,
    init?: { headers?: Record<string, string>; timeoutMs?: number },
  ): Promise<HttpPostResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init?.timeoutMs ?? this.defaultTimeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; StockMania/1.0)",
          "content-type": "application/json",
          accept: "application/json",
          ...init?.headers,
        },
        body,
        signal: controller.signal,
      });
      return { status: response.status, body: await response.text() };
    } finally {
      clearTimeout(timer);
    }
  }
}

interface OpenFigiResult {
  data?: {
    figi?: string;
    shareClassFIGI?: string;
    ticker?: string;
    exchCode?: string;
    securityType?: string;
  }[];
  warning?: string;
  error?: string;
}

export class OpenFigiMappingAdapter extends MarketDataSource implements SymbologyPort {
  readonly info: MarketDataSourceInfo = {
    id: "openfigi-mapping",
    displayName: "OpenFIGI mapping (keyless)",
    capabilities: ["SYMBOLOGY"],
    markets: ["GLOBAL", "IN", "US"],
    keyless: true,
  };

  constructor(
    runtime: ProviderRuntime,
    private readonly poster: HttpPostClient = new FetchPostClient(),
    private readonly url = OPENFIGI_MAPPING_URL,
    options: ProviderOptions = {},
  ) {
    super(runtime, options);
  }

  override rateLimit(): RateLimitBudget {
    // The published keyless limit, as the bucket rather than as a comment.
    return { requests: 25, perMillis: 60_000, burst: 5 };
  }

  async map(jobs: readonly SymbologyJob[]): Promise<MarketDataResult<readonly SymbologyMatch[]>> {
    return this.run(async () => {
      const matches: SymbologyMatch[] = [];

      for (let start = 0; start < jobs.length; start += OPENFIGI_MAX_JOBS_PER_REQUEST) {
        const batch = jobs.slice(start, start + OPENFIGI_MAX_JOBS_PER_REQUEST);
        const payload = batch.map((job) => ({
          idType: job.idType,
          idValue: job.idValue,
          ...(job.exchCode ? { exchCode: job.exchCode } : {}),
        }));

        const response = await this.poster.post(this.url, JSON.stringify(payload), {
          timeoutMs: this.requestTimeoutMs,
        });
        this.assertStatus(response.status, this.url, response.body);

        let results: OpenFigiResult[];
        try {
          results = JSON.parse(response.body) as OpenFigiResult[];
        } catch (cause) {
          throw this.malformed("the mapping response was not JSON.", cause);
        }
        if (!Array.isArray(results) || results.length !== batch.length) {
          throw this.malformed(
            `asked for ${batch.length} mappings and got ${Array.isArray(results) ? results.length : "a non-array"}.`,
          );
        }

        results.forEach((result, index) => {
          // A job with no match comes back as `{ warning }`, not as an error: an
          // ISIN nobody has mapped is an ordinary answer.
          for (const row of result.data ?? []) {
            if (!row.figi) continue;
            matches.push({
              job: batch[index],
              figi: row.figi,
              shareClassFigi: row.shareClassFIGI ?? null,
              ticker: row.ticker ?? null,
              exchCode: row.exchCode ?? null,
              securityType: row.securityType ?? null,
              sourceId: this.info.id,
            });
          }
        });
      }

      return matches as readonly SymbologyMatch[];
    });
  }
}
