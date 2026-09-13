/**
 * `assets.upstox.com/market-quote/instruments/exchange/{NSE,BSE}.json.gz` — the
 * daily keyless instrument master for both Indian exchanges.
 *
 * **The BSE half is the point of this file** (research defect D-6: the repository
 * had NSE only). And the BSE half has a trap that has already cost one round of
 * research: `instrument_type` on a BSE row is **not** an instrument type, it is the
 * **BSE group code** — `A`, `B`, `T`, `X`, `XT`, `Z`, `M`, `MT`. Filtering it on
 * `"EQ"` the way the NSE half does returns **zero rows**, and `F` and `G` are debt
 * instruments, not equity (C9). That is why the two exchanges are filtered by
 * different rules below and why neither filter is factored into "one clever
 * predicate": they are different fields that happen to share a name.
 *
 * Keys follow C9: an NSE listing becomes `<SYMBOL>.NS`; a BSE row becomes
 * `<SYMBOL>.BO`, which is correct for a BSE-*only* scrip and is deduplicated
 * against the NSE row by ISIN at the catalogue, not here.
 *
 * Transport note: the URL is gzip. `FetchHttpClient` returns the decoded body when
 * the host marks it `content-encoding: gzip`, and a raw `.gz` payload therefore
 * arrives as bytes that are not JSON — which is reported as a malformed response
 * naming gzip, rather than as a mystery parse error.
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
  TradableType,
} from "@/market-data/ports";

export const UPSTOX_NSE_MASTER_URL =
  "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
export const UPSTOX_BSE_MASTER_URL =
  "https://assets.upstox.com/market-quote/instruments/exchange/BSE.json.gz";

/**
 * BSE group codes that are **equity**, measured against the live master.
 *
 * The trap C9 names, and it is not subtle: on a BSE row `instrument_type` is not
 * an instrument type at all, it is the exchange's **group code**. Filtering on
 * `"EQ"` — the thing that is right for NSE — returns **zero** rows, which reads as
 * "the BSE has no equities" rather than as a wrong filter. Confirmed live on
 * 2026-09-13: 12 878 `BSE_EQ` rows, of which `"EQ"` matches 0 and this set
 * matches 5 154.
 *
 * The live group census, so the next reader does not have to re-derive it:
 *
 *   F 6532 (debt: `IRFC-7.75%-15-4-33-PVT`)   G 1127 (G-secs: `GS22FEB31C`)
 *   B 1843   X 1160   A 698   XT 526   M 397   T 228   MT 128   Z 89
 *   P 61   E 38 (mutual funds)   IF 27 (InvITs/REITs)   TS 7   ZP 6   R 6   MS 5
 *
 * `F` and `G` are debt and are excluded by being absent, not by a rule that could
 * be read as "everything else is fine". `E` and `IF` are excluded too and for a
 * different reason: a fund and an InvIT are real instruments, but they are not
 * equities and the catalogue types them elsewhere.
 *
 * BSE-only scrips are a full tier, not a degraded one: 96% of them price.
 */
export const BSE_EQUITY_GROUP_CODES = new Set([
  "A", "B", "T", "TS", "X", "XT", "Z", "ZP", "ZY", "M", "MT", "MS", "P", "R", "W",
]);

type UpstoxRow = {
  exchange?: string;
  segment?: string;
  instrument_type?: string;
  trading_symbol?: string;
  name?: string;
  isin?: string;
  instrument_key?: string;
};

export class UpstoxMasterAdapter extends MarketDataSource implements InstrumentMasterPort {
  readonly info: MarketDataSourceInfo = {
    id: "upstox-master",
    displayName: "Upstox public instrument master (NSE + BSE)",
    capabilities: ["MASTER"],
    markets: ["IN"],
    keyless: true,
  };

  constructor(
    runtime: ProviderRuntime,
    private readonly urls: { nse: string; bse: string } = {
      nse: UPSTOX_NSE_MASTER_URL,
      bse: UPSTOX_BSE_MASTER_URL,
    },
    options: ProviderOptions = {},
  ) {
    super(runtime, { requestTimeoutMs: 60_000, ...options });
  }

  override rateLimit(): RateLimitBudget {
    // Refreshed once a day. A budget this small is a statement of intent.
    return { requests: 4, perMillis: 60_000, burst: 2 };
  }

  async load(): Promise<MarketDataResult<readonly InstrumentMasterRow[]>> {
    return this.run(async () => {
      const inr = Currency.of("INR");
      const rows: InstrumentMasterRow[] = [];

      // NSE: `instrument_type` really is an instrument type here.
      for (const raw of await this.fetchRows(this.urls.nse)) {
        if (raw.exchange !== "NSE" || raw.segment !== "NSE_EQ") continue;
        if ((raw.instrument_type ?? "").toUpperCase() !== "EQ") continue;
        const row = this.toRow(raw, "NSE", ".NS", inr, "EQUITY");
        if (row) rows.push(row);
      }

      // BSE: `instrument_type` is the group code. See the file comment.
      for (const raw of await this.fetchRows(this.urls.bse)) {
        if (raw.exchange !== "BSE" || raw.segment !== "BSE_EQ") continue;
        const group = (raw.instrument_type ?? "").toUpperCase();
        if (!BSE_EQUITY_GROUP_CODES.has(group)) continue;
        const row = this.toRow(raw, "BSE", ".BO", inr, "EQUITY");
        if (row) rows.push(row);
      }

      if (rows.length === 0) {
        throw this.malformed("neither exchange master contained a usable equity listing.");
      }
      return rows as readonly InstrumentMasterRow[];
    });
  }

  private async fetchRows(url: string): Promise<readonly UpstoxRow[]> {
    const body = await this.getDecodedText(url);
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (cause) {
      throw this.malformed(
        `${url} did not arrive as JSON. The URL is gzip; if the host stopped sending ` +
          `content-encoding: gzip the body is compressed bytes and needs decompressing ` +
          `before parsing.`,
        cause,
      );
    }
    if (!Array.isArray(parsed)) throw this.malformed(`${url} is not an array of instruments.`);
    return parsed as readonly UpstoxRow[];
  }

  private toRow(
    raw: UpstoxRow,
    exchange: string,
    suffix: string,
    currency: Currency,
    instrumentType: TradableType,
  ): InstrumentMasterRow | null {
    const symbol = (raw.trading_symbol ?? "").trim().toUpperCase();
    const name = (raw.name ?? "").trim();
    const isin = (raw.isin ?? "").trim().toUpperCase() || null;
    if (!symbol || !name) return null;
    return {
      symbol,
      name,
      exchange,
      market: "IN",
      currency,
      instrumentType,
      isin,
      candidateQuoteKey: `${symbol}${suffix}`,
      // The master carries no listing date; `nse-equity-master` does.
      listedOn: null,
      sourceId: this.info.id,
    };
  }
}
