import { createHash } from "node:crypto";
import type { HttpClient } from "@/infra/providers";
import {
  CatalogProviderResult,
  CatalogSnapshot,
  InstrumentMasterProvider,
  normalizeCatalogText,
  verifiedIsin,
} from "@/domain/instrument-catalog";

export const UPSTOX_NSE_MASTER_URL =
  "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
export const ZERODHA_INSTRUMENT_DUMP_URL = "https://api.kite.trade/instruments";

const checksum = (body: string) => createHash("sha256").update(body, "utf8").digest("hex");
const effectiveDate = (at: Date) => at.toISOString().slice(0, 10);

type JsonObject = Record<string, unknown>;

/** Keyless daily public master. Fetch is injected, so tests never touch the network. */
export class UpstoxPublicInstrumentMaster implements InstrumentMasterProvider {
  readonly source = "UPSTOX_PUBLIC";

  constructor(
    private readonly http: HttpClient,
    private readonly now: () => Date,
    private readonly url = UPSTOX_NSE_MASTER_URL,
  ) {}

  async fetch(): Promise<CatalogProviderResult> {
    try {
      const response = await this.http.get(this.url, { timeoutMs: 30_000 });
      if (response.status !== 200) return { ok: false, error: "UPSTOX_PUBLIC is unavailable." };
      const fetchedAt = this.now();
      const source = JSON.parse(response.body) as unknown;
      if (!Array.isArray(source)) return { ok: false, error: "UPSTOX_PUBLIC returned an invalid master." };

      const rows = source.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const row = raw as JsonObject;
        if (row.exchange !== "NSE" || row.segment !== "NSE_EQ" || row.instrument_type !== "EQ") return [];
        const isin = verifiedIsin(row.isin);
        const symbol = normalizeCatalogText(String(row.trading_symbol ?? ""));
        const name = String(row.name ?? "").trim();
        const providerInstrumentId = String(row.instrument_key ?? "").trim();
        if (!isin || !symbol || !name || !providerInstrumentId) return [];

        return [{
          verifiedIsin: isin,
          name,
          instrumentType: "EQUITY" as const,
          listing: {
            exchange: "NSE",
            segment: "NSE_EQ",
            symbol,
            name,
            instrumentType: "EQUITY" as const,
            currency: "INR",
          },
          providerMappings: [{
            provider: "UPSTOX",
            providerInstrumentId,
            providerToken: String(row.exchange_token ?? "").trim() || null,
            tradingSymbol: symbol,
            effectiveFrom: effectiveDate(fetchedAt),
          }],
        }];
      });

      if (rows.length === 0) return { ok: false, error: "UPSTOX_PUBLIC returned no supported listings." };
      const snapshot: CatalogSnapshot = {
        source: this.source,
        fetchedAt,
        checksum: checksum(response.body),
        instruments: rows,
        mappings: [],
      };
      return { ok: true, snapshot };
    } catch {
      return { ok: false, error: "UPSTOX_PUBLIC is unavailable." };
    }
  }
}

export interface ZerodhaInstrumentDumpOptions {
  /** Full Kite Authorization value. It is used only as an HTTP header. */
  readonly authorization: string;
  readonly url?: string;
}

/** Optional broker enrichment. Zerodha rows never create or supply an ISIN. */
export class ZerodhaInstrumentCsvMapping implements InstrumentMasterProvider {
  readonly source = "ZERODHA_CSV";

  constructor(
    private readonly http: HttpClient,
    private readonly now: () => Date,
    private readonly options: ZerodhaInstrumentDumpOptions,
  ) {}

  async fetch(): Promise<CatalogProviderResult> {
    try {
      const response = await this.http.get(optionsUrl(this.options), {
        timeoutMs: 30_000,
        headers: { authorization: this.options.authorization },
      });
      if (response.status !== 200) return { ok: false, error: "ZERODHA_CSV is unavailable." };
      const fetchedAt = this.now();
      const records = parseCsv(response.body);
      if (records.length < 2) return { ok: false, error: "ZERODHA_CSV returned an invalid instrument dump." };
      const headers = records[0].map((header) => header.trim().toUpperCase());
      const required = ["INSTRUMENT_TOKEN", "EXCHANGE_TOKEN", "TRADINGSYMBOL", "INSTRUMENT_TYPE", "SEGMENT", "EXCHANGE"];
      if (required.some((header) => !headers.includes(header))) {
        return { ok: false, error: "ZERODHA_CSV returned an invalid instrument dump." };
      }

      const mappings = records.slice(1).flatMap((columns) => {
        if (columns.length !== headers.length) return [];
        const row = Object.fromEntries(headers.map((header, index) => [header, columns[index]?.trim() ?? ""]));
        if (row.EXCHANGE !== "NSE" || row.SEGMENT !== "NSE" || row.INSTRUMENT_TYPE !== "EQ") return [];
        const tradingSymbol = normalizeCatalogText(row.TRADINGSYMBOL);
        if (!tradingSymbol || !row.INSTRUMENT_TOKEN) return [];
        return [{
          exchange: "NSE",
          segment: "NSE_EQ",
          tradingSymbol,
          provider: "ZERODHA",
          providerInstrumentId: row.INSTRUMENT_TOKEN,
          providerToken: row.EXCHANGE_TOKEN || null,
          effectiveFrom: effectiveDate(fetchedAt),
        }];
      });

      if (mappings.length === 0) return { ok: false, error: "ZERODHA_CSV returned no supported mappings." };
      return {
        ok: true,
        snapshot: {
          source: this.source,
          fetchedAt,
          checksum: checksum(response.body),
          instruments: [],
          mappings,
        },
      };
    } catch {
      return { ok: false, error: "ZERODHA_CSV is unavailable." };
    }
  }
}

function optionsUrl(options: ZerodhaInstrumentDumpOptions): string {
  return options.url ?? ZERODHA_INSTRUMENT_DUMP_URL;
}

/** Small RFC-4180 parser: commas, quotes, escaped quotes and CRLF are supported. */
function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value.length > 0));
}
