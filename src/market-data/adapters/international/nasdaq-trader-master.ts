/**
 * `nasdaqtrader.com/dynamic/SymDir/{nasdaqlisted,otherlisted}.txt` — the exchange's
 * own symbol directory, and the US master's second line.
 *
 * Two files, because Nasdaq publishes its own listings separately from everything
 * else (NYSE, NYSE American, Arca, Cboe, and the ETFs that live there). Both are
 * pipe-delimited with a trailing `File Creation Time` line that is not a record —
 * parsing it as one is how a phantom instrument called `File Creation Time` ends up
 * in a catalogue.
 *
 * What it adds over the SEC file is the **ETF flag** and the test-issue flag: the
 * SEC list is companies, so an ETF a user actually holds is missing from it, and a
 * test issue (`ZVZZT`) is a symbol that prices and is not a security.
 *
 * `otherlisted.txt` carries both a `ACT Symbol` and a `NASDAQ Symbol`; the NASDAQ
 * spelling is the one that already uses `-` for a class share, so it is preferred
 * as the quote key.
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

export const NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt";
export const OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt";

/** Pipe-delimited, header row first, `File Creation Time...` last. */
export function parsePipeDelimited(body: string): readonly Record<string, string>[] {
  const lines = body
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => !line.startsWith("File Creation Time"));
  if (lines.length < 2) return [];

  const headers = lines[0].split("|").map((header) => header.trim().toUpperCase());
  return lines.slice(1).map((line) => {
    const values = line.split("|").map((value) => value.trim());
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

const EXCHANGE_NAMES: Record<string, string> = {
  A: "NYSE American",
  N: "NYSE",
  P: "NYSE Arca",
  Z: "Cboe BZX",
  V: "IEX",
};

export class NasdaqTraderMasterAdapter extends MarketDataSource implements InstrumentMasterPort {
  readonly info: MarketDataSourceInfo = {
    id: "nasdaq-trader-master",
    displayName: "Nasdaq Trader symbol directory (US)",
    capabilities: ["MASTER"],
    markets: ["US"],
    keyless: true,
  };

  constructor(
    runtime: ProviderRuntime,
    private readonly urls: { nasdaq: string; other: string } = {
      nasdaq: NASDAQ_LISTED_URL,
      other: OTHER_LISTED_URL,
    },
    options: ProviderOptions = {},
  ) {
    super(runtime, { requestTimeoutMs: 30_000, ...options });
  }

  override rateLimit(): RateLimitBudget {
    return { requests: 6, perMillis: 60_000, burst: 2 };
  }

  async load(): Promise<MarketDataResult<readonly InstrumentMasterRow[]>> {
    return this.run(async () => {
      const usd = Currency.of("USD");
      const rows: InstrumentMasterRow[] = [];

      for (const row of parsePipeDelimited(await this.getText(this.urls.nasdaq))) {
        // `Y` is a test issue: it prices, and it is not a security.
        if (row["TEST ISSUE"] === "Y") continue;
        const symbol = row.SYMBOL?.toUpperCase();
        const name = row["SECURITY NAME"];
        if (!symbol || !name) continue;
        rows.push({
          symbol,
          name,
          exchange: "NASDAQ",
          market: "US",
          currency: usd,
          instrumentType: row.ETF === "Y" ? "ETF" : "EQUITY",
          isin: null,
          candidateQuoteKey: symbol.replace(/\./g, "-"),
          listedOn: null,
          sourceId: this.info.id,
        });
      }

      for (const row of parsePipeDelimited(await this.getText(this.urls.other))) {
        if (row["TEST ISSUE"] === "Y") continue;
        const symbol = (row["NASDAQ SYMBOL"] || row["ACT SYMBOL"] || "").toUpperCase();
        const name = row["SECURITY NAME"];
        if (!symbol || !name) continue;
        rows.push({
          symbol,
          name,
          exchange: EXCHANGE_NAMES[row.EXCHANGE] ?? row.EXCHANGE ?? "US",
          market: "US",
          currency: usd,
          instrumentType: row.ETF === "Y" ? "ETF" : "EQUITY",
          isin: null,
          candidateQuoteKey: symbol.replace(/\./g, "-"),
          listedOn: null,
          sourceId: this.info.id,
        });
      }

      if (rows.length === 0) throw this.malformed("the symbol directory contained no listings.");
      return rows as readonly InstrumentMasterRow[];
    });
  }
}
