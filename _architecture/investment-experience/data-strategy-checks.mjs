#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { get as httpsGet } from "node:https";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";

const ARTIFACT_DIR = "D:/WorkStation/Artifacts/stock-mania-investment-20260906/data";
const FETCH_TIMEOUT_MS = 60_000;
const TRANSIENT_STATUS = new Set([408, 425, 429]);
const PROVIDERS = {
  upstox: {
    url: "https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz",
    path: join(ARTIFACT_DIR, "upstox-nse.json.gz"),
  },
  dhan: {
    url: "https://images.dhan.co/api-data/api-scrip-master-detailed.csv",
    path: join(ARTIFACT_DIR, "dhan-scrip-master-detailed.csv"),
  },
};

const argv = new Set(process.argv.slice(2));
const refresh = argv.has("--refresh");
const syntheticCatalogue = argv.has("--synthetic-catalogue");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function requestBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const request = httpsGet(
      url,
      { headers: { "user-agent": "Stock-Mania-isolated-experiment/1.0" } },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          if (redirectsLeft === 0) {
            reject(Object.assign(new Error("Redirect limit exceeded"), { transient: false, status }));
            return;
          }
          resolve(requestBuffer(new URL(response.headers.location, url).href, redirectsLeft - 1));
          return;
        }

        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve({
          body: Buffer.concat(chunks),
          finalUrl: url,
          status,
          headers: response.headers,
        }));
      },
    );
    request.setTimeout(FETCH_TIMEOUT_MS, () => {
      request.destroy(Object.assign(new Error(`Fetch timed out after ${FETCH_TIMEOUT_MS} ms`), { transient: true }));
    });
    request.on("error", (error) => {
      error.transient = error.transient ?? true;
      reject(error);
    });
  });
}

function statusIsTransient(status) {
  return TRANSIENT_STATUS.has(status) || status >= 500;
}

async function fetchWithBoundedRetry(provider, destination) {
  const attempts = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await requestBuffer(provider.url);
      attempts.push({ attempt, status: response.status });
      if (response.status !== 200) {
        const error = Object.assign(new Error(`HTTP ${response.status}`), {
          status: response.status,
          transient: statusIsTransient(response.status),
        });
        if (!error.transient || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
        continue;
      }

      const temporary = `${destination}.partial`;
      await writeFile(temporary, response.body);
      await rename(temporary, destination);
      return {
        state: "FETCHED",
        sourceUrl: provider.url,
        finalUrl: response.finalUrl,
        fetchedAt: new Date().toISOString(),
        finalHttpStatus: response.status,
        bytes: response.body.byteLength,
        sha256: sha256(response.body),
        attempts,
        snapshot: destination,
      };
    } catch (error) {
      attempts.push({ attempt, error: error.message, status: error.status ?? null });
      if (!error.transient || attempt === 2) {
        return {
          state: "FAILED",
          sourceUrl: provider.url,
          failedAt: new Date().toISOString(),
          finalHttpStatus: error.status ?? null,
          error: error.message,
          attempts,
          snapshot: destination,
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
    }
  }
  throw new Error("Unreachable retry state");
}

async function loadProvider(name, provider) {
  if (refresh) return fetchWithBoundedRetry(provider, provider.path);
  try {
    const body = await readFile(provider.path);
    return {
      state: "REUSED_PRIVATE_SNAPSHOT",
      sourceUrl: provider.url,
      readAt: new Date().toISOString(),
      finalHttpStatus: null,
      bytes: body.byteLength,
      sha256: sha256(body),
      attempts: [],
      snapshot: provider.path,
    };
  } catch (error) {
    return {
      state: "FAILED",
      sourceUrl: provider.url,
      failedAt: new Date().toISOString(),
      finalHttpStatus: null,
      error: `${name} snapshot unavailable; run with --refresh (${error.code ?? error.message})`,
      attempts: [],
      snapshot: provider.path,
    };
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (quoted) throw new Error("CSV ended inside a quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
    rows.push(row);
  }
  return rows;
}

function normalizeText(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function parseUpstox(buffer) {
  const jsonBytes = buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer;
  const source = JSON.parse(jsonBytes.toString("utf8"));
  if (!Array.isArray(source)) throw new Error("Upstox master root is not an array");
  const exclusions = { nonNseCashEq: 0, invalidIsin: 0, missingSymbol: 0 };
  const normalized = [];
  for (const item of source) {
    if (item?.exchange !== "NSE" || item?.segment !== "NSE_EQ" || item?.instrument_type !== "EQ") {
      exclusions.nonNseCashEq += 1;
      continue;
    }
    const isin = normalizeText(item.isin);
    const symbol = normalizeText(item.trading_symbol);
    if (!/^[A-Z0-9]{12}$/.test(isin)) {
      exclusions.invalidIsin += 1;
      continue;
    }
    if (!symbol) {
      exclusions.missingSymbol += 1;
      continue;
    }
    normalized.push({
      isin,
      symbol,
      name: normalizeText(item.name),
      providerId: String(item.instrument_key ?? ""),
      providerToken: String(item.exchange_token ?? ""),
    });
  }
  return { sourceRows: source.length, normalized, exclusions };
}

function firstPresent(record, names) {
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

function parseDhan(buffer) {
  const rows = parseCsv(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("Dhan CSV has no data rows");
  const headers = rows[0].map(normalizeText);
  const malformed = [];
  const records = [];
  for (let index = 1; index < rows.length; index += 1) {
    if (rows[index].length === 1 && rows[index][0] === "") continue;
    if (rows[index].length !== headers.length) {
      malformed.push({ line: index + 1, fields: rows[index].length, expected: headers.length });
      continue;
    }
    records.push(Object.fromEntries(headers.map((header, column) => [header, rows[index][column]])));
  }
  if (malformed.length > 0) {
    throw new Error(`Dhan CSV contains ${malformed.length} structurally malformed rows; first=${JSON.stringify(malformed[0])}`);
  }

  const exclusions = { nonNseCashEq: 0, invalidIsin: 0, missingSymbol: 0 };
  const normalized = [];
  for (const item of records) {
    const exchange = normalizeText(firstPresent(item, ["EXCH_ID", "SEM_EXM_EXCH_ID"]));
    const segment = normalizeText(firstPresent(item, ["SEGMENT", "SEM_SEGMENT"]));
    const series = normalizeText(firstPresent(item, ["SERIES", "SEM_SERIES"]));
    if (exchange !== "NSE" || !["E", "EQ", "EQUITY"].includes(segment) || series !== "EQ") {
      exclusions.nonNseCashEq += 1;
      continue;
    }
    const isin = normalizeText(firstPresent(item, ["ISIN", "SEM_ISIN"]));
    const symbol = normalizeText(firstPresent(item, ["UNDERLYING_SYMBOL", "SEM_TRADING_SYMBOL", "SM_SYMBOL_NAME"]));
    if (!/^[A-Z0-9]{12}$/.test(isin)) {
      exclusions.invalidIsin += 1;
      continue;
    }
    if (!symbol) {
      exclusions.missingSymbol += 1;
      continue;
    }
    normalized.push({
      isin,
      symbol,
      name: normalizeText(firstPresent(item, ["SYMBOL_NAME", "SM_SYMBOL_NAME", "DISPLAY_NAME", "SEM_CUSTOM_SYMBOL"])),
      providerId: String(firstPresent(item, ["SECURITY_ID", "SEM_SMST_SECURITY_ID", "SM_SECURITY_ID"])),
      providerToken: String(firstPresent(item, ["SECURITY_ID", "SEM_SMST_SECURITY_ID", "SM_SECURITY_ID"])),
    });
  }
  return { sourceRows: records.length, headers, normalized, exclusions };
}

function syntheticCatalogueRows() {
  const base = [
    ["INE002A01018", "RELIANCE", "RELIANCE INDUSTRIES LTD"],
    ["INE009A01021", "INFY", "INFOSYS LIMITED"],
    ["INE467B01029", "TCS", "TATA CONSULTANCY SERVICES LTD"],
    ["INE101A01026", "M&M", "MAHINDRA & MAHINDRA LIMITED"],
    ["INE040A01034", "HDFCBANK", "HDFC BANK LIMITED"],
    ["INE001A01036", "HDFC", "HDFC LIMITED"],
    ["INE081A01020", "TATANSTEEL", "TATA STEEL LIMITED"],
    ["INE296A01024", "BAJAJHIND", "BAJAJ HINDUSTHAN SUGAR LIMITED"],
    ["INE344S01016", "INFINIUM", "INFINIUM PHARMACHEM LIMITED"],
  ];
  const make = (provider) => base.map(([isin, symbol, name], index) => ({
    isin, symbol, name, providerId: `${provider}-${index + 1}`, providerToken: `${index + 1}`,
  }));
  return {
    upstox: { sourceRows: base.length, normalized: make("UP"), exclusions: {} },
    dhan: { sourceRows: base.length, normalized: make("DH"), exclusions: {}, headers: ["SYNTHETIC"] },
  };
}

function buildJoinedCatalogue(upstox, dhan) {
  const group = (items) => {
    const map = new Map();
    for (const item of items) {
      const existing = map.get(item.isin) ?? [];
      existing.push(item);
      map.set(item.isin, existing);
    }
    return map;
  };
  const upByIsin = group(upstox.normalized);
  const dhanByIsin = group(dhan.normalized);
  const joined = [];
  for (const [isin, upRows] of upByIsin) {
    const dhanRows = dhanByIsin.get(isin);
    if (!dhanRows) continue;
    const symbols = [...new Set([...upRows, ...dhanRows].map((row) => row.symbol).filter(Boolean))];
    const names = [...new Set([...upRows, ...dhanRows].map((row) => row.name).filter(Boolean))];
    joined.push({
      internalIdentity: `ISIN:${isin}`,
      isin,
      symbols,
      names,
      providers: {
        upstox: upRows.map(({ providerId, providerToken, symbol }) => ({ providerId, providerToken, symbol })),
        dhan: dhanRows.map(({ providerId, providerToken, symbol }) => ({ providerId, providerToken, symbol })),
      },
    });
  }
  return joined.sort((a, b) => a.isin.localeCompare(b.isin));
}

function searchCatalogue(catalogue, rawQuery) {
  const query = normalizeText(rawQuery);
  let matchKind = "unknown";
  let candidates = [];
  if (/^[A-Z0-9]{12}$/.test(query)) {
    matchKind = "exact_isin";
    candidates = catalogue.filter((item) => item.isin === query);
  } else {
    const exactSymbol = catalogue.filter((item) => item.symbols.includes(query));
    const exactName = catalogue.filter((item) => item.names.includes(query));
    if (exactSymbol.length > 0) {
      matchKind = "exact_symbol";
      candidates = exactSymbol;
    } else if (exactName.length > 0) {
      matchKind = "exact_name";
      candidates = exactName;
    } else {
      matchKind = "prefix";
      candidates = catalogue.filter((item) =>
        item.symbols.some((symbol) => symbol.startsWith(query)) || item.names.some((name) => name.startsWith(query)),
      );
    }
  }
  return {
    query,
    matchKind: candidates.length === 0 ? "unknown" : matchKind,
    candidateCount: candidates.length,
    candidateIsins: candidates.map((candidate) => candidate.isin),
    selected: candidates.length === 1 ? candidates[0].internalIdentity : null,
  };
}

const FIXTURES = [
  { id: "reliance-isin", query: "INE002A01018", kind: "exact_isin", selectedIsin: "INE002A01018" },
  { id: "reliance-symbol", query: "RELIANCE", kind: "exact_symbol", selectedIsin: "INE002A01018" },
  { id: "infosys-isin", query: "INE009A01021", kind: "exact_isin", selectedIsin: "INE009A01021" },
  { id: "infosys-symbol", query: "INFY", kind: "exact_symbol", selectedIsin: "INE009A01021" },
  { id: "tcs-isin", query: "INE467B01029", kind: "exact_isin", selectedIsin: "INE467B01029" },
  { id: "tcs-symbol", query: "TCS", kind: "exact_symbol", selectedIsin: "INE467B01029" },
  { id: "reliance-name", query: "RELIANCE INDUSTRIES LTD", kind: "exact_name", selectedIsin: "INE002A01018" },
  { id: "tcs-name", query: "TATA CONSULTANCY SERVICES LTD", kind: "exact_name", selectedIsin: "INE467B01029" },
  { id: "punctuated-symbol", query: "M&M", kind: "exact_symbol", selectedIsin: "INE101A01026" },
  { id: "tata-prefix", query: "TATA", kind: "prefix", ambiguous: true },
  { id: "hdfc-prefix", query: "HDFC", kind: "prefix", ambiguous: true },
  { id: "inf-prefix", query: "INF", kind: "prefix", ambiguous: true, includesIsin: "INE009A01021" },
  { id: "unknown", query: "XZQ-NOT-A-LISTING", kind: "unknown", candidateCount: 0 },
];

function runFixture(fixture, catalogue) {
  const actual = searchCatalogue(catalogue, fixture.query);
  const failures = [];
  if (actual.matchKind !== fixture.kind) failures.push(`kind expected ${fixture.kind}, got ${actual.matchKind}`);
  if (fixture.selectedIsin && actual.selected !== `ISIN:${fixture.selectedIsin}`) {
    failures.push(`selected expected ISIN:${fixture.selectedIsin}, got ${actual.selected}`);
  }
  if (fixture.ambiguous && !(actual.candidateCount > 1 && actual.selected === null)) {
    failures.push(`expected ambiguity with no selection, got ${actual.candidateCount}/${actual.selected}`);
  }
  if (fixture.includesIsin && !actual.candidateIsins.includes(fixture.includesIsin)) {
    failures.push(`expected candidates to include ${fixture.includesIsin}`);
  }
  if (fixture.candidateCount !== undefined && actual.candidateCount !== fixture.candidateCount) {
    failures.push(`candidateCount expected ${fixture.candidateCount}, got ${actual.candidateCount}`);
  }
  const selected = actual.selected && catalogue.find((item) => item.internalIdentity === actual.selected);
  if (selected && (!selected.providers.upstox.length || !selected.providers.dhan.length)) {
    failures.push("selected identity is not represented by both providers");
  }
  return { id: fixture.id, pass: failures.length === 0, failures, actual };
}

function mulberry32(seed) {
  return () => {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function nextTradingDate(date) {
  const candidate = new Date(date);
  do candidate.setUTCDate(candidate.getUTCDate() + 1);
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6);
  return candidate;
}

function generateSessions(seed = 20260906) {
  const random = mulberry32(seed);
  const sessions = [];
  let date = new Date("2026-01-01T00:00:00.000Z");
  let priorClose = 150;
  for (let day = 0; day < 90; day += 1) {
    date = nextTradingDate(date);
    const direction = random() < 0.5 ? -1 : 1;
    let price = priorClose * (1 + (random() - 0.5) * 0.004);
    const bars = [];
    for (let index = 0; index < 75; index += 1) {
      const open = price;
      const openingNoise = index < 3 ? 0.22 : 0.08;
      const impulse = index >= 5 && index <= 22 ? direction * 0.055 : direction * 0.005;
      const change = impulse + (random() - 0.5) * openingNoise;
      const close = Math.max(5, open + change);
      const wick = 0.025 + random() * 0.07;
      const high = Math.max(open, close) + wick;
      const low = Math.min(open, close) - wick;
      bars.push({ index, open, high, low, close });
      price = close;
    }
    priorClose = price;
    sessions.push({ date: date.toISOString().slice(0, 10), bars });
  }
  return sessions;
}

function evaluateIntent(intent, state) {
  if (state.killSwitch) return { allowed: false, reason: "KILL_SWITCH" };
  if (state.nowMs - intent.observedAtMs > state.maxQuoteAgeMs) return { allowed: false, reason: "STALE_DATA" };
  if (state.dailyNetPnl <= -state.dailyLossLimit) return { allowed: false, reason: "DAILY_LOSS_LIMIT" };
  if (state.seenIntentIds.has(intent.id)) return { allowed: false, reason: "DUPLICATE_INTENT" };
  state.seenIntentIds.add(intent.id);
  return { allowed: true, reason: "ALLOWED" };
}

function findSignal(session) {
  const opening = session.bars.slice(0, 3);
  const rangeHigh = Math.max(...opening.map((bar) => bar.high));
  const rangeLow = Math.min(...opening.map((bar) => bar.low));
  for (let index = 3; index < session.bars.length; index += 1) {
    const bar = session.bars[index];
    if (bar.close > rangeHigh) return { signalIndex: index, side: "LONG", rangeHigh, rangeLow };
    if (bar.close < rangeLow) return { signalIndex: index, side: "SHORT", rangeHigh, rangeLow };
  }
  return null;
}

function simulateTrade(session, frictionBps, latencyBars) {
  const signal = findSignal(session);
  if (!signal) return null;
  const fillIndex = signal.signalIndex + latencyBars;
  if (fillIndex >= session.bars.length) return null;
  const entryReference = session.bars[fillIndex].open;
  const rangeWidth = Math.max(0.05, signal.rangeHigh - signal.rangeLow);
  const stopDistance = rangeWidth * 0.75;
  const targetDistance = rangeWidth * 1.25;
  const quantity = Math.max(1, Math.min(1000, Math.floor(1000 / stopDistance)));
  const sideSign = signal.side === "LONG" ? 1 : -1;
  const stop = entryReference - sideSign * stopDistance;
  const target = entryReference + sideSign * targetDistance;
  let exitIndex = session.bars.length - 1;
  let exitReference = session.bars[exitIndex].close;
  let exitReason = "SESSION_CLOSE";
  for (let index = fillIndex; index < session.bars.length; index += 1) {
    const bar = session.bars[index];
    const hitStop = signal.side === "LONG" ? bar.low <= stop : bar.high >= stop;
    const hitTarget = signal.side === "LONG" ? bar.high >= target : bar.low <= target;
    if (hitStop) {
      exitIndex = index;
      exitReference = stop;
      exitReason = "STOP";
      break;
    }
    if (hitTarget) {
      exitIndex = index;
      exitReference = target;
      exitReason = "TARGET";
      break;
    }
  }
  const frictionRate = frictionBps / 10_000;
  const entryExecuted = entryReference * (1 + sideSign * frictionRate);
  const exitExecuted = exitReference * (1 - sideSign * frictionRate);
  const grossPnl = sideSign * (exitReference - entryReference) * quantity;
  const netPnl = sideSign * (exitExecuted - entryExecuted) * quantity;
  return {
    id: session.date,
    side: signal.side,
    signalIndex: signal.signalIndex,
    fillIndex,
    exitIndex,
    entryReference,
    exitReference,
    exitReason,
    quantity,
    frictionBpsEachSide: frictionBps,
    grossPnl,
    frictionCost: grossPnl - netPnl,
    netPnl,
  };
}

function maximumDrawdown(values) {
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const value of values) {
    equity += value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return maxDrawdown;
}

function metrics(trades) {
  const total = (field) => trades.reduce((sum, trade) => sum + trade[field], 0);
  return {
    tradeCount: trades.length,
    grossExpectancy: trades.length ? total("grossPnl") / trades.length : null,
    netExpectancy: trades.length ? total("netPnl") / trades.length : null,
    grossPnl: total("grossPnl"),
    netPnl: total("netPnl"),
    maximumDrawdown: maximumDrawdown(trades.map((trade) => trade.netPnl)),
  };
}

function runReplay(sessions) {
  const rows = [];
  const allTrades = new Map();
  for (const segment of ["development", "holdout"]) {
    const selectedSessions = segment === "development" ? sessions.slice(0, 60) : sessions.slice(60);
    for (const latencyBars of [1, 2]) {
      for (const frictionBps of [0, 5, 10, 20]) {
        const key = `${segment}|${latencyBars}|${frictionBps}`;
        const trades = selectedSessions.map((session) => simulateTrade(session, frictionBps, latencyBars)).filter(Boolean);
        allTrades.set(key, trades);
        rows.push({ segment, latencyBars, frictionBpsEachSide: frictionBps, ...metrics(trades) });
      }
    }
  }

  const temporalTrades = [...allTrades.values()].flat();
  assert(temporalTrades.length > 0, "Replay must produce at least one trade");
  assert(temporalTrades.every((trade) => trade.fillIndex > trade.signalIndex), "Every fill must follow a completed signal bar");
  assert(temporalTrades.every((trade) => trade.exitIndex >= trade.fillIndex), "No exit may precede entry");

  for (const segment of ["development", "holdout"]) {
    for (const latencyBars of [1, 2]) {
      const variants = [0, 5, 10, 20].map((cost) => allTrades.get(`${segment}|${latencyBars}|${cost}`));
      const baselineIds = variants[0].map((trade) => trade.id).join("|");
      assert(variants.every((trades) => trades.map((trade) => trade.id).join("|") === baselineIds), "Cost variants must retain matched fill paths");
      for (let tradeIndex = 0; tradeIndex < variants[0].length; tradeIndex += 1) {
        for (let costIndex = 1; costIndex < variants.length; costIndex += 1) {
          assert(
            variants[costIndex][tradeIndex].netPnl <= variants[costIndex - 1][tradeIndex].netPnl + 1e-9,
            "Higher friction must not improve matched-fill net P&L",
          );
        }
      }
    }
  }

  const nowMs = Date.parse("2026-09-06T09:30:00.000Z");
  const baseState = () => ({ nowMs, maxQuoteAgeMs: 30_000, dailyNetPnl: 0, dailyLossLimit: 1000, killSwitch: false, seenIntentIds: new Set() });
  const stale = evaluateIntent({ id: "stale", observedAtMs: nowMs - 30_001 }, baseState());
  const duplicateState = baseState();
  evaluateIntent({ id: "same", observedAtMs: nowMs }, duplicateState);
  const duplicate = evaluateIntent({ id: "same", observedAtMs: nowMs }, duplicateState);
  const lossState = baseState();
  lossState.dailyNetPnl = -1000;
  const loss = evaluateIntent({ id: "loss", observedAtMs: nowMs }, lossState);
  const killState = baseState();
  killState.killSwitch = true;
  const kill = evaluateIntent({ id: "kill", observedAtMs: nowMs }, killState);
  assert.equal(stale.reason, "STALE_DATA");
  assert.equal(duplicate.reason, "DUPLICATE_INTENT");
  assert.equal(loss.reason, "DAILY_LOSS_LIMIT");
  assert.equal(kill.reason, "KILL_SWITCH");

  return {
    seed: 20260906,
    sessions: sessions.length,
    split: { development: 60, holdout: 30 },
    rows,
    costModel: "Synthetic combined fee-and-slippage assumption in bps each side; not an Indian statutory charge schedule",
    sameBarCollisionPolicy: "STOP_FIRST_CONSERVATIVE",
    assertions: {
      noLookahead: "PASS",
      exitsAfterEntry: "PASS",
      costsNeverImproveMatchedFillNet: "PASS",
      staleDataBlock: stale,
      duplicateIntentBlock: duplicate,
      dailyLossGateBlock: loss,
      killSwitchBlock: kill,
    },
  };
}

async function main() {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  if (refresh) {
    await Promise.all(Object.values(PROVIDERS).map((provider) => rm(`${provider.path}.partial`, { force: true })));
  }
  const [upstoxFetch, dhanFetch] = await Promise.all([
    loadProvider("upstox", PROVIDERS.upstox),
    loadProvider("dhan", PROVIDERS.dhan),
  ]);
  const fetched = { upstox: upstoxFetch, dhan: dhanFetch };

  let catalogueResult;
  const bothAvailable = upstoxFetch.state !== "FAILED" && dhanFetch.state !== "FAILED";
  try {
    let parsed;
    let sourceMode = "LIVE_PUBLIC_MASTER_SNAPSHOT";
    if (bothAvailable) {
      const [upstoxBody, dhanBody] = await Promise.all([readFile(PROVIDERS.upstox.path), readFile(PROVIDERS.dhan.path)]);
      parsed = { upstox: parseUpstox(upstoxBody), dhan: parseDhan(dhanBody) };
    } else if (syntheticCatalogue) {
      parsed = syntheticCatalogueRows();
      sourceMode = "SYNTHETIC_FALLBACK";
    } else {
      throw new Error("One or both public masters are unavailable; synthetic fallback was not requested");
    }
    const joined = buildJoinedCatalogue(parsed.upstox, parsed.dhan);
    const fixtures = FIXTURES.map((fixture) => runFixture(fixture, joined));
    catalogueResult = {
      status: sourceMode === "LIVE_PUBLIC_MASTER_SNAPSHOT" && fixtures.every((fixture) => fixture.pass) ? "PASS" : "FAIL",
      sourceMode,
      counts: {
        upstoxSourceRows: parsed.upstox.sourceRows,
        upstoxNseCashEq: parsed.upstox.normalized.length,
        dhanSourceRows: parsed.dhan.sourceRows,
        dhanNseCashEq: parsed.dhan.normalized.length,
        exactIsinIntersection: joined.length,
      },
      exclusions: { upstox: parsed.upstox.exclusions, dhan: parsed.dhan.exclusions },
      fixturesPassed: fixtures.filter((fixture) => fixture.pass).length,
      fixturesTotal: fixtures.length,
      fixtures,
      ambiguityPolicy: "candidateCount > 1 always yields selected: null; no fuzzy matcher exists",
    };
  } catch (error) {
    catalogueResult = {
      status: "BLOCKED",
      sourceMode: bothAvailable ? "LIVE_PUBLIC_MASTER_SNAPSHOT" : "UNAVAILABLE",
      error: error.message,
      fixturesPassed: 0,
      fixturesTotal: FIXTURES.length,
    };
  }

  const sessions = generateSessions();
  const replay = runReplay(sessions);
  const reproducibilityInput = JSON.stringify(replay);
  const secondReplay = runReplay(generateSessions());
  assert.equal(JSON.stringify(secondReplay), reproducibilityInput, "Fixed seed replay must reproduce byte-for-byte JSON output");
  replay.reproducibilityHash = sha256(reproducibilityInput);
  replay.assertions.fixedSeedReproducibility = "PASS";

  const report = {
    generatedAt: new Date().toISOString(),
    experiment: "instrument identity normalization and synthetic ORB replay",
    fetches: fetched,
    catalogue: catalogueResult,
    replay,
    decision: {
      catalogueHarness: catalogueResult.status === "PASS" ? "KEEP_DESIGN_FOR_IMPLEMENTATION_REVIEW" : "REVISE_OR_RERUN",
      replayHarness: "KEEP_DESIGN_FOR_LICENSED_REAL_DATA_EVALUATION",
      liveStrategyPromotion: "DISCARD",
      reason: "Synthetic bars and catalogue identity checks do not establish real-world profitability, execution quality, or broker readiness.",
    },
  };
  const resultPath = join(ARTIFACT_DIR, "data-strategy-results.json");
  await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    resultPath,
    fetches: Object.fromEntries(Object.entries(fetched).map(([name, value]) => [name, {
      state: value.state, status: value.finalHttpStatus, bytes: value.bytes, sha256: value.sha256, attempts: value.attempts.length,
    }])),
    catalogue: {
      status: catalogueResult.status,
      sourceMode: catalogueResult.sourceMode,
      counts: catalogueResult.counts,
      fixtures: `${catalogueResult.fixturesPassed}/${catalogueResult.fixturesTotal}`,
      failures: catalogueResult.fixtures?.filter((fixture) => !fixture.pass).map((fixture) => ({ id: fixture.id, failures: fixture.failures, actual: fixture.actual })) ?? [],
      error: catalogueResult.error,
    },
    replay: { rows: replay.rows, assertions: replay.assertions, reproducibilityHash: replay.reproducibilityHash },
    decision: report.decision,
  }, null, 2));
  if (catalogueResult.status !== "PASS") process.exitCode = 1;
}

main().catch((error) => {
  console.error(`${basename(process.argv[1])}: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
