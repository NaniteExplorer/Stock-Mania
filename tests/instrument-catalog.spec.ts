import { FixedClock, UserId } from "@/core/kernel";
import {
  CatalogCandidate,
  CatalogInstrumentId,
  CatalogQuoteKeyState,
  CatalogSnapshot,
  InstrumentCatalogRepository,
  QuoteKeyCandidateListing,
  QuoteKeyProbeResult,
  QuoteKeyResolution,
  acceptQuoteKeyProbe,
  candidateQuoteKeys,
  isPriceable,
  isQuoteKeyRevalidationDue,
} from "@/domain/instrument-catalog";
import { RefreshInstrumentCatalog, SearchInstrumentCatalog } from "@/app/instrument-catalog.usecases";
import {
  AmfiMutualFundMaster,
  BSE_EQUITY_GROUPS,
  InstrumentQuoteKeyReconciler,
  MoneycontrolScIdHarvester,
  SecCompanyTickerMaster,
  UpstoxBsePublicInstrumentMaster,
  UpstoxPublicInstrumentMaster,
  ZerodhaInstrumentCsvMapping,
  type QuoteKeyProbePort,
} from "@/infra/instrument-catalog";
import type { HttpClient, HttpResponse } from "@/infra/providers";
import { CatalogQuoteKeyStubs } from "./doubles";
import { check, checkTrue, done, section } from "./harness";

const now = new Date("2026-09-06T04:00:00.000Z");
const catalogId = CatalogInstrumentId.from("11111111-1111-4111-8111-111111111111");
const tcs: CatalogCandidate = {
  catalogInstrumentId: catalogId,
  isin: "INE467B01029",
  name: "TATA CONSULTANCY SERV LT",
  instrumentType: "EQUITY",
  listing: {
    id: "listing-tcs", exchange: "NSE", segment: "NSE_EQ", symbol: "TCS",
    name: "TATA CONSULTANCY SERV LT", instrumentType: "EQUITY", currency: "INR",
    active: true, source: "UPSTOX_PUBLIC", fetchedAt: now, checksum: "a".repeat(64),
  },
  providerMappings: [{
    id: "mapping-tcs", provider: "UPSTOX", providerInstrumentId: "NSE_EQ|INE467B01029",
    providerToken: "11536", tradingSymbol: "TCS", effectiveFrom: "2026-09-06",
    effectiveThrough: null, source: "UPSTOX_PUBLIC", fetchedAt: now, checksum: "a".repeat(64),
  }],
};

class SearchFixtureRepository extends CatalogQuoteKeyStubs implements InstrumentCatalogRepository {
  async latestSuccessfulFetch() {
    return { source: "UPSTOX_PUBLIC", fetchedAt: now, checksum: "a".repeat(64), rowCount: 1 };
  }
  async latestFetchAttempt() {
    return { source: "UPSTOX_PUBLIC", attemptedAt: now, outcome: "SUCCESS" as const };
  }
  async recordFetchFailure() {}
  async count() { return 1; }
  async ingest(_snapshot: CatalogSnapshot) {
    return { instruments: 0, listings: 0, mappings: 0, unmatchedMappings: 0 };
  }
  async search(query: string) {
    const candidate = ["TCS", "INE467B01029", "TATA CONSULTANCY SERV LT", "TATA CONSULTANCY SERVICES LTD", "TATA"]
      .includes(query) ? [tcs] : [];
    const exact = query === "TCS" || query === "INE467B01029" ? [tcs] : [];
    return { candidates: candidate, exactIdentifierMatches: exact };
  }
  async linkPortfolioInstrument(_input: {
    userId: UserId; portfolioInstrumentId: string; catalogInstrumentId: CatalogInstrumentId;
    listingId: string; linkedAt: Date;
  }) { return true; }
}

class SingleResponseHttp implements HttpClient {
  constructor(private readonly response: HttpResponse) {}
  readonly requests: { url: string; authorization: string | null }[] = [];
  async get(url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse> {
    this.requests.push({ url, authorization: init?.headers?.authorization ?? null });
    return this.response;
  }
}

async function main() {
  const search = new SearchInstrumentCatalog(new SearchFixtureRepository(), new FixedClock(now));

  section("selection policy");
  const symbol = await search.execute({ query: "tcs" });
  check("a unique exact symbol can preselect", symbol.matchState, "EXACT");
  check("the canonical id, not a provider token, is selected", symbol.selected?.catalogInstrumentId, catalogId.value);
  const name = await search.execute({ query: "TATA CONSULTANCY SERV LT" });
  check("even an exact provider name requires confirmation", name.matchState, "CONFIRM");
  check("an exact provider name does not preselect", name.selected, null);
  const truncated = await search.execute({ query: "TATA CONSULTANCY SERVICES LTD" });
  check("the TCS long name is a review candidate", truncated.candidates.length, 1);
  check("the provider-truncated TCS candidate requires confirmation", truncated.matchState, "CONFIRM");
  const prefix = await search.execute({ query: "TATA" });
  check("prefix results require confirmation", prefix.matchState, "CONFIRM");
  const unknown = await search.execute({ query: "UNKNOWN SECURITY" });
  check("unknown search falls back to manual", unknown.matchState, "MANUAL");
  checkTrue("manual entry is always available", unknown.manualEntryAllowed);

  section("injected provider parsers");
  const upstoxHttp = new SingleResponseHttp({
    status: 200,
    headers: {},
    body: JSON.stringify([{
      exchange: "NSE", segment: "NSE_EQ", instrument_type: "EQ",
      isin: "INE467B01029", trading_symbol: "TCS", name: "TATA CONSULTANCY SERV LT",
      instrument_key: "NSE_EQ|INE467B01029", exchange_token: "11536",
    }]),
  });
  const upstox = await new UpstoxPublicInstrumentMaster(upstoxHttp, () => now, "fixture://upstox").fetch();
  checkTrue("the public master parses without live network", upstox.ok);
  if (upstox.ok) {
    check("verified ISIN is retained", upstox.snapshot.instruments[0].verifiedIsin, "INE467B01029");
    check("exchange token is only a provider mapping", upstox.snapshot.instruments[0].providerMappings[0].providerToken, "11536");
    check("fetch checksum is recorded", upstox.snapshot.checksum.length, 64);
  }

  const csv = [
    "instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange",
    "2953217,11536,TCS,TATA CONSULTANCY SERV LT,0,,0,0.05,1,EQ,NSE,NSE",
  ].join("\n");
  const zerodhaHttp = new SingleResponseHttp({ status: 200, headers: {}, body: csv });
  const zerodha = await new ZerodhaInstrumentCsvMapping(zerodhaHttp, () => now, {
    authorization: "token private:value", url: "fixture://zerodha",
  }).fetch();
  checkTrue("optional Zerodha CSV parses without live network", zerodha.ok);
  if (zerodha.ok) {
    check("Zerodha adds mappings, not identities", zerodha.snapshot.instruments.length, 0);
    check("Zerodha token remains a mapping", zerodha.snapshot.mappings[0].providerToken, "11536");
  }
  check("credentials are sent only in the request header", zerodhaHttp.requests[0].authorization, "token private:value");

  const amfiBody = [
    "Scheme Code;ISIN Growth;ISIN Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date",
    "Open Ended Schemes(Equity Scheme)",
    "120503;INF209K01VD8;INF209K01VE6;Test Flexi Cap Fund;Direct;Growth;84.5612;05-Sep-2026",
    "120504;;;Broken Fund;Direct;Growth;N.A.;05-Sep-2026",
  ].join("\n");
  const amfi = await new AmfiMutualFundMaster(
    new SingleResponseHttp({ status: 200, headers: {}, body: amfiBody }),
    () => now,
    "fixture://amfi",
  ).fetch();
  checkTrue("the current eight-column AMFI format parses", amfi.ok);
  if (amfi.ok) {
    check("AMFI NAV is not mistaken for the plan column", amfi.snapshot.instruments.length, 1);
    check("scheme code is the quote reference", amfi.snapshot.instruments[0].listing.symbol, "120503");
    check("plan and option remain part of the distinct scheme name", amfi.snapshot.instruments[0].name, "Test Flexi Cap Fund - Direct - Growth");
    check("AMFI identity retains a verified ISIN", amfi.snapshot.instruments[0].verifiedIsin, "INF209K01VE6");
  }

  const secBody = JSON.stringify({
    fields: ["cik", "name", "ticker", "exchange"],
    data: [[320193, "Apple Inc.", "AAPL", "Nasdaq"], [789019, "Microsoft Corp", "MSFT", "Nasdaq"]],
  });
  const sec = await new SecCompanyTickerMaster(
    new SingleResponseHttp({ status: 200, headers: {}, body: secBody }),
    () => now,
    "fixture://sec",
  ).fetch();
  checkTrue("the SEC listed-company fixture parses", sec.ok);
  if (sec.ok) {
    check("US listings retain USD currency", sec.snapshot.instruments[0].listing.currency, "USD");
    check("US exchange identity is normalized", sec.snapshot.instruments[0].listing.exchange, "NASDAQ");
    check("CIK is a provider mapping rather than a ticker replacement", sec.snapshot.instruments[0].providerMappings[0].providerInstrumentId, "0000320193");
    check("the user-facing quote symbol stays the SEC ticker", sec.snapshot.instruments[0].listing.symbol, "AAPL");
  }

  section("multi-provider due gating");
  const refreshRepository = new RefreshFixtureRepository();
  let publicFetches = 0;
  let supplementalFetches = 0;
  const snapshot = (source: string): CatalogSnapshot => ({
    source,
    fetchedAt: now,
    checksum: source.padEnd(64, "0").slice(0, 64),
    instruments: [],
    mappings: [],
  });
  const refresh = new RefreshInstrumentCatalog(
    refreshRepository,
    { source: "PUBLIC", fetch: async () => { publicFetches += 1; return { ok: true, snapshot: snapshot("PUBLIC") }; } },
    [{ source: "AMFI", fetch: async () => { supplementalFetches += 1; return { ok: true, snapshot: snapshot("AMFI") }; } }],
    new FixedClock(now),
  );
  const first = await refresh.execute();
  check("all due providers refresh independently", first.sources.length, 2);
  check("the combined result is refreshed", first.status, "REFRESHED");
  const second = await refresh.execute();
  check("a second refresh inside a day is current", second.status, "CURRENT");
  check("public provider was fetched once", publicFetches, 1);
  check("supplemental provider was fetched once", supplementalFetches, 1);

  await quoteKeyGate();

  done();
}

/* ═══ The priceability gate (C10, C6) ══════════════════════════════════ */

/**
 * A catalogue that only knows about quote keys.
 *
 * Everything else on the port is inherited from `CatalogQuoteKeyStubs` and then
 * overridden where this spec needs real behaviour — so the fixture is about the
 * gate and nothing else, and a reader can see the whole state machine in one
 * screen.
 */
class QuoteKeyFixture extends CatalogQuoteKeyStubs {
  readonly rows: (QuoteKeyCandidateListing & CatalogQuoteKeyState)[];

  constructor(rows: (QuoteKeyCandidateListing & CatalogQuoteKeyState)[]) {
    super();
    this.rows = rows;
  }

  private find(listingId: string) {
    return this.rows.find((row) => row.listingId === listingId);
  }

  override async listingsDueQuoteKeyCheck(limit: number, asAt: Date) {
    return this.rows
      .filter((row) => !row.quoteStale && isQuoteKeyRevalidationDue(row, { now: () => asAt, today: () => asAt.toISOString().slice(0, 10) }))
      .slice(0, limit);
  }

  override async recordQuoteKey(resolution: QuoteKeyResolution) {
    const row = this.find(resolution.listingId);
    if (!row) return;
    Object.assign(row, {
      quoteKey: resolution.quoteKey,
      quoteProvider: resolution.quoteProvider,
      quoteValidatedAt: resolution.validatedAt,
      quoteStale: false,
      firstTradeDate: row.firstTradeDate ?? resolution.firstTradeDate,
    });
    await super.recordQuoteKey(resolution);
  }

  override async markQuoteStale(listingId: string, at: Date, reason: string) {
    const row = this.find(listingId);
    if (row) Object.assign(row, { quoteStale: true, quoteValidatedAt: at });
    await super.markQuoteStale(listingId, at, reason);
  }

  override async touchQuoteKey(listingId: string, at?: Date) {
    const row = this.find(listingId);
    if (row && at) Object.assign(row, { quoteValidatedAt: at });
    await super.touchQuoteKey(listingId);
  }
}

/** A prober whose universe is a map. Nothing here touches a network. */
class FixtureProber implements QuoteKeyProbePort {
  readonly asked: string[] = [];

  constructor(private readonly universe: ReadonlyMap<string, QuoteKeyProbeResult>) {}

  async probe(quoteKey: string) {
    this.asked.push(quoteKey);
    return this.universe.get(quoteKey) ?? null;
  }
}

function resolves(
  quoteKey: string,
  overrides: Partial<QuoteKeyProbeResult> = {},
): [string, QuoteKeyProbeResult] {
  return [
    quoteKey,
    {
      quoteKey,
      bars: 7716,
      currency: "INR",
      instrumentType: "EQUITY",
      firstTradeDate: "1996-01-01",
      sourceId: "yahoo-chart",
      ...overrides,
    },
  ];
}

const listing = (
  overrides: Partial<QuoteKeyCandidateListing & CatalogQuoteKeyState>,
): QuoteKeyCandidateListing & CatalogQuoteKeyState => ({
  listingId: "listing-1",
  exchange: "NSE",
  symbol: "RELIANCE",
  currency: "INR",
  instrumentType: "EQUITY",
  quoteKey: null,
  quoteProvider: null,
  quoteValidatedAt: null,
  quoteStale: false,
  firstTradeDate: null,
  ...overrides,
});

async function quoteKeyGate(): Promise<void> {
  section("candidate quote keys encode C9");

  check(
    "an NSE equity tries .NS first, then .BO",
    candidateQuoteKeys(listing({})).join(","),
    "RELIANCE.NS,RELIANCE.BO",
  );
  check(
    "a BSE-only scrip tries .BO first — a full tier, not a degraded one",
    candidateQuoteKeys(listing({ exchange: "BSE", symbol: "TAPARIA" })).join(","),
    "TAPARIA.BO,TAPARIA.NS",
  );
  check(
    "a US class share replaces the dot with a hyphen",
    candidateQuoteKeys(listing({ exchange: "NASDAQ", symbol: "BRK.B", currency: "USD" })).join(","),
    "BRK-B",
  );
  check(
    "a mutual fund has no chart-endpoint key at all",
    candidateQuoteKeys(listing({ instrumentType: "MUTUAL_FUND", symbol: "120503" })).length,
    0,
  );
  check(
    "nor does a bond",
    candidateQuoteKeys(listing({ instrumentType: "BOND" })).length,
    0,
  );

  section("a probe is accepted only on all three conditions (C10)");

  const good = resolves("RELIANCE.NS")[1];
  checkTrue("a real equity in the right currency is accepted", acceptQuoteKeyProbe(good, { currency: "INR" }).accepted);

  const empty = acceptQuoteKeyProbe({ ...good, bars: 0 }, { currency: "INR" });
  check("a 200 with no bars is not a resolution", empty.accepted, false);
  if (!empty.accepted) checkTrue("and says so", empty.reason.includes("no bars"));

  const wrongCurrency = acceptQuoteKeyProbe({ ...good, currency: "GBP" }, { currency: "INR" });
  check("a London line is refused", wrongCurrency.accepted, false);
  if (!wrongCurrency.accepted) checkTrue("naming the currency", wrongCurrency.reason.includes("GBP"));

  const future = acceptQuoteKeyProbe({ ...good, instrumentType: "FUTURE" }, { currency: "INR" });
  check("a future is refused", future.accepted, false);

  checkTrue(
    "an ETF is accepted",
    acceptQuoteKeyProbe({ ...good, instrumentType: "ETF" }, { currency: "INR" }).accepted,
  );

  section("the reconciler indexes a row only when a key resolved");

  const at = new Date("2026-09-13T06:00:00Z");
  const catalog = new QuoteKeyFixture([
    listing({ listingId: "reliance", symbol: "RELIANCE" }),
    // Dual-listed: .NS truncates to 41 rows on the BSE suffix, so .BO has to be
    // reachable but must not win when .NS is healthy.
    listing({ listingId: "taparia", exchange: "BSE", symbol: "TAPARIA" }),
    listing({ listingId: "nifty-fund", instrumentType: "MUTUAL_FUND", symbol: "120503" }),
    listing({ listingId: "ghost", symbol: "GHOSTCO" }),
  ]);
  const prober = new FixtureProber(
    new Map([resolves("RELIANCE.NS"), resolves("TAPARIA.BO", { bars: 1200, firstTradeDate: "2003-04-01" })]),
  );
  const report = await new InstrumentQuoteKeyReconciler(catalog, prober, () => at).reconcile();

  check("two rows resolved", report.resolved, 2);
  check("none went stale — none had a key to lose", report.markedStale, 0);
  check("two rows remain unpriceable", report.stillUnresolved, 2);

  const reliance = catalog.rows.find((row) => row.listingId === "reliance")!;
  check("the stored key is the exact string that resolved", reliance.quoteKey, "RELIANCE.NS");
  check("with the adapter that accepted it, as the vendor pin", reliance.quoteProvider, "yahoo-chart");
  check("and the inception date recorded at that moment", reliance.firstTradeDate, "1996-01-01");
  checkTrue("so the row is priceable", isPriceable(reliance));

  const taparia = catalog.rows.find((row) => row.listingId === "taparia")!;
  check("a BSE-only scrip resolves on .BO", taparia.quoteKey, "TAPARIA.BO");

  const fund = catalog.rows.find((row) => row.listingId === "nifty-fund")!;
  check("a mutual fund is never probed on a chart endpoint", fund.quoteKey, null);
  checkTrue("and is therefore not addable through this gate", !isPriceable(fund));
  checkTrue("no fund key was ever requested", !prober.asked.some((key) => key.startsWith("120503")));

  const ghost = catalog.rows.find((row) => row.listingId === "ghost")!;
  check("a symbol nothing knows stays unresolved", ghost.quoteKey, null);
  check("but is not marked stale — it never worked", ghost.quoteStale, false);
  checkTrue("and the reason is reported", report.reasons.some((line) => line.includes("GHOSTCO")));

  section("a symbol that dies is marked stale and never deleted (C6, TATAMOTORS.NS)");

  const tataAt = new Date("2026-11-01T06:00:00Z");
  const tata = new QuoteKeyFixture([
    listing({
      listingId: "tatamotors",
      symbol: "TATAMOTORS",
      quoteKey: "TATAMOTORS.NS",
      quoteProvider: "yahoo-chart",
      quoteValidatedAt: new Date("2026-09-01T00:00:00Z"),
      firstTradeDate: "1998-01-01",
    }),
  ]);
  const dead = await new InstrumentQuoteKeyReconciler(
    tata,
    new FixtureProber(new Map()),
    () => tataAt,
  ).reconcile();

  check("one key went stale", dead.markedStale, 1);
  check("the row is still there", tata.rows.length, 1);
  check("its key is kept, so the badge can name it", tata.rows[0].quoteKey, "TATAMOTORS.NS");
  check("its inception date is kept too", tata.rows[0].firstTradeDate, "1998-01-01");
  checkTrue("but it is no longer priceable", !isPriceable(tata.rows[0]));
  checkTrue("and it is not offered again", (await tata.listingsDueQuoteKeyCheck(10, tataAt)).length === 0);

  section("a healthy key is re-confirmed, not re-derived");

  const healthyAt = new Date("2026-12-01T06:00:00Z");
  const healthy = new QuoteKeyFixture([
    listing({
      listingId: "infy",
      symbol: "INFY",
      quoteKey: "INFY.NS",
      quoteProvider: "yahoo-chart",
      quoteValidatedAt: new Date("2026-10-01T00:00:00Z"),
    }),
  ]);
  const healthyProber = new FixtureProber(new Map([resolves("INFY.NS")]));
  const again = await new InstrumentQuoteKeyReconciler(healthy, healthyProber, () => healthyAt).reconcile();

  check("it resolved again", again.resolved, 1);
  check("exactly one probe was spent", healthyProber.asked.length, 1);
  check("on the key it already had — the .BO alternative was never tried", healthyProber.asked[0], "INFY.NS");
  check("and the confirmation time moved", healthy.rows[0].quoteValidatedAt?.toISOString(), healthyAt.toISOString());

  section("re-validation is due on a schedule, and never for a row just checked");

  const justChecked = listing({ quoteValidatedAt: new Date("2026-12-01T00:00:00Z") });
  checkTrue(
    "a row confirmed yesterday is not due",
    !isQuoteKeyRevalidationDue(justChecked, {
      now: () => new Date("2026-12-02T00:00:00Z"),
      today: () => "2026-12-02",
    }),
  );
  checkTrue(
    "a row confirmed two months ago is",
    isQuoteKeyRevalidationDue(justChecked, {
      now: () => new Date("2027-02-02T00:00:00Z"),
      today: () => "2027-02-02",
    }),
  );
  checkTrue(
    "and one never confirmed always is",
    isQuoteKeyRevalidationDue(listing({}), {
      now: () => new Date("2026-12-02T00:00:00Z"),
      today: () => "2026-12-02",
    }),
  );

  section("the BSE master filters on a group code, never on EQ (C9, D-6)");

  checkTrue("A is an equity group", BSE_EQUITY_GROUPS.has("A"));
  checkTrue("and B", BSE_EQUITY_GROUPS.has("B"));
  checkTrue("F is debt and is not", !BSE_EQUITY_GROUPS.has("F"));
  checkTrue("nor is G", !BSE_EQUITY_GROUPS.has("G"));
  checkTrue(
    "and EQ is not a BSE group at all — filtering on it is what yielded zero rows",
    !BSE_EQUITY_GROUPS.has("EQ"),
  );

  const bse = new UpstoxBsePublicInstrumentMaster(
    new (class {
      async get() {
        return {
          status: 200,
          headers: {},
          body: JSON.stringify([
            { exchange: "BSE", segment: "BSE_EQ", instrument_type: "A", isin: "INE002A01018", trading_symbol: "RELIANCE", name: "Reliance Industries", instrument_key: "BSE_EQ|INE002A01018", exchange_token: "500325" },
            { exchange: "BSE", segment: "BSE_EQ", instrument_type: "F", isin: "INE002A07AB1", trading_symbol: "RELNCD", name: "Reliance NCD", instrument_key: "BSE_EQ|INE002A07AB1" },
            { exchange: "NSE", segment: "NSE_EQ", instrument_type: "EQ", isin: "INE009A01021", trading_symbol: "INFY", name: "Infosys", instrument_key: "NSE_EQ|INE009A01021" },
          ]),
        };
      }
    })(),
    () => at,
  );
  const bseResult = await bse.fetch();
  check("the BSE master parses", bseResult.ok, true);
  if (bseResult.ok) {
    check("one equity row, not the debenture and not the NSE line", bseResult.snapshot.instruments.length, 1);
    check("and it is the BSE listing", bseResult.snapshot.instruments[0].listing.exchange, "BSE");
  }

  section("the Moneycontrol sc_id is harvested, never derived");

  const suggestion = JSON.stringify([
    {
      stock_name: "Reliance Industries",
      sc_id: "RELIANCE",
      link_src: "https://www.moneycontrol.com/india/stockpricequote/refineries/relianceindustries/RI",
    },
    {
      stock_name: "Reliance Power",
      sc_id: "RPOWER",
      link_src: "https://www.moneycontrol.com/india/stockpricequote/power/reliancepower/RP11",
    },
  ]);
  check(
    "RELIANCE maps to RI, which no rule could have produced from the symbol",
    MoneycontrolScIdHarvester.parse(suggestion, "RELIANCE"),
    "RI",
  );
  check("and RPOWER to its own id", MoneycontrolScIdHarvester.parse(suggestion, "RPOWER"), "RP11");
  check(
    "a symbol the suggestions do not actually carry gets nothing, not the first row",
    MoneycontrolScIdHarvester.parse(suggestion, "RELIANCEINFRA"),
    null,
  );
  check("a non-JSON body is null, not a throw", MoneycontrolScIdHarvester.parse("<html>", "RELIANCE"), null);
}

class RefreshFixtureRepository extends CatalogQuoteKeyStubs implements InstrumentCatalogRepository {
  private readonly receipts = new Map<string, { source: string; fetchedAt: Date; checksum: string; rowCount: number }>();

  async latestSuccessfulFetch(source?: string) {
    if (source) return this.receipts.get(source) ?? null;
    return [...this.receipts.values()][0] ?? null;
  }
  async latestFetchAttempt(source: string) {
    const receipt = this.receipts.get(source);
    return receipt ? { source, attemptedAt: receipt.fetchedAt, outcome: "SUCCESS" as const } : null;
  }
  async recordFetchFailure() {}
  async count() { return this.receipts.size; }
  async ingest(snapshot: CatalogSnapshot) {
    this.receipts.set(snapshot.source, {
      source: snapshot.source,
      fetchedAt: snapshot.fetchedAt,
      checksum: snapshot.checksum,
      rowCount: snapshot.instruments.length,
    });
    return { instruments: snapshot.instruments.length, listings: snapshot.instruments.length, mappings: 0, unmatchedMappings: 0 };
  }
  async search() { return { candidates: [], exactIdentifierMatches: [] }; }
  async linkPortfolioInstrument() { return true; }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
