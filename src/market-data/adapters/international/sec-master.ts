/**
 * `sec.gov/files/company_tickers_exchange.json` — the US instrument master.
 *
 * Official, keyless, and the one US list with a regulator's authority behind it.
 * It carries no ISIN — the catalogue joins these rows to one through symbology —
 * so what this adapter contributes is the authoritative *set* of live US tickers
 * and their exchange, which is what the priceability gate needs.
 *
 * This is the **file**, not SEC EDGAR full-text search, which is eliminated (C1).
 *
 * `.`-to-`-` on the way out: the SEC spells the Berkshire B share `BRK.B` and every
 * price source in this stack spells it `BRK-B`. The transformation happens here,
 * once, at the boundary — which is what stops it being re-derived, differently, at
 * three call sites.
 */

import { Currency } from "@/core/money";
import { RateLimitBudget } from "@/domain/pricing";
import { ProviderOptions, ProviderRuntime } from "@/infra/providers";
import { MarketDataSource } from "@/market-data/engine/source";
import type {
  InstrumentMasterPort,
  InstrumentMasterRow,
  MarketDataResult,
  MarketDataSourceInfo,
} from "@/market-data/ports";

export const SEC_COMPANY_TICKERS_URL =
  "https://www.sec.gov/files/company_tickers_exchange.json";

interface SecTickerFile {
  fields?: string[];
  data?: unknown[][];
}

/** The exchanges the SEC file names, and what they mean to us. */
const US_EXCHANGES = new Set(["NASDAQ", "NYSE", "NYSE AMERICAN", "NYSE ARCA", "CBOE", "OTC"]);

/** `BRK.B` -> `BRK-B`: the spelling every price source in this stack uses. */
export function secTickerToQuoteKey(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\./g, "-");
}

export class SecMasterAdapter extends MarketDataSource implements InstrumentMasterPort {
  readonly info: MarketDataSourceInfo = {
    id: "sec-master",
    displayName: "SEC company tickers (US)",
    capabilities: ["MASTER"],
    markets: ["US"],
    keyless: true,
  };

  constructor(
    runtime: ProviderRuntime,
    private readonly url = SEC_COMPANY_TICKERS_URL,
    options: ProviderOptions = {},
  ) {
    super(runtime, { requestTimeoutMs: 30_000, ...options });
  }

  override rateLimit(): RateLimitBudget {
    // The SEC asks for no more than 10 requests a second and a declared UA. This
    // file is fetched once a day; the budget says so.
    return { requests: 6, perMillis: 60_000, burst: 2 };
  }

  async load(): Promise<MarketDataResult<readonly InstrumentMasterRow[]>> {
    return this.run(async () => {
      const payload = await this.getJson<SecTickerFile>(this.url);
      const fields = (payload.fields ?? []).map((field) => field.toLowerCase());
      const nameAt = fields.indexOf("name");
      const tickerAt = fields.indexOf("ticker");
      const exchangeAt = fields.indexOf("exchange");
      if (nameAt < 0 || tickerAt < 0 || exchangeAt < 0) {
        throw this.malformed("the ticker file's column layout changed.");
      }

      const usd = Currency.of("USD");
      const rows: InstrumentMasterRow[] = [];
      for (const record of payload.data ?? []) {
        const ticker = String(record[tickerAt] ?? "").trim();
        const exchange = String(record[exchangeAt] ?? "").trim().toUpperCase();
        const name = String(record[nameAt] ?? "").trim();
        if (!ticker || !name || !US_EXCHANGES.has(exchange)) continue;

        rows.push({
          symbol: ticker.toUpperCase(),
          name,
          exchange,
          market: "US",
          currency: usd,
          instrumentType: "EQUITY",
          // The SEC file has no ISIN; the CIK is the identity it does carry, and
          // the catalogue joins it to an ISIN through symbology.
          isin: null,
          candidateQuoteKey: secTickerToQuoteKey(ticker),
          listedOn: null,
          sourceId: this.info.id,
        });
      }

      if (rows.length === 0) throw this.malformed("the ticker file contained no US listings.");
      return rows as readonly InstrumentMasterRow[];
    });
  }
}
