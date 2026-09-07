import { FixedClock, UserId } from "@/core/kernel";
import {
  CatalogCandidate,
  CatalogInstrumentId,
  CatalogSnapshot,
  InstrumentCatalogRepository,
} from "@/domain/instrument-catalog";
import { SearchInstrumentCatalog } from "@/app/instrument-catalog.usecases";
import { UpstoxPublicInstrumentMaster, ZerodhaInstrumentCsvMapping } from "@/infra/instrument-catalog";
import type { HttpClient, HttpResponse } from "@/infra/providers";
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

class SearchFixtureRepository implements InstrumentCatalogRepository {
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

  done();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
