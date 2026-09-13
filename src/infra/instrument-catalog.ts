import { createHash } from "node:crypto";
import type { HttpClient } from "@/infra/providers";
import {
  CatalogProviderResult,
  CatalogQuoteKeyState,
  CatalogSnapshot,
  InstrumentCatalogRepository,
  InstrumentMasterProvider,
  QuoteKeyCandidateListing,
  QuoteKeyProbeResult,
  QuoteKeyReconciliationReport,
  acceptQuoteKeyProbe,
  candidateQuoteKeys,
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
      // Raw gzip with no content-encoding: see getMaybeGzipped. Reading this
      // with response.text() is what was silently failing every ingest.
      const response = await getMaybeGzipped(this.http, this.url, 30_000);
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

/* ═══ The BSE master (D-6) ════════════════════════════════════════════ */

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
export const BSE_EQUITY_GROUPS: ReadonlySet<string> = new Set([
  "A", "B", "T", "TS", "X", "XT", "Z", "ZP", "ZY", "M", "MT", "MS", "P", "R", "W",
]);

/**
 * Whichever read gets the real bytes.
 *
 * `assets.upstox.com` serves `NSE.json.gz` as raw gzip with **no**
 * `content-encoding`, so `fetch` leaves it compressed and `response.text()`
 * mangles it — the parse then throws and the provider reports "unavailable",
 * which is how the catalogue was silently never ingesting. `getDecoded` sniffs
 * the gzip magic and inflates; a client that does not implement it (the test
 * fixtures) falls back to `get`, which is correct for a plain-JSON fixture.
 */
async function getMaybeGzipped(
  http: HttpClient,
  url: string,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  if (http.getDecoded) return http.getDecoded(url, { timeoutMs });
  return http.get(url, { timeoutMs });
}

/**
 * The Upstox BSE master — D-6, the 2 510 BSE-only ISINs nothing could find.
 *
 * Same shape as its NSE sibling with one difference that matters: the row filter
 * is on the **group code** (see {@link BSE_EQUITY_GROUPS}), never on `"EQ"`.
 */
export class UpstoxBsePublicInstrumentMaster implements InstrumentMasterProvider {
  readonly source = "UPSTOX_PUBLIC_BSE";

  constructor(
    private readonly http: HttpClient,
    private readonly now: () => Date,
    private readonly url = UPSTOX_BSE_MASTER_URL,
  ) {}

  async fetch(): Promise<CatalogProviderResult> {
    try {
      const response = await getMaybeGzipped(this.http, this.url, 30_000);
      if (response.status !== 200) return { ok: false, error: "UPSTOX_PUBLIC_BSE is unavailable." };
      const fetchedAt = this.now();
      const source = JSON.parse(response.body) as unknown;
      if (!Array.isArray(source)) {
        return { ok: false, error: "UPSTOX_PUBLIC_BSE returned an invalid master." };
      }

      const rows = source.flatMap((raw) => {
        if (!raw || typeof raw !== "object") return [];
        const row = raw as Record<string, unknown>;
        if (row.exchange !== "BSE" || row.segment !== "BSE_EQ") return [];
        const group = String(row.instrument_type ?? "").trim().toUpperCase();
        if (!BSE_EQUITY_GROUPS.has(group)) return [];
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
            exchange: "BSE",
            segment: "BSE_EQ",
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

      if (rows.length === 0) {
        return { ok: false, error: "UPSTOX_PUBLIC_BSE returned no supported listings." };
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
      return { ok: false, error: "UPSTOX_PUBLIC_BSE is unavailable." };
    }
  }
}

/* ═══ The quote-key reconciler (C10, C6) ══════════════════════════════ */

/**
 * What the reconciler needs from the market-data engine.
 *
 * One method, and deliberately not `HistoricalSeriesPort`: the reconciler is not
 * fetching a series, it is asking a question — "does this string resolve, in the
 * right currency, to the right kind of thing?" — and a port that could hand back
 * twenty years of bars would invite someone to store them from here.
 */
export interface QuoteKeyProbePort {
  probe(quoteKey: string): Promise<QuoteKeyProbeResult | null>;
}

/**
 * The four catalogue methods the reconciler actually uses.
 *
 * Narrower than `InstrumentCatalogRepository` on purpose: a class that held the
 * whole port could ingest a snapshot or link a portfolio instrument, and the one
 * guarantee worth having here is that reconciliation cannot do either.
 */
export type QuoteKeyCatalogStore = Pick<
  InstrumentCatalogRepository,
  | "listingsDueQuoteKeyCheck"
  | "listingsForQuoteKeyProbe"
  | "recordQuoteKey"
  | "markQuoteStale"
  | "touchQuoteKey"
>;

/**
 * Resolves and re-confirms catalogue quote keys, offline.
 *
 * **This is what makes "unpriceable implies unaddable" structural.** A catalogue
 * row is indexed for adding only once a history adapter has accepted a key for
 * it, with a matching currency and an EQUITY/ETF type — so the failure mode is a
 * candidate the user is told they cannot add, rather than a holding that renders
 * a blank chart forever and nobody can say why.
 *
 * It runs on a schedule and **never under the user's cursor** (C10): the
 * catalogue is ~30 000 rows and a probe is a network round trip. `limit` is the
 * budget for one sweep.
 *
 * Re-validation and the degrade path are the same loop, because they are the same
 * question asked twice: `TATAMOTORS.NS` resolved for years and then 404'd after
 * the demerger. A key that stops resolving is marked `quoteStale` and **never**
 * deleted (C6) — the holding stays valued at its last known close behind a badge,
 * and a retro-delete would rewrite history that was correct when it was recorded.
 */
export class InstrumentQuoteKeyReconciler {
  constructor(
    private readonly catalog: QuoteKeyCatalogStore,
    private readonly prober: QuoteKeyProbePort,
    private readonly now: () => Date,
  ) {}

  /**
   * One probe, for a caller that has a key in hand rather than a sweep to run.
   *
   * The instrument backfill route needs exactly this: it knows which instrument
   * it is resolving and must not walk the catalogue to do it. Exposed here rather
   * than by handing the route the prober, so the one place that knows how a key is
   * judged stays the one place.
   */
  probeOne(quoteKey: string): Promise<QuoteKeyProbeResult | null> {
    return this.prober.probe(quoteKey);
  }

  async reconcile(limit = 200): Promise<QuoteKeyReconciliationReport> {
    const at = this.now();
    return this.run(await this.catalog.listingsDueQuoteKeyCheck(limit, at), at);
  }

  /**
   * The same reconciliation, for a named handful of listings.
   *
   * C10 says the sweep never runs under the user's cursor, and it still does
   * not: the caller is the search action, which schedules this in `after()`
   * once the response has already gone out. What it buys is that a row the user
   * actually searched for stops waiting for a ~30 000-row sweep to reach it —
   * which, at the budgeted 200 per run, is otherwise measured in months.
   *
   * `listingsForQuoteKeyProbe` keeps the due-ness filter, so calling this with
   * the same ids on every keystroke costs one query and no probes.
   */
  async reconcileListings(
    listingIds: readonly string[],
    limit = 12,
  ): Promise<QuoteKeyReconciliationReport> {
    const at = this.now();
    const due = await this.catalog.listingsForQuoteKeyProbe(listingIds.slice(0, limit), at);
    return this.run(due, at);
  }

  private async run(
    due: readonly (QuoteKeyCandidateListing & CatalogQuoteKeyState)[],
    at: Date,
  ): Promise<QuoteKeyReconciliationReport> {
    let probed = 0;
    let resolved = 0;
    let markedStale = 0;
    let stillUnresolved = 0;
    const reasons: string[] = [];

    for (const listing of due) {
      /*
       * A key that already works is re-confirmed first and alone. Trying the
       * `.BO` alternative for a row whose `.NS` key is healthy would spend a
       * request to learn something we do not act on.
       */
      const candidates = listing.quoteKey
        ? [listing.quoteKey]
        : candidateQuoteKeys({
            listingId: listing.listingId,
            exchange: listing.exchange,
            symbol: listing.symbol,
            currency: listing.currency,
            instrumentType: listing.instrumentType,
          });

      if (candidates.length === 0) {
        // Not a failure: a mutual fund's NAV comes from AMFI, and asking a chart
        // endpoint for it is a request that can only fail.
        await this.catalog.touchQuoteKey(listing.listingId, at);
        stillUnresolved += 1;
        continue;
      }

      let accepted: QuoteKeyProbeResult | null = null;
      const failures: string[] = [];

      for (const candidate of candidates) {
        probed += 1;
        const probe = await this.prober.probe(candidate);
        if (!probe) {
          failures.push(`${candidate} did not resolve`);
          continue;
        }
        const verdict = acceptQuoteKeyProbe(probe, { currency: listing.currency });
        if (verdict.accepted) {
          accepted = verdict.probe;
          break;
        }
        failures.push(verdict.reason);
      }

      if (accepted) {
        await this.catalog.recordQuoteKey({
          listingId: listing.listingId,
          quoteKey: accepted.quoteKey,
          quoteProvider: accepted.sourceId,
          firstTradeDate: accepted.firstTradeDate,
          validatedAt: at,
        });
        resolved += 1;
        continue;
      }

      const reason = failures.join("; ") || "no candidate key resolved";
      if (listing.quoteKey) {
        // It used to work and no longer does. A symbol died.
        await this.catalog.markQuoteStale(listing.listingId, at, reason);
        markedStale += 1;
        reasons.push(`${listing.symbol}: ${reason}`);
      } else {
        await this.catalog.touchQuoteKey(listing.listingId, at);
        stillUnresolved += 1;
        reasons.push(`${listing.symbol}: ${reason}`);
      }
    }

    return { probed, resolved, markedStale, stillUnresolved, reasons };
  }
}

/* ═══ Moneycontrol sc_id harvesting (C11) ═════════════════════════════ */

export const MONEYCONTROL_AUTOSUGGEST_URL =
  "https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php";

/**
 * Moneycontrol's `sc_id`, the key its keyless `pricefeed` endpoint wants.
 *
 * `priceapi.moneycontrol.com/pricefeed/nse/equitycash/RI` is Reliance — `RI`, not
 * `RELIANCE`, and there is no rule that derives one from the other. The map is
 * therefore harvested rather than computed, from the autosuggest endpoint, whose
 * `link_src` ends in the id:
 *
 *   `https://www.moneycontrol.com/india/stockpricequote/refineries/relianceindustries/RI`
 *
 * **Offline only, never a keystroke dependency** (C11): this runs on the
 * catalogue schedule beside the quote-key sweep. Moneycontrol's *history* sibling
 * is 403-blocked behind Akamai and is deliberately not implemented.
 */
export class MoneycontrolScIdHarvester {
  readonly source = "MONEYCONTROL_SC_ID";

  constructor(
    private readonly http: HttpClient,
    private readonly url = MONEYCONTROL_AUTOSUGGEST_URL,
  ) {}

  /** The `sc_id` for one symbol or company name, or null if it is not offered. */
  async lookup(query: string): Promise<string | null> {
    const target = normalizeCatalogText(query).replace(/\s+/g, "");
    if (!target) return null;
    try {
      const response = await this.http.get(
        `${this.url}?classic=true&query=${encodeURIComponent(query)}&type=1&format=json`,
        { timeoutMs: 15_000 },
      );
      if (response.status !== 200) return null;
      return MoneycontrolScIdHarvester.parse(response.body, target);
    } catch {
      return null;
    }
  }

  /**
   * The first suggestion whose own symbol matches what was asked for.
   *
   * Matching rather than taking the first row, because autosuggest is a search:
   * asking for `ITC` offers `ITC Hotels` too, and storing that id against `ITC`
   * would price a holding from a different company with no error anywhere.
   */
  static parse(body: string, normalizedSymbol: string): string | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
    if (!Array.isArray(parsed)) return null;

    for (const raw of parsed) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const symbol = normalizeCatalogText(String(row.sc_id ?? row.symbol ?? "")).replace(/\s+/g, "");
      const link = String(row.link_src ?? "").trim();
      const id = link.split("/").filter(Boolean).pop() ?? "";
      if (!id || !/^[A-Za-z0-9]{1,16}$/.test(id)) continue;
      const stock = normalizeCatalogText(String(row.stock_name ?? "")).replace(/\s+/g, "");
      if (symbol === normalizedSymbol || stock === normalizedSymbol) return id.toUpperCase();
    }
    return null;
  }
}
