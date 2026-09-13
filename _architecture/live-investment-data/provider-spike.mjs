import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const artifactRoot = "D:/WorkStation/Artifacts/stock-mania-live-data-20260907/data";
const timeoutMs = 18000;
const generatedAt = new Date();

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function daysBetween(a, b) {
  return Math.floor((Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate())) / 86400000);
}

function parseLooseDate(value) {
  if (!value) return null;
  const months = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  const amfi = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value.trim());
  if (amfi) return new Date(Date.UTC(Number(amfi[3]), months[amfi[2]], Number(amfi[1])));
  const mfapi = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(value.trim());
  if (mfapi) return new Date(Date.UTC(Number(mfapi[3]), Number(mfapi[2]) - 1, Number(mfapi[1])));
  const iso = /^\d{4}-\d{2}-\d{2}/.test(value.trim()) ? new Date(value.trim()) : null;
  return iso && !Number.isNaN(iso.getTime()) ? iso : null;
}

function classifyDataState({ kind, observedAt, valuationDate, authenticated, available, liveEntitlement }) {
  if (!available) return "UNAVAILABLE";
  if (kind === "live") return authenticated && liveEntitlement ? "LIVE" : "UNAVAILABLE";
  const parsed = parseLooseDate(valuationDate);
  if (!parsed) return "UNAVAILABLE";
  const ageDays = daysBetween(parsed, observedAt);
  if (kind === "nav") return ageDays <= 4 ? "NAV_DAILY" : "STALE";
  if (kind === "eod") return ageDays <= 4 ? "EOD" : "STALE";
  return "UNAVAILABLE";
}

async function fetchBuffer(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Stock-Mania research spike/2026-09-07",
        ...headers,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    const arrayBuffer = await response.arrayBuffer();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url,
      headers: Object.fromEntries(response.headers.entries()),
      buffer: Buffer.from(arrayBuffer),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeTokens(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function parseAmfiNav(text, query) {
  const rows = [];
  const queryTokens = normalizeTokens(query);
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("Scheme Code;")) continue;
    const cells = line.split(";");
    if (cells.length < 8) continue;
    const [schemeCode, isinGrowth, isinDividend, schemeName, plan, option, nav, date] = cells;
    const haystack = normalizeTokens(`${schemeCode} ${isinGrowth} ${isinDividend} ${schemeName} ${plan} ${option}`).join(" ");
    if (queryTokens.every((token) => haystack.includes(token))) {
      rows.push({ schemeCode, isinGrowth, isinDividend, schemeName, plan, option, nav, date });
    }
  }
  return rows.slice(0, 10);
}

function classifyUpstoxInstrument(row) {
  return {
    canonicalHint: row.isin ? `ISIN:${row.isin}` : `${row.exchange}:${row.trading_symbol ?? row.tradingsymbol}`,
    providerKey: row.instrument_key,
    exchangeTokenPresent: Boolean(row.exchange_token),
    tradingSymbol: row.trading_symbol ?? row.tradingsymbol,
    name: row.name,
    exchange: row.exchange,
    segment: row.segment,
    isin: row.isin ?? null,
    instrumentType: row.instrument_type,
  };
}

async function run() {
  await mkdir(artifactRoot, { recursive: true });
  const result = {
    generatedAt: generatedAt.toISOString(),
    scope: "Research-only provider spike. No production code, orders, broker secrets, or redistributable raw market dataset are written.",
    zerodhaUnauthenticatedQuote: { status: "NOT_RUN" },
    zerodhaAuthenticatedFixture: { status: "NOT_RUN" },
    zerodhaCredentialedQuote: { status: "NOT_RUN" },
    equityDiscovery: { status: "NOT_RUN" },
    mutualFundAmfi: { status: "NOT_RUN" },
    mutualFundMfapi: { status: "NOT_RUN" },
    stateFixtures: [],
    providerStates: [],
  };

  const zerodhaQuoteUrl = "https://api.kite.trade/quote/ltp?i=NSE:INFY";
  try {
    const zerodha = await fetchBuffer(zerodhaQuoteUrl, { "X-Kite-Version": "3" });
    result.zerodhaUnauthenticatedQuote = {
      status: zerodha.ok ? "UNEXPECTED_AVAILABLE" : "AUTH_OR_ENTITLEMENT_REQUIRED",
      source: zerodhaQuoteUrl,
      httpStatus: zerodha.status,
      contentType: zerodha.headers["content-type"] ?? null,
      bodyHash: sha256(zerodha.buffer),
      persistedBody: false,
      dataState: classifyDataState({
        kind: "live",
        observedAt: generatedAt,
        authenticated: false,
        liveEntitlement: false,
        available: zerodha.ok,
      }),
    };
  } catch (error) {
    result.zerodhaUnauthenticatedQuote = {
      status: "ERROR",
      source: zerodhaQuoteUrl,
      error: error instanceof Error ? error.message : String(error),
      dataState: "UNAVAILABLE",
    };
  }

  result.zerodhaAuthenticatedFixture = {
    status: "DOCUMENTED_FIXTURE_NORMALIZED",
    source: "https://kite.trade/docs/connect/v3/market-quotes/",
    note: "Fixture only; no credentialed quote was requested unless ZERODHA_API_KEY and ZERODHA_ACCESS_TOKEN are set locally.",
    normalized: {
      canonicalIdentity: "NSE:INFY",
      providerToken: "408065",
      lastPrice: "decimal-from-provider",
      quoteTimestamp: "exchange timestamp",
      fields: ["last_price", "ohlc.close", "volume", "depth", "lower_circuit_limit", "upper_circuit_limit"],
    },
    dataState: "LIVE",
  };

  const apiKey = process.env.ZERODHA_API_KEY;
  const accessToken = process.env.ZERODHA_ACCESS_TOKEN;
  if (!apiKey || !accessToken) {
    result.zerodhaCredentialedQuote = {
      status: "SKIPPED_NO_CREDENTIALS",
      source: zerodhaQuoteUrl,
      dataState: "UNAVAILABLE",
    };
  } else {
    try {
      const credentialed = await fetchBuffer(zerodhaQuoteUrl, {
        "X-Kite-Version": "3",
        Authorization: `token ${apiKey}:${accessToken}`,
      });
      result.zerodhaCredentialedQuote = {
        status: credentialed.ok ? "AVAILABLE_AUTHENTIC_AUTHENTICATED" : "UNAVAILABLE_OR_TOKEN_EXPIRED",
        source: zerodhaQuoteUrl,
        httpStatus: credentialed.status,
        bodyHash: sha256(credentialed.buffer),
        persistedBody: false,
        dataState: classifyDataState({
          kind: "live",
          observedAt: generatedAt,
          authenticated: credentialed.ok,
          liveEntitlement: credentialed.ok,
          available: credentialed.ok,
        }),
      };
    } catch (error) {
      result.zerodhaCredentialedQuote = {
        status: "ERROR",
        source: zerodhaQuoteUrl,
        error: error instanceof Error ? error.message : String(error),
        dataState: "UNAVAILABLE",
      };
    }
  }

  const upstoxUrl = "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz";
  try {
    const upstox = await fetchBuffer(upstoxUrl);
    let rows = [];
    if (upstox.ok) rows = JSON.parse(gunzipSync(upstox.buffer).toString("utf8"));
    const matches = rows
      .filter((row) => {
        const haystack = `${row.trading_symbol ?? ""} ${row.tradingsymbol ?? ""} ${row.name ?? ""}`.toLowerCase();
        return row.segment === "NSE_EQ" && /\binfy\b|infosys/.test(haystack);
      })
      .slice(0, 8)
      .map(classifyUpstoxInstrument);
    result.equityDiscovery = {
      status: upstox.ok && matches.length > 0 ? "AVAILABLE_PUBLIC_MASTER" : "UNAVAILABLE",
      source: upstoxUrl,
      httpStatus: upstox.status,
      rawHash: sha256(upstox.buffer),
      totalRowsSeen: rows.length,
      sampleQuery: "infy",
      matches,
      provenance: "Public Upstox BOD instrument master used only to prove identity search shape; provider identifiers remain mappings, not canonical identities.",
    };
  } catch (error) {
    result.equityDiscovery = {
      status: "ERROR",
      source: upstoxUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const amfiUrl = "https://www.amfiindia.com/spages/NAVAll.txt";
  try {
    const amfi = await fetchBuffer(amfiUrl);
    const navText = amfi.buffer.toString("utf8");
    const matches = amfi.ok ? parseAmfiNav(navText, "parag parikh flexi cap direct growth") : [];
    const firstDate = matches[0]?.date ?? null;
    result.mutualFundAmfi = {
      status: amfi.ok && matches.length > 0 ? "AVAILABLE_OFFICIAL_NAV" : "UNAVAILABLE",
      source: amfiUrl,
      finalUrl: amfi.finalUrl,
      httpStatus: amfi.status,
      rawHash: sha256(amfi.buffer),
      totalLinesSeen: navText.split(/\r?\n/).length,
      sampleQuery: "parag parikh flexi cap direct growth",
      matches,
      latestMatchedDate: firstDate,
      dataState: classifyDataState({ kind: "nav", observedAt: generatedAt, valuationDate: firstDate, available: matches.length > 0 }),
      provenance: "AMFI latest NAV text is official daily NAV evidence, not live intraday pricing.",
    };
  } catch (error) {
    result.mutualFundAmfi = {
      status: "ERROR",
      source: amfiUrl,
      error: error instanceof Error ? error.message : String(error),
      dataState: "UNAVAILABLE",
    };
  }

  try {
    const searchUrl = "https://api.mfapi.in/mf/search?q=parag%20parikh%20flexi%20cap%20direct%20growth";
    const search = await fetchBuffer(searchUrl);
    const candidates = search.ok ? JSON.parse(search.buffer.toString("utf8")).slice(0, 8) : [];
    const best = candidates.find((candidate) => /parag parikh flexi cap fund.*direct plan.*growth/i.test(candidate.schemeName)) ?? candidates[0];
    let latest = null;
    if (best?.schemeCode) {
      const latestResponse = await fetchBuffer(`https://api.mfapi.in/mf/${best.schemeCode}/latest`);
      latest = latestResponse.ok ? JSON.parse(latestResponse.buffer.toString("utf8")) : { httpStatus: latestResponse.status };
    }
    const latestDate = latest?.data?.[0]?.date ?? null;
    result.mutualFundMfapi = {
      status: best && latest?.data?.length ? "AVAILABLE_CONVENIENCE_NAV" : "UNAVAILABLE",
      source: searchUrl,
      httpStatus: search.status,
      candidates,
      selectedSchemeCode: best?.schemeCode ?? null,
      latestDate,
      latestNavPresent: Boolean(latest?.data?.[0]?.nav),
      dataState: classifyDataState({ kind: "nav", observedAt: generatedAt, valuationDate: latestDate, available: Boolean(latest?.data?.length) }),
      provenance: "MFAPI is a free convenience JSON service. It is not the official source; cross-check latest values against AMFI before using for valuation.",
    };
  } catch (error) {
    result.mutualFundMfapi = {
      status: "ERROR",
      source: "https://api.mfapi.in/mf/search",
      error: error instanceof Error ? error.message : String(error),
      dataState: "UNAVAILABLE",
    };
  }

  result.stateFixtures = [
    { name: "Zerodha authenticated quote fixture", state: "LIVE" },
    { name: "NSE/BSE bhavcopy previous close fixture", state: "EOD" },
    { name: "AMFI matched NAV", state: result.mutualFundAmfi.dataState },
    { name: "60-day-old NAV fixture", state: "STALE" },
    { name: "Unauthenticated Zerodha live quote", state: result.zerodhaUnauthenticatedQuote.dataState },
  ];

  result.providerStates = [
    {
      provider: "Zerodha Kite Connect",
      assetClass: "Equity",
      data: "LTP/full quote/OHLC/depth, historical candles, WebSocket stream",
      state: result.zerodhaCredentialedQuote.status === "AVAILABLE_AUTHENTIC_AUTHENTICATED" ? "LIVE" : "AUTH_REQUIRED",
      expectedUse: "Preferred authenticated source for Zerodha users after paid data entitlement; also source for holdings, positions, orders and fills.",
    },
    {
      provider: "AMFI",
      assetClass: "Mutual fund",
      data: "Latest scheme NAV dump",
      state: result.mutualFundAmfi.dataState,
      expectedUse: "Official daily NAV valuation and scheme identity cross-check.",
    },
    {
      provider: "MFAPI",
      assetClass: "Mutual fund",
      data: "Search and JSON NAV convenience cache",
      state: result.mutualFundMfapi.dataState,
      expectedUse: "Search UX and history convenience, cross-checked against AMFI.",
    },
    {
      provider: "Upstox public master",
      assetClass: "Equity",
      data: "Instrument discovery",
      state: result.equityDiscovery.status,
      expectedUse: "Private-cache discovery fallback; not authoritative price and not a canonical instrument id.",
    },
  ];

  const outputPath = join(artifactRoot, "provider-spike-result.json");
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, generatedAt: result.generatedAt, states: result.providerStates }, null, 2));
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
