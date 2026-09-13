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
export const AMFI_NAV_ALL_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";
export const SEC_COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers_exchange.json";

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

/** Official Indian mutual-fund scheme/NAV master. NAV is daily, never live. */
export class AmfiMutualFundMaster implements InstrumentMasterProvider {
  readonly source = "AMFI_NAV";

  constructor(
    private readonly http: HttpClient,
    private readonly now: () => Date,
    private readonly url = AMFI_NAV_ALL_URL,
  ) {}

  async fetch(): Promise<CatalogProviderResult> {
    try {
      const response = await this.http.get(this.url, { timeoutMs: 30_000 });
      if (response.status !== 200) return { ok: false, error: "AMFI_NAV is unavailable." };
      const fetchedAt = this.now();
      const rows = AmfiMutualFundMaster.parse(response.body, fetchedAt);
      if (rows.length === 0) return { ok: false, error: "AMFI_NAV returned no supported schemes." };
      return {
        ok: true,
        snapshot: {
          source: this.source,
          fetchedAt,
          checksum: checksum(response.body),
          instruments: rows,
          mappings: [],
        },
      };
    } catch {
      return { ok: false, error: "AMFI_NAV is unavailable." };
    }
  }

  static parse(body: string, fetchedAt: Date): CatalogSnapshot["instruments"] {
    const effectiveFrom = effectiveDate(fetchedAt);
    const instruments: CatalogSnapshot["instruments"][number][] = [];

    for (const line of body.split(/\r?\n/)) {
      const parts = line.split(";").map((part) => part.trim());
      // NAVAll's current row contract has eight columns:
      // code, two ISINs, scheme name, plan, option, NAV and date.
      // Do not read NAV from the legacy position: "Direct" is not a price.
      if (parts.length < 8 || !/^\d+$/.test(parts[0])) continue;

      const schemeCode = parts[0];
      const isin = verifiedIsin(parts[2]) ?? verifiedIsin(parts[1]);
      const name = [parts[3], parts[4], parts[5]].filter(Boolean).join(" - ");
      const nav = Number(parts[6]);
      const navDate = parts[7];
      if (!name || !Number.isFinite(nav) || nav <= 0 || !navDate) continue;

      instruments.push({
        verifiedIsin: isin,
        name,
        instrumentType: "MUTUAL_FUND",
        listing: {
          exchange: "AMFI",
          segment: "MUTUAL_FUND_NAV",
          symbol: schemeCode,
          name,
          instrumentType: "MUTUAL_FUND",
          currency: "INR",
        },
        providerMappings: [{
          provider: "AMFI",
          providerInstrumentId: schemeCode,
          providerToken: null,
          tradingSymbol: schemeCode,
          effectiveFrom,
        }],
      });
    }

    return instruments;
  }
}

/** SEC listed company ticker master for read-only US equity tracking. */
export class SecCompanyTickerMaster implements InstrumentMasterProvider {
  readonly source = "SEC_COMPANY_TICKERS";

  constructor(
    private readonly http: HttpClient,
    private readonly now: () => Date,
    private readonly url = SEC_COMPANY_TICKERS_URL,
  ) {}

  async fetch(): Promise<CatalogProviderResult> {
    try {
      const response = await this.http.get(this.url, { timeoutMs: 30_000 });
      if (response.status !== 200) return { ok: false, error: "SEC_COMPANY_TICKERS is unavailable." };
      const fetchedAt = this.now();
      const rows = SecCompanyTickerMaster.parse(response.body, fetchedAt);
      if (rows.length === 0) {
        return { ok: false, error: "SEC_COMPANY_TICKERS returned no supported listings." };
      }
      return {
        ok: true,
        snapshot: {
          source: this.source,
          fetchedAt,
          checksum: checksum(response.body),
          instruments: rows,
          mappings: [],
        },
      };
    } catch {
      return { ok: false, error: "SEC_COMPANY_TICKERS is unavailable." };
    }
  }

  static parse(body: string, fetchedAt: Date): CatalogSnapshot["instruments"] {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const root = parsed as JsonObject;
    const fields = Array.isArray(root.fields) ? root.fields.map((field) => String(field).toLowerCase()) : [];
    const data = Array.isArray(root.data) ? root.data : [];
    const cikAt = fields.indexOf("cik");
    const nameAt = fields.indexOf("name");
    const tickerAt = fields.indexOf("ticker");
    const exchangeAt = fields.indexOf("exchange");
    if (cikAt < 0 || nameAt < 0 || tickerAt < 0 || exchangeAt < 0) return [];

    const effectiveFrom = effectiveDate(fetchedAt);
    return data.flatMap((raw) => {
      if (!Array.isArray(raw)) return [];
      const cik = Number(raw[cikAt]);
      const name = String(raw[nameAt] ?? "").trim();
      const symbol = normalizeCatalogText(String(raw[tickerAt] ?? ""));
      const exchange = normalizeUsExchange(String(raw[exchangeAt] ?? ""));
      if (!Number.isInteger(cik) || cik <= 0 || !name || !symbol || !exchange) return [];
      const cik10 = String(cik).padStart(10, "0");
      return [{
        verifiedIsin: null,
        name,
        instrumentType: "EQUITY" as const,
        listing: {
          exchange,
          segment: "US_EQUITY",
          symbol,
          name,
          instrumentType: "EQUITY" as const,
          currency: "USD",
        },
        providerMappings: [{
          provider: "SEC",
          providerInstrumentId: cik10,
          providerToken: null,
          tradingSymbol: symbol,
          effectiveFrom,
        }],
      }];
    });
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

function normalizeUsExchange(value: string): string | null {
  const normalized = normalizeCatalogText(value).replace(/\./g, "");
  if (normalized === "NASDAQ") return "NASDAQ";
  if (normalized === "NYSE") return "NYSE";
  if (normalized === "NYSE ARCA") return "NYSEARCA";
  if (normalized === "NYSE AMERICAN" || normalized === "NYSE MKT") return "NYSEAMERICAN";
  if (normalized === "CBOE BZX") return "BATS";
  return normalized ? normalized.slice(0, 16) : null;
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
