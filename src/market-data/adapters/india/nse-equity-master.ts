/**
 * `nsearchives.nseindia.com/content/equities/EQUITY_L.csv` — the NSE's own list of
 * listed equities.
 *
 * Small, keyless, and the one Indian master that carries the **date of listing**,
 * which is what an inception-to-today chart needs as its left edge. It carries the
 * ISIN too, so it is the join key between this catalogue and every other source.
 *
 * Per C9 the candidate quote key is `<SYMBOL>.NS`: for an NSE listing that is the
 * key that resolves, and `.BO` truncation is a property of exactly the dual-listed
 * names this file covers. Whether the key actually resolves is decided at ingest by
 * probing the history endpoint (C10) — this adapter proposes, the catalogue gate
 * disposes.
 */

import { Currency } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { RateLimitBudget } from "@/domain/pricing";
import { ProviderOptions, ProviderRuntime } from "@/infra/providers";
import { MarketDataSource, parseDelimited } from "@/market-data/engine/source";
import type {
  InstrumentMasterPort,
  InstrumentMasterRow,
  MarketDataResult,
  MarketDataSourceInfo,
} from "@/market-data/ports";

export const NSE_EQUITY_MASTER_URL =
  "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";

/** `EQ` is the rolling segment; `BE` is trade-for-trade. Both are equity. */
const TRADED_SERIES = new Set(["EQ", "BE", "BZ"]);

/** `"14-FEB-2020"` — the archive's own spelling. */
const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

export function parseNseListingDate(text: string): CalendarDate | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text.trim());
  if (!match) return null;
  const month = MONTHS[match[2].toUpperCase()];
  if (!month) return null;
  return CalendarDate.parse(`${match[3]}-${month}-${match[1].padStart(2, "0")}`);
}

export class NseEquityMasterAdapter extends MarketDataSource implements InstrumentMasterPort {
  readonly info: MarketDataSourceInfo = {
    id: "nse-equity-master",
    displayName: "NSE listed-equity master",
    capabilities: ["MASTER"],
    markets: ["IN"],
    keyless: true,
  };

  constructor(
    runtime: ProviderRuntime,
    private readonly url = NSE_EQUITY_MASTER_URL,
    options: ProviderOptions = {},
  ) {
    // A ~180 KB file behind Akamai: worth a longer timeout than a quote.
    super(runtime, { requestTimeoutMs: 30_000, ...options });
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 6, perMillis: 60_000, burst: 2 };
  }

  async load(): Promise<MarketDataResult<readonly InstrumentMasterRow[]>> {
    return this.run(async () => {
      const body = await this.getText(this.url);
      const inr = Currency.of("INR");
      const rows: InstrumentMasterRow[] = [];

      for (const row of parseDelimited(body)) {
        const symbol = (row.SYMBOL ?? "").toUpperCase();
        const series = (row.SERIES ?? "").toUpperCase();
        const name = row["NAME OF COMPANY"] ?? "";
        const isin = (row["ISIN NUMBER"] ?? "").toUpperCase() || null;
        if (!symbol || !name || !TRADED_SERIES.has(series)) continue;

        rows.push({
          symbol,
          name,
          exchange: "NSE",
          market: "IN",
          currency: inr,
          instrumentType: "EQUITY",
          isin,
          // C9: Indian equities canonicalise to `.NS`.
          candidateQuoteKey: `${symbol}.NS`,
          listedOn: parseNseListingDate(row["DATE OF LISTING"] ?? ""),
          sourceId: this.info.id,
        });
      }

      if (rows.length === 0) throw this.malformed("the equity master contained no listings.");
      return rows as readonly InstrumentMasterRow[];
    });
  }
}
