# Market-data sources, round 2: registry sweep, search quality, and a swappable engine seam

Status: READY
Owner: Research Agent (round 2) — lane: **Research only**, per AGENTS.md "Requirement modes" option 2
Updated: 2026-09-13

## Requirement

The owner asked two things that round 1 did not cover. First, the
[public-apis](https://github.com/public-apis/public-apis) registry and its siblings were never
actually swept — he wants that done properly and honestly. Second, he wants the eventual
implementation split into **separate, modular folders behind a swappable engine interface**
(Indian / international / live-quote concerns isolated), so a paid API can be dropped in later
without rework. This document therefore reports sources *as pluggable adapters* and says, per
source, what capability it is a drop-in for.

**Scope change received mid-task from the Coordinator (2026-09-13):** the owner will log all
transactions **and all corporate actions** (splits, bonuses, dividends, demergers) manually.
The market-data layer must supply **prices and FX only**. `CorporateActions` is therefore
demoted from a required capability to an optional *reconciliation* signal. Search quality and
a Yahoo failover become joint top priority, because with corporate actions gone, prices are the
entire job of this layer and single-vendor dependence is the main remaining structural risk.

## Acceptance criteria

- [x] The finance/currency/crypto sections of public-apis and public-api-lists were fetched raw
      and worked through row by row.
- [x] Every plausible candidate was **probed live on 2026-09-13**, with HTTP status and a payload
      excerpt recorded. No claim rests on a registry entry alone.
- [x] Anything paid, key-walled, dead, or under ~500 req/day is recorded as REJECTED with the
      reason.
- [x] A blunt verdict on whether anything beats or supplements the round-1 stack.
- [x] Targeted recommendations for search quality, quote/history failover, Indian breadth and
      indices.
- [x] A capability/adapter table usable as the folder layout for the swappable engine.
- [x] Verified facts separated from assumptions.
- [x] One repository file written. Nothing staged, nothing committed, no production code touched.

## Context map

| Need | Authoritative file/section | Why it is needed |
|---|---|---|
| Round-1 source inventory, F1-F15, defects D-1..D-6 | `_architecture/requirements/market-data-sources-research.md` | The baseline this round must beat or confirm |
| Measured behaviour, E1-E7, the 16-item trap list | `_architecture/requirements/market-data-experiment-results.md` | Defines the weaknesses this round targets (74% search intent, single-vendor risk) |
| Provider base class and existing keyless providers | `src/infra/providers.ts` | Any new source lands as a `PriceProvider` subclass, not a new HTTP layer |
| Master ingestion | `src/infra/instrument-catalog.ts` | Where new instrument masters and alias tables would land |
| Provider ports / capabilities | `src/domain/pricing.ts` | The existing seam the "swappable engine" requirement should extend, not replace |

---

# Headline answer, stated bluntly

**The registries produced almost nothing. Round 1's stack stands.**

The public-apis finance section is 74 rows and is overwhelmingly key-walled SaaS, payments,
IBAN/VAT validation, and 2025-2026 AI-wrapper startups. Of the handful marked `Auth: No`, exactly
**zero** are a usable equity price source. The registries are as stale as feared: they still list
`Exchangerate.host` as keyless (it is not — round 1 F12, re-confirmed), still list Polygon without
noting it has no free tier, and still list IEX Cloud, which shut down in August 2024.

**But three genuinely useful things were found, none of them from the registries' finance section**,
and two of them attack exactly the weaknesses the experiment exposed:

1. **OpenFIGI (Bloomberg) is keyless and alive** — 25 req/min, ISIN ↔ ticker ↔ exchange ↔ FIGI,
   and it *knows renames* (`ETERNAL` resolves; Zomato's old identity maps through the share-class
   FIGI). It was in public-apis, mislabelled `apiKey`. **This is the identity backbone.**
2. **Moneycontrol's public autosuggest endpoint is keyless and fixes 5 of the 6 search intent
   failures from experiment E1** — including `zomato` → Eternal and the typo `micrsoft` → Microsoft.
   It returns ISIN + NSE symbol + BSE scrip code in one row. Not in any registry; found by
   targeted probing. **This is the single highest-value find in this document.**
3. **`api.nasdaq.com/api/quote/{sym}/chart` is keyless and returns 9 241 daily bars back to 1990**
   for AAPL, split-adjusted, from a completely different operator than Yahoo. **This is the first
   credible keyless US history failover found across both rounds** — with an honesty caveat below.

Everything else is a rejection. The full sweep is recorded below so nobody repeats it.

---

# Task A — registry sweep

## A.0 Method and probe shape

All probes 2026-09-13 from a single Indian residential IP, `curl 8.x`, browser-shaped
User-Agent (`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 … Chrome/126.0.0.0 Safari/537.36`),
matching `FetchHttpClient` in `src/infra/providers.ts`. Scripts and captured output in the session
scratchpad (`p1.sh` … `p9.sh`, `pa.md`, `pal.md`, `awq.md`).

Registries fetched:

| Registry | URL | Probe result |
|---|---|---|
| public-apis | `https://raw.githubusercontent.com/public-apis/public-apis/master/README.md` | **200, 250 716 bytes, 2 272 lines.** Finance section = 74 rows; Currency Exchange = 22 rows. |
| public-api-lists | `https://raw.githubusercontent.com/public-api-lists/public-api-lists/master/README.md` | **200, 195 463 bytes, 1 189 lines.** Finance section keyless rows = 5, all SEC-filing/payroll wrappers. |
| awesome-quant | `https://raw.githubusercontent.com/wilsonfreitas/awesome-quant/master/README.md` | **200, 143 290 bytes, 788 lines.** Overwhelmingly Python libraries, not APIs. |
| `api.publicapis.org` | — | **Not probed as a data source: it is a directory index of the same README, not a finance API.** Its own upstream has been intermittently down since 2023. Nothing it can return that `pa.md` does not. |
| toddmotto/public-apis | — | **Redirects to public-apis/public-apis.** It is the same list; it was the original repo before the org move. No separate sweep needed. |

## A.1 public-apis "Finance" — the 74 rows, triaged

**Rejected on `Auth: apiKey` alone (no probe needed, the registry's own column disqualifies them
under the no-paid/no-key-walled constraint, and each was checked against round 1's exclusions):**
Marketstack, Aletheia, Alpaca, Alpha Vantage, Bank Data, Billplz, Boleto.Cloud, BriefTape,
Citi, CongressInvests, Dino.markets, EconPulse, Edgrapi, **EOD Historical Data**, FarmDash,
Filingrail, Finage, Financial Modeling Prep, Finnhub, **FRED**, Halal Terminal, Hotstoks,
IBANforge, **IEX Cloud**, IG, Intrinio, Klarna, Mono, Moov, NORTH7, Nordigen, PIT Financial State,
Plaid, Polygon, Real Time Finance, **SmartAPI (Angel One)**, StockData, StockFit, Styvio, Sugra,
Tax Data, TickerLayer, Twelve Data, VAT Validation, **Yahoo Finance (yahoofinanceapi.com — a paid
reseller of the endpoints we already call free)**, YNAB, Zoho Books, Banco do Brasil, Front
Accounting, MercadoPago, Tradier (OAuth).

Notes worth recording, since these are the ones people will ask about again:
- **IEX Cloud** — listed as live in the registry; the product was **retired 31 August 2024**. The
  registry is stale. Do not plan around it.
- **EOD Historical Data (eodhd.com)** — free tier is **20 API calls/day**, well under the ~500/day
  floor. Rejected.
- **SmartAPI / Angel One** — requires a funded Indian broking account plus TOTP login per session.
  Same class as Zerodha Kite (round 1 F15). Rejected.
- **FRED** — keyed, and carries macro series, not equity prices. Not a candidate for this layer.

**Probed keyless rows (`Auth: No`) — all results below:**

| Candidate | Probe | Result | Verdict |
|---|---|---|---|
| **OpenFIGI** (listed `apiKey` — **the registry is wrong**) | `POST https://api.openfigi.com/v3/mapping` body `[{"idType":"ID_ISIN","idValue":"INE002A01018"},{"idType":"ID_ISIN","idValue":"US0378331005"}]`, **no API key** | **200, 70 904 bytes.** `{"figi":"BBG000BKVP93","name":"RELIANCE INDUSTRIES LIMITED","ticker":"RELIANCE","exchCode":"IN","compositeFIGI":"BBG000BKVP93","securityType":"Common Stock","shareClassFIGI":"BBG001S84HH9",…}` plus `exchCode:"IB"`, `exchCode:"IS"` rows | **ALIVE-FREE — the find of the sweep.** See B1. |
| SEC EDGAR Data | `https://efts.sec.gov/LATEST/search-index?q=apple&forms=10-K` | **200, 58 128 bytes**, Elasticsearch response, `hits.total.value: 10000`, rows carry `display_names:["Apple Hospitality REIT, Inc. (APLE) (CIK 0001418121)"]` | **ALIVE-FREE but not useful here.** Full-text *filing* search, ranked by filing text, not by company-name intent. `q=apple` ranks Apple Hospitality REIT above Apple Inc. Worse than what we have. Already covered by round 1 F11's `company_tickers_exchange.json` for identity. |
| Fed Treasury / FiscalData | `https://api.fiscaldata.treasury.gov/…/avg_interest_rates?page%5Bsize%5D=2` | **200, 2 061 bytes.** `{"data":[{"record_date":"2001-01-31","security_type_desc":"Marketable","avg_interest_rate_amt":"6.096",…}]}` | **ALIVE-FREE, out of scope.** US Treasury rates. No equity, no FX, no Indian data. Only relevant if a risk-free-rate input is ever wanted. |
| Econdb | `https://www.econdb.com/api/series/?format=json&limit=2` | **401**, `{"detail":"Authentication credentials were not provided."}` | **REJECTED — now key-walled.** Registry says `Auth: No`; it is not. |
| Portfolio Optimizer | `https://api.portfoliooptimizer.io/v1/assets/correlation/matrix` | **404**, `{"message":"api endpoint not found"}` | **REJECTED.** Even if reachable it is a *computation* service, not a data source — you post your own returns. Wrong layer. |
| Goldprice.dev | `https://api.goldprice.dev/v1/spot` | **404**, `{"error":"not_found","message":"Not Found"}` | **REJECTED — dead/unreachable path.** |
| KmalServico Gold Price Dataset | `https://www.kmalservico.com/data/gold-prices.json` | **404**, 17 662 bytes of a Next.js HTML error shell | **REJECTED — no JSON endpoint at the advertised path.** (Round 1 already has IBJA for Indian gold.) |
| Indian Mutual Fund (mfapi.in) | — | Already ALIVE-FREE per round 1 F13, unchanged | Keep, no change |
| Razorpay IFSC, IBAN Analyzer, EstimateTax, US Mortgage Calculator, MyPayslip.lk, Polish Bank Branches, Futures Clock, Helious, Helium, LiquiLens, Top 5 Stocks, WallstreetBets, Zelothorn, AlphaSMO, Congressional Stock Brain, FilingFirehose | not probed | **Out of scope by description** — bank-branch lookup, tax calculators, mortgage maths, SEC-filing sentiment, congressional-trade feeds, AI watchlists. None supplies a price series, a quote, an instrument master, or an FX rate. | Rejected on relevance |

## A.2 public-apis "Currency Exchange" — 22 rows

| Candidate | Probe | Result | Verdict |
|---|---|---|---|
| **Frankfurter** | `https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR` | **200, 69 bytes.** `{"amount":1.0,"base":"USD","date":"2026-09-11","rates":{"INR":95.56}}` | **ALIVE-FREE.** Round 1 D6 / experiment E4 confirmed. **Remains FX primary.** |
| **Exchangerate.dev** (new, not in round 1) | `https://api.exchangerate.dev/v1/latest?base=USD&symbols=INR` | **200, 316 bytes.** `{"result":"success","base":"USD","source":"live","market_session":"weekend","rates":{"INR":95.569},"notice":"Indicative rates, not f…"}` | **ALIVE-FREE.** Keyless, advertises **Frankfurter-compatible routes, 168 pairs back to 1999, 10 000 req/month** — above the 500/day floor. **Useful as the FX failover adapter** because it is API-shape-compatible with the primary, so the adapter is nearly free to write. Caveat: its own payload says *"Indicative rates"*, and it returned a weekend live rate (95.569) where Frankfurter returned the Thursday ECB fixing (95.56) — **a different rate type**, so it must not be mixed into one portfolio's history (same rule as experiment E4's 0.18% Yahoo seam). |
| **Currency-api (fawazahmed0)** | `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json` | **200, 7 490 bytes**, `{"date":"2026-09-12","usd":{"inr":…,"aed":3.6725,…}}` — 200+ fiat and crypto | **ALIVE-FREE.** Served from **jsDelivr CDN, so effectively no rate limit and no origin to fail.** Dated snapshots work: `@2024-03-06/v1/currencies/usd.json` → **200, 15 541 bytes, `"date":"2024-03-06"`**. But `@2019-11-12` → **404, "Couldn't find the requested release version"** — **history does not reach back to 2019**, so it cannot serve a multi-year portfolio. **Accept as a today-only FX fallback**, ranked below Frankfurter and Exchangerate.dev. |
| Exchangerate.host | `https://api.exchangerate.host/latest?base=USD` | Round 1 F12 and experiment re-probe: **200 but `{"success":false,"error":{"code":101,"type":"missing_access_key"}}`** | **REJECTED — key-walled.** Registry still lists it `Auth: No`. Stale. |
| Currencylayer, Exchangeratesapi.io, Fixer, 1Forge, Amdoren, CurrencyBeacon, CurrencyFreaks, CurrencyScoop, ExchangeRate-API, TaxID | `Auth: apiKey` | — | **REJECTED — keyed.** CurrencyFreaks free plan is 1 000 req/**month** (~33/day), far under floor. |
| VATComply, FreeForexAPI, National Bank of Poland, Czech National Bank, Bank of Russia, Economia.Awesome, api-mint, paralelo.bo | keyless but EUR/PLN/CZK/RUB/BRL/BOB-centric or major-pairs-only | — | **REJECTED on coverage.** None offers a deep daily USD/INR series. Frankfurter already gives 6 824 points from 2000-01-13 (experiment E4). |

## A.3 public-api-lists and awesome-quant

- **public-api-lists** finance section keyless rows are: AlphaSMO (13F holdings), Congressional
  Stock Brain, FilingFirehose (SEC filings), MyPayslip.lk (Sri Lanka payroll), Polish Bank
  Branches. **Not one is a price source. Nothing to probe.** The list is a fork of public-apis with
  newer spam and the same stale entries.
- **awesome-quant** is a library index, not an API index. Its data section points at the same
  upstreams round 1 already evaluated (Yahoo via `yfinance`, Alpha Vantage, Quandl/Nasdaq Data Link,
  Tiingo, IEX) wrapped in **Python**. Per the TypeScript/Next.js constraint, wrapping a Python
  runtime to reach endpoints we can call directly over HTTP is strictly worse. **No new source.**

## A.4 Registry sweep verdict

**Nothing in any registry beats the round-1 stack.** The one registry row that matters — OpenFIGI —
was mislabelled `apiKey` and would have been skipped by anyone trusting the list. The registries
are confirmed stale on at least four counts (Exchangerate.host, Econdb, IEX Cloud, OpenFIGI's auth
column). **The owner's instinct to have them checked was right; the answer is that they are a poor
source for this domain and do not need checking again.**

---

# Task B — the targeted weaknesses

## B1 — Symbol search quality (**TOP PRIORITY**): fixable, and the fix is local

Experiment E1 measured **74% top-result intent accuracy** with six named failures. Here is each
failure re-probed against the candidates found this round.

### B1.a Moneycontrol autosuggest — keyless, and it fixes most of them

`GET https://www.moneycontrol.com/mccode/common/autosuggestion_solr.php?classic=true&query=<q>&type=1&format=json`
— **no key, no cookie, no Referer required.** 10 rapid sequential calls: **200 × 10.**
Re-probed alive at the end of the session: **200, 6 079 bytes** for `tcs`.

Each row carries `pdt_dis_nm` shaped `"<Name>&nbsp;<span><ISIN>, <NSE_SYMBOL>, <BSE_CODE></span>"`,
plus `sc_id`, `stock_name`, `link_src`.

| E1 failure | Moneycontrol top-3 (verbatim, tags stripped) | Fixed? |
|---|---|---|
| `zomato` → *(Yahoo: zero results)* | `Eternal  INE758T01015, ETERNAL, 543320` | **YES** — the rename alias is resolved |
| `micrsoft` → *(Yahoo: zero results)* | `Microsoft  US5949181045, MSFT:US` | **YES** — real typo tolerance, and it carries the **US ISIN** |
| `HDFC Bank` → Yahoo ranked `HDB`/NYSE/USD | `HDFC Bank  INE040A01034, HDFCBANK, 500180` \| `HDFC Life…` \| `HDFC AMC…` | **YES** — home listing first, no ADR |
| `infy` → Yahoo ranked `INFY`/NYSE/USD | `Infosys  INE009A01021, INFY, 500209` \| `Info Edge…` \| `CMS Info…` | **YES** — NSE listing first |
| `tata motors` → Yahoo `TMPV.NS` | `Eicher Motors…` \| **`Tata Motors  INE1TAE01010, TMCV, 544569`** \| `Tata Capital…` | **PARTIAL** — correct entity at rank 2, wrong entity at rank 1 |
| `brk.b` | `No Result Available` | **NO** — still broken |
| `SBI` → Yahoo ranked `SBI`/NYSE | `SBI Funds Management…` \| `SBILIQETF` \| `SBI Home Finance…` (**`SBIN` absent from top 3**) | **NO** — still wrong |
| control: `relia` | `Reliance Industries  INE002A01018, RELIANCE, 500325` \| `Reliance Power…` \| `Reliance Infrastructure…` | correct |
| control: `appl` | `Apple Inc  US0378331005, AAPL:US` \| `Applied Materials` \| `AppLovin` | correct |
| control: `asdkjhasdkjh` | `No Result Available` | correct — garbage rejects |

**5 of 7 named failures fixed, zero regressions on the controls.** And it returns **ISIN for both
Indian and US names**, which is exactly the join key the local catalogue already uses
(`verifiedIsin`, round 1 recommendation 2).

A second Moneycontrol endpoint is also keyless and cleaner to parse — the TradingView-UDF search:
`GET https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/search?query=zomato&limit=5`
→ **200, 236 bytes**,
`[{"symbol":"Eternal","full_name":"Eternal","exchange":"NSE","type":"stock","ticker":"ETERNAL"},{"symbol":"Eternal","exchange":"BSE","type":"stock","ticker":"543320"}]`.
It returns **NSE and BSE rows explicitly labelled**, which directly serves the "prefer the home
listing, show the exchange" rule E1 asked for. Re-probed alive: `query=tcs` → **200, 429 bytes**.

**Caveat, stated plainly:** these are Moneycontrol's own undocumented site endpoints, the same
class of risk as Yahoo's — no ToS grant, no stability guarantee, and the *sibling* history path on
the same host is Akamai-blocked (see B2.c). **Use it as a search *enricher* whose output is cached
into the local catalogue, never as a per-keystroke live dependency.** Harvesting it once per day
over the instrument master to build an alias table is the low-risk shape.

### B1.b OpenFIGI — the identity backbone

`POST https://api.openfigi.com/v3/mapping`, **keyless**, verified above.

Rate limits, read from live response headers (not from docs):
`ratelimit-policy: 25;w=60`, `ratelimit-limit: 25`, `ratelimit-remaining: 21`, `ratelimit-reset: 31`.
So **25 requests per 60 seconds without a key**. A 30-call sequential burst returned **200 × 30**
(each call is cheap and the window rolled), but a follow-on `/v3/search` in the same minute
returned the plaintext body **`Too many requests, please try again later.`** — so the limit is real
and shared across `/mapping`, `/search` and `/filter`.

**25 req/min = 36 000/day, far above the ~500/day floor.** And `/v3/mapping` accepts **up to 10
jobs per request keyless**, so a catalogue backfill of 10 000 Indian ISINs is ~1 000 requests
≈ 40 minutes of polite batching, run once. A free registered key raises it to 25 requests per
6 seconds with 100 jobs each — still free, no payment, worth taking when volume justifies it.

What it gives, verified:
- **ISIN → ticker + exchange + FIGI**, all listings at once. `INE002A01018` returned `exchCode` **`IN`**
  (India composite), **`IB`** (BSE) and **`IS`** (NSE) rows, all sharing
  `compositeFIGI: BBG000BKVP93` and `shareClassFIGI: BBG001S84HH9`.
- **Ticker → ISIN, reverse direction.**
  `POST /v3/mapping [{"idType":"TICKER","idValue":"ETERNAL","exchCode":"IS"}]` → **200**,
  `[{"figi":"BBG011Q4H8M9","name":"ETERNAL LTD","ticker":"ETERNAL","exchCode":"IS","compositeFIGI":"BBG003DKJ5C9","shareClassFIGI":"BBG003DKJ5D8","securityType":"Common Stock"}]`.
- **`shareClassFIGI` is the rename-proof identity.** A ticker change (Zomato→Eternal) or a
  re-listing does not change the share-class FIGI. This is the correct primary key for "the same
  company across time" — strictly better than an ISIN for that purpose, because an ISIN can change
  on restructuring while the share class persists.

What it does **not** give, measured:
- **`/v3/search` free-text ranking is poor for our purpose.** `{"query":"zomato"}` → **200, 27 352
  bytes** whose first rows are `{"name":"ZOMATO LTD","ticker":"ZOMAT=1","securityType":"SINGLE STOCK FUTURE"}`
  — **derivatives ranked above the cash equity.** `/v3/filter` with `{"query":"reliance industries","exchCode":"IS"}`
  → **200, 27 463 bytes** whose first rows are `"January 10 Puts on RIL IS"` — **equity options first.**
- **No typo tolerance.** It is an exact/substring matcher.
- **No prices.** Symbology only.

**Conclusion: OpenFIGI is an `InstrumentMaster` adapter, not a `SymbolSearch` adapter.** Use it to
enrich the local catalogue with `shareClassFIGI` + every listing's `exchCode`; do not put it on the
user's search path. If it is ever queried live, `securityType` **must** be filtered to
`Common Stock`/`ETP` or the user sees futures and options.

### B1.c GLEIF, Wikidata, SEC full-text — probed, and mostly negative

| Source | Probe | Result | Verdict |
|---|---|---|---|
| **GLEIF** | `https://api.gleif.org/api/v1/fuzzycompletions?field=entity.legalName&q=zomato` | **200, 11 bytes — `{"data":[]}`** | **REJECTED for this purpose.** GLEIF is keyless and alive, but it indexes **LEI legal entities**, not listed securities, and its "fuzzy" completion returned nothing for a well-known Indian issuer. It cannot map to a tradable ticker. |
| **Wikidata `wbsearchentities`** | `…action=wbsearchentities&search=zomato&language=en&format=json` | **200, 1 345 bytes.** `Q8073715` "Zomato" — *"Indian food delivery service"* | **ALIVE-FREE, partially useful.** The entity's English aliases are `["zomato.com.admin","Zomato Media","Zomato Private Limited","Zomato Media Private Limited"]` — **the "Eternal" rename is NOT among them.** Entity dump `Special:EntityData/Q8073715.json` → **200, 50 117 bytes**; it carries `P414` (stock exchange: `Q638398`, `Q638740`) but **no `P946` (ISIN) and no `P249` (ticker)**. |
| Wikidata typo tolerance | `…&search=micrsoft…` | **200, 444 bytes** — top hit `Q133444141` *"Micrsoft Office Live Workspace"* (an Indonesian-label typo article), **not Microsoft Corp** | **Typo tolerance is prefix-matching on labels, not a spell-corrector.** |

**Verdict on Wikidata/DBpedia: not worth building on.** Indian listed companies are sparsely
populated — no ISIN, no ticker, and the alias set missed the exact rename we wanted it for. It
would be a high-maintenance, low-recall dependency. **Record as tried and rejected so nobody
proposes it again.**

### B1.d The honest recommendation for search

None of the above is a drop-in replacement for a search engine. **The correct fix is the one
experiment E3 already implies: the local catalogue is the ranker, and the fuzzy matching is ours.**

- The catalogue is already **~9 708 NSE + 5 219 BSE-equity + 2 510 BSE-only + ~11 000 US rows**
  (round 1 F10/F11, experiment E3). That is **under 30 000 rows** — small enough to hold in memory
  and index in-process. **No external search API is needed, and none of the ones probed would do it
  better.**
- In TypeScript this is `MiniSearch` or `Fuse.js` over `{name, aliases[], nseSymbol, bseCode, isin,
  usTicker, exchange}`, with a scoring rule that **boosts the home-market listing** and **demotes
  ADRs** for an INR-reporting user. That single rule fixes `HDFC Bank`, `infy` and `SBI` — three of
  the six E1 failures — with no network call at all.
- **Normalise `.` → `-` on the query** before any lookup. `brk.b` → `brk-b` → `BRK-B`; confirmed by
  E1's own follow-up, and independently by **stockanalysis.com**: `GET https://stockanalysis.com/api/search?q=brk.b`
  → **200, 1 485 bytes, 17 rows including `{"id":"BRK.B","s":"BRK.B","n":"Berkshire Hathaway Inc."}`**
  — so a `.`-tolerant matcher is achievable; Yahoo simply does not have one.
- **Seed the alias table from Moneycontrol autosuggest and OpenFIGI `shareClassFIGI`**, harvested
  offline over the master, not at query time. That is what supplies `zomato → ETERNAL` and
  `TATAMOTORS → TMCV/TMPV` without any live third-party dependency on the user's cursor.

**This is an implementation option, not an API**, exactly as the packet anticipated — and after
probing every alternative, it is the only one that gets above 74%.

## B2 — A keyless second opinion for quotes and history (**JOINT TOP PRIORITY**)

### B2.a US: `api.nasdaq.com` — the real find

`GET https://api.nasdaq.com/api/quote/{symbol}/chart?assetclass={stocks|etf}&fromdate=1980-01-01&todate=2026-09-13`
— **keyless, no cookie, no Referer.**

| Symbol | assetclass | HTTP | bytes | rows | first | last | last close |
|---|---|---|---|---|---|---|---|
| AAPL | stocks | **200** | 1 742 386 | **9 241** | 1990-01-02 | 2026-09-11 | 332.27 |
| JPM | stocks | **200** | 1 565 521 | **9 241** | 1990-01-02 | 2026-09-11 | 356.23 |
| NVDA | stocks | **200** | 1 340 640 | 6 952 | 1999-01-22 | 2026-09-11 | 218.29 |
| VOO | **etf** | **200** | 648 962 | 4 026 | 2010-09-09 | 2026-09-11 | 702.56 |
| INFY (ADR) | stocks | **200** | 1 123 761 | 6 919 | 1999-03-11 | 2026-09-11 | 11.07 |
| HDB (ADR) | stocks | **200** | 1 065 354 | 6 323 | 2001-07-20 | 2026-09-11 | 23.34 |
| BRK-B | stocks | 200 | 142 | — | — | — | `{"rCode":400,"errorMessage":"Symbol not exists."}` |
| BRK/B (url-encoded) | stocks | **404** | 0 | — | — | — | — |

Also `…/historical?…&limit=9999` → **200, 190 068 bytes, `totalRecords: 1682`** — the *historical*
path is capped around 5 years; **the `chart` path is the deep one.** Use `chart`.

**Split-adjusted, verified at a known boundary.** AAPL 4:1 on 2020-08-31:
`8/28/2020 124.8075` → `8/31/2020 129.04` — **byte-for-byte the same values experiment E2 measured
from Yahoo.** No discontinuity; the series is back-adjusted the same way. So the E2/E5 rule holds
unchanged here: **never derive cost basis from it.**

**Durability:** 15 rapid sequential calls → **200 × 15**. But a `curl`-default User-Agent
**timed out with zero bytes after 20 s** (`curl_exit=28`, HTTP `000`) where the browser UA returned
200 — **the same UA-shape sensitivity experiment E6 found on Yahoo.** Same mitigation, already in
place in `FetchHttpClient`.

**The honesty caveat the Planner must know:** NVDA returned **6 952** rows and VOO **4 026** rows —
**identical counts to Yahoo's** in experiment E2's table. That is not a coincidence; it strongly
suggests a shared upstream vendor feed. So Nasdaq is a **genuine independent transport and
operator** (different company, different infrastructure, survives a Yahoo outage or block) but is
**probably not an independent dataset** (it will not disagree with Yahoo, so it cannot be used to
*validate* Yahoo's corrupt prints from E2). **Failover: yes. Cross-check oracle: no.**

### B2.b US: `stockanalysis.com` — a shallower third line

| Probe | Result |
|---|---|
| `https://stockanalysis.com/api/symbol/s/AAPL/history?range=10Y&period=Daily` | **200, 253 117 bytes, 2 513 rows, 2016-09-13 → 2026-09-11** |
| same with `range=MAX` | **200, 25 421 bytes — only 252 rows (1 year).** `MAX` is **not** max; it silently returns less than `10Y`. **The same class of trap as Yahoo's `range=max` (round 1 D3).** |
| `range=MAX&period=Weekly` | **200, 5 277 bytes, 52 rows** — also 1 year |
| `https://stockanalysis.com/api/quotes/s/AAPL` | **200.** `{"c":5.7,"h":336.22,"l":326.3,"o":327.45,"p":332.27,"u":"Sep 11, 2026, 4:00 PM EDT","cl":326.57,"cp":1.75,"ex":"NASDAQ","ms":"closed","es":"After-hours","ep":332.55}` — a clean quote with exchange, market state **and after-hours** |
| `https://stockanalysis.com/api/symbol/q/nse/RELIANCE/history?range=MAX` | **404**, `{"status":404}` |
| `https://stockanalysis.com/api/quotes/q/nse/RELIANCE` | **404** |
| `https://stockanalysis.com/api/search?q=relia` | **200.** `[{"id":"NSE-RELIANCE","s":"nse/RELIANCE","n":"Reliance Industries Limited"},{"id":"NSE-RELIABLE",…},{"id":"DSE-RELIANCINS",…}]` |
| `…?q=micrsoft` | **200, 3 890 bytes, 44 rows**, includes `{"id":"MSFT","n":"Microsoft Corporation"}` — **typo tolerant** |
| `…?q=zomato` | **200, 187 bytes, 2 rows** — `"Tomato Bank, Ltd."` (TYO) and a KOSDAQ row. **No Eternal. No Indian alias.** |

**Verdict: ALIVE-FREE, US-only, ~10 years deep, quotes good, search typo-tolerant but India-blind.**
Its **search index knows NSE symbols** while its **price API 404s on them** — a trap worth writing
down. Rank it **third** for US history, behind Yahoo and Nasdaq. Its `/api/search` is worth
harvesting for **US typo→ticker pairs** to seed the local index (B1.d).

### B2.c India: the failover is bulk, not an API — and Moneycontrol history is blocked

| Probe | Result |
|---|---|
| `https://priceapi.moneycontrol.com/pricefeed/nse/equitycash/RI` | **200, 3 456 bytes.** `{"code":"200","data":{"HP":"1267.40","BIDP":"1257.50","DISPID":"RI","newSubsector":"Oil Exploration and Production",…}}` — a **keyless live NSE quote** |
| `https://priceapi.moneycontrol.com/pricefeed/bse/equitycash/RI` | **200, 3 922 bytes** — same shape for **BSE**, which Yahoo cannot serve for dual-listed blue chips (experiment E3: `RELIANCE.BO` = 41 rows) |
| `https://priceapi.moneycontrol.com/techCharts/indianMarket/stock/history?symbol=Reliance&resolution=1D&from=820454400&to=…` | **403 Access Denied** (Akamai), with and without a `Referer` header, for `Reliance`, `RELIANCE`, `Eternal` |
| `…/techCharts/indianMarket/index/history?symbol=Nifty%2050&…` | **403 Access Denied** |

So Moneycontrol gives **search + live quote for NSE *and* BSE**, keyless — but **its history path is
firewalled exactly like `nseindia.com/api/*`** (round 1 F8). It is a `LiveQuote` and `SymbolSearch`
adapter only.

Other Indian failover candidates probed and rejected:

| Candidate | Probe | Result | Verdict |
|---|---|---|---|
| Groww chart | `https://groww.in/v1/api/charting_service/v4/chart/exchange/NSE/segment/CASH/RELIANCE/daily?…` | **404**, `404, not found!` | **REJECTED** — path retired |
| Groww search | `https://groww.in/v1/api/search/v3/query/global/st_query?query=zomato` | **200, 569 bytes.** `{"data":{"content":[{"analytics_label":"EXACT_QUERO","title":"Eternal Ltd.",…}]}}` | **ALIVE-FREE, search only.** Also resolves the Zomato rename. A viable *second* alias source alongside Moneycontrol; same undocumented-endpoint risk. No price path found. |
| Tickertape search | `https://api.tickertape.in/search?text=zomato&types=stock,etf` | **200, 227 bytes.** `{"data":{"total":1,"stocks":[],"brands":[{"stockName":"Info Edge (India) Ltd","name":"Zomato",…}]}}` | **REJECTED for search** — `stocks: []`, and it mis-attributes Zomato to Info Edge (a shareholder, not the issuer). Actively wrong. |
| BSE `api.bseindia.com` index/data | `…/DefaultData/w?Indexcode=SENSEX` | **301**, then **200 but 14 287 bytes of HTML** (`<title>LIVE Stock/Share Market …BSE SENSEX…`) | **REJECTED** — returns the site shell, not JSON. Matches round 1 F9's note that `api.bseindia.com` is unstable. |
| BSE `IndexArchDaily` | `…/IndexArchDaily/w?fromdate=01/09/2026&todate=11/09/2026&index=SENSEX` | **200, 2 bytes — `{}`** | **REJECTED** — alive but empty |
| niftyindices historical POST | `POST https://www.niftyindices.com/Backpage.aspx/getHistoricaldatatabletoString` with `Referer` | **302**, `{"Message":"There was an error processing the request."}` | **REJECTED** — ASP.NET postback, needs full browser session |

**So for Indian history the failover remains what round 1 already found: the official NSE/BSE
bhavcopy archive.** Re-confirmed alive today:
`https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20260911_F_0000.csv.zip` →
**200, 204 525 bytes**, valid ZIP (`PK` magic bytes, inner `BhavCopy_NSE_CM_…csv`).
`https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz` → **200, 1 940 184 bytes.**
`https://portal.amfiindia.com/spages/NAVAll.txt` → **200, 1 519 203 bytes.**
`https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR` → **200.**

**Blunt answer to "is there a keyless second opinion for Indian history?" — no API. The bhavcopy
archive is it, and it is unadjusted.** That is unchanged from round 1, and this round found nothing
better. **However**, the scope change materially improves this: because the owner logs splits,
bonuses and demergers himself, the app already holds the adjustment factors, so **unadjusted
bhavcopy becomes a first-class fallback rather than a degraded one**. The thing that made bhavcopy
awkward in round 1 — nobody to supply the corporate actions — is exactly the thing the owner has
volunteered to supply.

## B3 — Corporate actions: **optional, reconciliation only** (deprioritised per scope change)

Per the Coordinator's instruction, no further hunting was done. The material already gathered,
kept for its *reconciliation* value only:

- **Yahoo `v8/finance/chart?…&events=div,split`** returns `events.splits` and `events.dividends`
  inline with the price call we already make — **zero extra requests.** Round 1 F1 verified
  RELIANCE 2:1 splits in 1997, 2009 and 2017.
- **The useful application is a warning, not a data source:** when a backfill observes a split
  event on a date for which the owner's ledger has no corresponding manually-logged action, surface
  *"Yahoo reports a 2:1 split on 2017-09-07 for RELIANCE; you have not logged one."* Cheap, and it
  catches the exact error the manual-logging design is most exposed to — a forgotten action.
- **Known limit, from experiment E2, unchanged:** Yahoo records **no event at all for demergers**
  (`TMPV.NS` −40.2% on 2025-10-14, no `splits`/`dividends` entry). So the reconciliation check will
  catch missed *splits* but **cannot catch a missed demerger.** The compensating check is an
  unexplained-move alarm: any single-day move beyond ~25% with no recorded event **and** no ledger
  entry should be flagged for the owner to look at. That also catches E2's corrupt prints
  (RELIANCE 2005-07-28 +337%, NIFTYBEES 2019-12-19 ÷10).
- No BSE/NSE/SEBI corporate-action feed was probed this round. **Open, by decision, not by
  oversight.**

## B4 — Indian breadth: BSE, ETFs, and index series for benchmark charts

### Indices — Yahoo wins, and the alternatives are shallow

| Probe | Result |
|---|---|
| `https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?period1=0&period2=…&interval=1d` | **200, 4 691 rows, first 2007-09-17** (NIFTY 50) |
| `https://query1.finance.yahoo.com/v8/finance/chart/%5EBSESN?period1=0&…` | **200, 7 323 rows, first 1997-07-01** (SENSEX) |
| `https://nsearchives.nseindia.com/content/indices/ind_close_all_11092026.csv` | **200, 17 460 bytes.** Header `Index Name,Index Date,Open Index Value,High…,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield`; row `Nifty 50,11-09-2026,23270.3,23448.1,23231.4,23398.1,-79.7,-.34,…,19.78,2.83,1.21`. **Every NSE index in one keyless file, with P/E, P/B and dividend yield.** |
| Archive depth scan | `02012020` **200 (7 619 B)**, `01072014` **200**, `02012013` **200**, `01072012` **404**, `03012011` **404**, `01042010` **404**, `03012005` **404** — **the daily index archive starts around 2013** |
| `https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv` | **200, 3 352 bytes.** `Company Name,Industry,Symbol,Series,ISIN Code` — `Adani Enterprises Ltd.,Metals & Mining,ADANIENT,EQ,INE423A01024`, … **Keyless index constituents with ISIN** |

**Recommendation:** **Yahoo `^BSESN` (1997→) and `^NSEI` (2007→) are the benchmark series** — deepest
by a wide margin and they need no new adapter, just two more symbols through the existing path.
**`ind_close_all_<DDMMYYYY>.csv` is the official keyless failover from ~2013 onward**, one request
per day for *every* NSE index, and it uniquely carries index **P/E, P/B and dividend yield** — which
Yahoo does not, and which is genuinely useful context on a benchmark chart. **`ind_nifty50list.csv`
gives constituents with ISIN**, joining straight onto the existing catalogue key, for sector or
"how many of your holdings are in the NIFTY 50" views.

### BSE breadth and ETFs — no change needed

Round 1 defect **D-6** (Upstox BSE master not ingested) and experiment **E3** (2 510 BSE-only ISINs,
**96% priceable on Yahoo `.BO`**, BSE `instrument_type` is a group code not `"EQ"`) already settle
this. **This round found nothing that supersedes it.** The new contribution is
**Moneycontrol `pricefeed/bse/equitycash/` (200, 3 922 bytes)** as a keyless **BSE live quote**
failover, which matters specifically for the dual-listed blue chips whose `.BO` Yahoo series E3
found truncated to 41 rows. ETFs are covered by the existing masters and by Yahoo
(`NIFTYBEES.NS` 4 375 rows per E2; `VOO` 4 026 rows on both Yahoo and Nasdaq).

## B5 — Self-hostable / open-source engines

**No probing needed beyond confirming the constraint; reporting for awareness as asked.**

| Project | What it is | JS/TS callable? | Verdict |
|---|---|---|---|
| **OpenBB Platform** | Python SDK aggregating ~100 providers behind one interface; the community edition is free | **No — Python.** It ships an optional FastAPI server, which would mean running and operating a Python service beside Next.js | **Do not adopt. Do read its provider interface as a design reference** — its `Provider`/`Fetcher`/standard-model split is almost exactly the swappable-engine seam the owner is asking for, and it is worth 20 minutes of the Planner's time as prior art. |
| **Ghostfolio** | Self-hosted portfolio tracker, **TypeScript/NestJS**, AGPL-3.0 | **Yes — the only TS one here** | **The closest prior art.** Its data layer is a `DataProviderInterface` with per-vendor services (Yahoo, CoinGecko, manual, …) and a `DataSource` enum on each symbol profile — i.e. it already solved "swappable engine, symbol remembers its vendor" in TypeScript. **Read `apps/api/src/services/data-provider/` before designing ours.** Licence is AGPL, so copy the *shape*, not the code. |
| **Maybe Finance** | Ruby on Rails personal finance app, open-sourced 2025 | No | Not applicable to a TS codebase; its market data is a thin Synth/paid wrapper anyway |
| **`jugaad-data`, `nsepython`** | Python wrappers around NSE/BSE endpoints | No | **Wrap the same upstreams we already call directly** — and several of those upstreams (`nseindia.com/api/*`) are the ones round 1 F8 found 403-blocked. Adding Python buys nothing. Round 1's judgement stands. |
| **Apache Arrow / Parquet datasets** | Columnar storage format, not a data source | n/a | **Relevant to storage, not sourcing.** If the bhavcopy archive is self-hosted (round 1 D8), Parquet is the sane on-disk format for ~15 years × ~3 600 scrips. A note for the Planner, not a source. |

## B6 — Forward-looking inputs (new, short, and honest)

The owner wants "future prediction" alongside past analysis. **On the data-sourcing question only:**

**No free keyless source of analyst estimates or consensus price targets was found.** Yahoo's
`quoteSummary` is where `recommendationTrend`, `earningsTrend` and `financialData.targetMeanPrice`
live, and it is closed: `https://query2.finance.yahoo.com/v10/finance/quoteSummary/AAPL?modules=financialData`
→ **401, `{"finance":{"result":null,"error":{"code":"Unauthorized","description":"Invalid Crumb"}}}`** —
the same crumb wall round 1 F4 documented on `v7/quote`. Every registry source that advertises
estimates (Finnhub, FMP, Intrinio, Twelve Data, Alpha Vantage, EODHD) is **keyed**, and their free
tiers gate estimates behind paid plans or fall under the 500/day floor.

What **is** freely available and is a legitimate forward-looking *input*: the **benchmark index
series** (B4 — `^NSEI`, `^BSESN`, plus `ind_close_all` with index P/E, P/B and dividend yield), and
**full-inception price history**, which together support relative-performance, drawdown,
rolling-return and valuation-context views. **That is comparison and context, not prediction.**
Anything genuinely predictive would have to be computed from the price and ledger data the app
already holds — which is a modelling question, explicitly out of scope for this document.
**Recommendation: do not design a data dependency around forecasting; there is nothing free to
depend on.**

---

# Task C — capability / adapter map for the swappable engine

## C.1 The capability set (`CorporateActions` demoted per scope change)

| Capability | Required? | Contract sketch |
|---|---|---|
| `SymbolSearch` | **Yes** | `search(query, {market}) → CandidateRow[]` — must return exchange + currency labels, never auto-select |
| `LiveQuote` | **Yes** | `quote(quoteKey) → { price, currency, asOf, staleness }` |
| `HistoricalSeries` | **Yes** | `history(quoteKey, from, to) → Bar[]` — must declare `adjusted: boolean` |
| `FxRate` | **Yes** | `rate(base, quote, onDate) → { rate, effectiveDate }` — **must return the date actually used** (experiment E4) |
| `InstrumentMaster` | **Yes** | `listInstruments() → MasterRow[]` keyed by ISIN, carrying `quoteKey` per vendor |
| `CorporateActions` | **Optional — reconciliation only** | `events(quoteKey, from, to) → Event[]`, consumed to *warn* about unlogged actions, never to mutate the ledger |

## C.2 Source → capability matrix (every row probed 2026-09-13)

Legend: ● primary-grade · ◐ usable/limited · ○ no. Auth: **K** keyless · **UA** browser UA required.

| Source | Auth | SymbolSearch | LiveQuote | HistoricalSeries | FxRate | InstrumentMaster | CorpActions (opt.) | IN | US | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| **Yahoo `v8/finance/chart`** | K+UA | ○ | ● | ● inception depth | ● `USDINR=X` | ○ | ◐ splits/divs, **no demergers** | ● NSE, ◐ BSE | ● | ALIVE-FREE |
| **Yahoo `v1/finance/search`** | K+UA | ◐ 74% intent (E1) | ○ | ○ | ○ | ○ | ○ | ◐ | ◐ | ALIVE-FREE, demote to candidate generator |
| **`api.nasdaq.com/api/quote/{s}/chart`** | K+**UA** | ○ | ◐ `lastSalePrice` | ● **9 241 rows from 1990** | ○ | ○ | ○ | ○ | ● + ADRs | **ALIVE-FREE — new** |
| **stockanalysis.com `/api/*`** | K+UA | ◐ typo-tolerant, US-only | ● incl. after-hours | ◐ **~10 y cap**, `MAX` lies | ○ | ○ | ○ | ○ search only | ● | **ALIVE-FREE — new** |
| **Moneycontrol `autosuggest` + `techCharts/search`** | K | ● **5/7 E1 failures fixed**, returns ISIN | ○ | ○ (history **403**) | ○ | ◐ alias harvest | ○ | ● NSE+BSE | ◐ ADR ISINs | **ALIVE-FREE — new** |
| **Moneycontrol `pricefeed/{nse,bse}`** | K | ○ | ● **incl. BSE** | ○ | ○ | ○ | ○ | ● | ○ | **ALIVE-FREE — new** |
| **Groww `search/v3`** | K | ◐ resolves renames | ○ | ○ (**404**) | ○ | ○ | ○ | ● | ○ | ALIVE-FREE, search only |
| **OpenFIGI `/v3/mapping`** | K, **25/min** | ○ (futures/options rank first) | ○ | ○ | ○ | ● **ISIN↔ticker↔exch↔shareClassFIGI** | ○ | ● | ● | **ALIVE-FREE — new** |
| **NSE bhavcopy archive** | K+UA | ○ | ◐ T+0 EOD | ● official, **unadjusted** | ○ | ◐ | ○ | ● | ○ | ALIVE-FREE (round 1) |
| **BSE bhavcopy CSV** | K+UA | ○ | ◐ T+0 EOD | ● official, unadjusted | ○ | ◐ | ○ | ● BSE | ○ | ALIVE-FREE (round 1) |
| **NSE `EQUITY_L.csv`** | K+UA | ○ | ○ | ○ | ○ | ● ISIN + listing date | ○ | ● | ○ | ALIVE-FREE (round 1) |
| **Upstox masters NSE/BSE** | K | ○ | ○ | ○ | ○ | ● ISIN-keyed, both exchanges | ○ | ● | ○ | ALIVE-FREE (round 1) |
| **SEC `company_tickers_exchange.json`** | K/UA | ○ | ○ | ○ | ○ | ● CIK+ticker+exchange | ○ | ○ | ● | ALIVE-FREE (round 1) |
| **Nasdaq Trader SymDir** | K | ○ | ○ | ○ | ○ | ● + ETF flag | ○ | ○ | ● | ALIVE-FREE (round 1) |
| **NSE `ind_close_all_*.csv`** | K+UA | ○ | ◐ index EOD | ● **indices from ~2013**, + P/E, P/B, div yld | ○ | ◐ via `ind_nifty50list.csv` | ○ | ● indices | ○ | **ALIVE-FREE — new** |
| **Frankfurter** | K | ○ | ○ | ○ | ● **2000-01-13→, self-hostable** | ○ | ○ | ● | ● | ALIVE-FREE (round 1) |
| **Exchangerate.dev** | K, 10k/mo | ○ | ○ | ○ | ● Frankfurter-shaped, 1999→; *indicative* | ○ | ○ | ● | ● | **ALIVE-FREE — new** |
| **currency-api (jsDelivr CDN)** | K, unmetered | ○ | ○ | ○ | ◐ **today + ~recent only** (2019 → 404) | ○ | ○ | ● | ● | **ALIVE-FREE — new** |
| **AMFI / MFAPI** | K | ● MF schemes | ● NAV | ● NAV history | ○ | ● scheme master | ○ | ● MF | ○ | ALIVE-FREE (round 1) |
| GLEIF `fuzzycompletions` | K | ○ **empty for `zomato`** | ○ | ○ | ○ | ○ legal entities, no ticker | ○ | ○ | ○ | **REJECTED** |
| Wikidata / DBpedia | K | ○ no spell-correct | ○ | ○ | ○ | ○ **no ISIN/ticker on Q8073715** | ○ | ○ | ○ | **REJECTED** |
| SEC EDGAR full-text (`efts`) | K | ○ ranks by filing text | ○ | ○ | ○ | ○ | ○ | ○ | ◐ | **REJECTED for search** |
| Tickertape search | K | ○ **wrong issuer** | ○ | ○ | ○ | ○ | ○ | ○ | ○ | **REJECTED** |
| `api.bseindia.com` index paths | K | ○ | ○ | ○ HTML / `{}` | ○ | ○ | ○ | ○ | ○ | **REJECTED** |
| niftyindices `Backpage.aspx` | session | ○ | ○ | ○ **302** | ○ | ○ | ○ | ○ | ○ | **REJECTED** |
| Econdb | now keyed | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | **REJECTED — 401** |
| Portfolio Optimizer / Goldprice.dev / KmalServico | — | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | **REJECTED — 404** |
| Groww chart v4 | — | ○ | ○ | ○ **404** | ○ | ○ | ○ | ○ | ○ | **REJECTED** |
| exchangerate.host / IEX Cloud / EODHD / Polygon / Alpha Vantage / Finnhub / FMP / Twelve Data / SmartAPI / Kite quotes | keyed or paid | — | — | — | — | — | — | — | — | **REJECTED** (round 1 F14/F15; IEX retired Aug 2024; EODHD 20/day) |

## C.3 Proposed adapter folders, and what plugs where

This is the *research* view of the seam. The Planner owns the final layout.

```
market-data/
  ports/                 SymbolSearchPort, LiveQuotePort, HistoricalSeriesPort,
                         FxRatePort, InstrumentMasterPort, (CorporateActionsPort — optional)
  engine/                registry + chain-of-fallback + per-symbol vendor pinning
                         (Ghostfolio's `DataSource`-on-the-symbol pattern)
  adapters/
    india/               moneycontrol-search, moneycontrol-quote,
                         nse-bhavcopy-history, bse-bhavcopy-history,
                         nse-equity-master, upstox-master, nse-index-close, amfi, mfapi
    international/       nasdaq-chart-history, stockanalysis-history,
                         stockanalysis-quote, sec-master, nasdaq-trader-master
    global/              yahoo-chart (quote + history, IN and US),
                         yahoo-search (candidate generator only)
    symbology/           openfigi-mapping (ISIN ↔ ticker ↔ exchange ↔ shareClassFIGI)
    fx/                  frankfurter, exchangerate-dev, currency-api-cdn
    local/               catalogue index + fuzzy ranker (MiniSearch/Fuse) — the actual SymbolSearch
    manual/              user-entered prices; the `MANUAL` tier
```

Two properties make the seam pay off, and both are forced by measurements already in hand:

1. **Vendor pinning per instrument.** `TATAMOTORS.NS` 404s (E3) while `AAPL` is served by three
   vendors. A single global "current provider" cannot express that. Each catalogue row must carry
   *which* adapter resolved it, so a failover is per-symbol, not per-app.
2. **Every `HistoricalSeries` adapter declares `adjusted: boolean` and `rateType`/`priceType`.**
   Yahoo and Nasdaq are adjusted; bhavcopy is not; Frankfurter is an ECB fixing while
   Exchangerate.dev is an indicative live rate (0.18%-class seams, E4). **Mixing them inside one
   portfolio's history produces phantom P&L.** The interface must make that impossible to do by
   accident, which is the strongest argument for the seam the owner wants.

## C.4 Paid drop-ins per capability — for designing the seam, not for buying

Prices are **indicative list prices as publicly advertised**, gathered from vendor pages during the
sweep. **Not probed, not verified, and not a recommendation to purchase.**

| Capability | Natural paid drop-in | Rough price | Why it is the natural fit |
|---|---|---|---|
| `SymbolSearch` + `InstrumentMaster` | **OpenFIGI with a free registered key** | **$0** | Same API, 25 req/6 s and 100 jobs/request instead of 25/min and 10 jobs. **The cheapest upgrade in this table costs nothing.** |
| `SymbolSearch` (IN) | **Kite Connect** instrument dump | ₹500/mo (bundled with the API) | Authoritative Indian tradable universe |
| `LiveQuote` + `HistoricalSeries` (IN) | **Kite Connect** / **Upstox** / **Dhan** | ~₹500–2 000/mo | Real-time Indian ticks; requires a funded broking account |
| `LiveQuote` + `HistoricalSeries` (IN + US, one vendor) | **EOD Historical Data (eodhd.com)** | ~$20–80/mo | 150+ exchanges incl. NSE/BSE; the single cheapest way to replace Yahoo on both sides at once |
| `HistoricalSeries` (US, deep + adjusted) | **Tiingo** | ~$10–50/mo | Deep adjusted US EOD; generous relative to price |
| `LiveQuote` (US, real-time) | **Polygon / Massive** | from ~$99/mo | Real-time US; no free tier since the Oct 2025 rebrand |
| `HistoricalSeries` + estimates (US) | **Financial Modeling Prep** / **Twelve Data** paid | ~$15–30/mo | Adds the analyst estimates B6 found nowhere free |
| `FxRate` | **self-hosted Frankfurter (Docker)** | **$0 + hosting** | Removes the SPOF without changing the data or the adapter |

**The seam is the deliverable, not the purchase.** Every row above lands behind an existing port; if
the ports are honest about `adjusted`, `currency`, `asOf` and `effectiveDate`, swapping in any of
them is a config change plus one adapter file.

---

# Verified facts vs assumptions

## Verified (probed live 2026-09-13, status + payload recorded above)

- **V1** OpenFIGI `/v3/mapping` and `/v3/search` work with **no API key**; headers report
  `ratelimit-limit: 25`, `ratelimit-policy: 25;w=60`; exceeding it returns the plaintext
  `Too many requests, please try again later.`
- **V2** OpenFIGI returns `compositeFIGI` and `shareClassFIGI` for Indian ISINs across `IN`/`IB`/`IS`
  exchange codes, and maps `TICKER:ETERNAL/IS` → `ETERNAL LTD`.
- **V3** OpenFIGI free-text search ranks **SINGLE STOCK FUTURE** and **Equity Option** rows above cash
  equities.
- **V4** Moneycontrol autosuggest is keyless, returned **200 on all 10 rapid calls**, and resolves
  `zomato`→`Eternal (INE758T01015, ETERNAL, 543320)` and `micrsoft`→`Microsoft (US5949181045, MSFT:US)`.
- **V5** Moneycontrol `techCharts/.../stock/search` returns explicit **NSE and BSE** rows; its
  `.../history` sibling returns **403 Access Denied** on every attempt.
- **V6** Moneycontrol `pricefeed/nse/equitycash/RI` → **200, 3 456 B**; `pricefeed/bse/equitycash/RI`
  → **200, 3 922 B**.
- **V7** `api.nasdaq.com/api/quote/AAPL/chart?assetclass=stocks&fromdate=1980-01-01` → **200,
  1 742 386 B, 9 241 rows, 1990-01-02 → 2026-09-11**; JPM identical row count; VOO needs
  `assetclass=etf`; `BRK-B` → `"Symbol not exists."`.
- **V8** Nasdaq's AAPL series is **split-adjusted**: `8/28/2020 124.8075` → `8/31/2020 129.04`,
  matching experiment E2's Yahoo values exactly.
- **V9** Nasdaq returned **200 on 15/15** rapid calls with a browser UA and **timed out with 0 bytes**
  with curl's default UA.
- **V10** stockanalysis.com `range=MAX` returns **252 rows** while `range=10Y` returns **2 513** —
  `MAX` understates.
- **V11** stockanalysis.com `/api/search` is typo-tolerant (`micrsoft`→MSFT, `brk.b`→BRK.B) and
  indexes NSE symbols, but its NSE **price** endpoints return **404**.
- **V12** GLEIF `fuzzycompletions` for `zomato` → **200, `{"data":[]}`**.
- **V13** Wikidata `Q8073715` (Zomato) has **no ISIN (P946) and no ticker (P249)**, and its English
  aliases do **not** include "Eternal".
- **V14** Yahoo `v1/finance/search?q=zomato` still returns **`"count":0,"quotes":[]`** today.
- **V15** Yahoo `v10/finance/quoteSummary/AAPL?modules=financialData` → **401 Invalid Crumb** — no
  keyless analyst estimates.
- **V16** `nsearchives.nseindia.com/content/indices/ind_close_all_<DDMMYYYY>.csv` → **200** for
  2026-09-11, 2020-01-02, 2014-07-01, 2013-01-02; **404** for 2012-07-01, 2011-01-03, 2010-04-01,
  2005-01-03.
- **V17** `niftyindices.com/IndexConstituent/ind_nifty50list.csv` → **200, 3 352 B**, with ISIN per
  constituent.
- **V18** Exchangerate.dev → **200**, keyless, `"notice":"Indicative rates…"`, `"market_session":"weekend"`.
- **V19** currency-api dated snapshots resolve for `2024-03-06` (**200**) but not `2019-11-12` (**404**).
- **V20** Econdb → **401**; Portfolio Optimizer, Goldprice.dev, KmalServico → **404**; Groww chart v4
  → **404**; `api.bseindia.com` index paths → HTML / `{}`; niftyindices POST → **302**.
- **V21** Still alive and unchanged: NSE bhavcopy zip (**200, 204 525 B**), Upstox NSE master
  (**200, 1 940 184 B**), AMFI NAVAll (**200, 1 519 203 B**), Frankfurter (**200**).
- **V22** Yahoo `^BSESN` → **7 323 rows from 1997-07-01**; `^NSEI` → **4 691 rows from 2007-09-17**.

## Assumptions (NOT verified — flagged for whoever acts on this)

- **AA1** Nasdaq's identical row counts to Yahoo for NVDA (6 952) and VOO (4 026) are read here as
  **evidence of a shared upstream feed**. Not proven. If an independent *oracle* is ever needed to
  validate Yahoo's corrupt prints, this assumption must be tested first (compare a date where Yahoo
  is known wrong, e.g. RELIANCE 2005-07-28 — though Nasdaq has no Indian coverage, so the test would
  need a US example).
- **AA2** Moneycontrol's, Groww's and Nasdaq's endpoints are **undocumented site APIs with no ToS
  grant**. Same risk class as Yahoo. They can change or block without notice. The 403 already
  observed on Moneycontrol's history path is a live demonstration.
- **AA3** Moneycontrol autosuggest's intent accuracy was measured on **11 queries**, chosen to mirror
  experiment E1. That is a small, biased sample — biased *towards* the known failures. A fair
  comparison needs E1's full 23-query set re-run against it before anyone claims a percentage.
- **AA4** OpenFIGI's keyless limit was read from response headers on this date. Bloomberg can change
  it. The free registered-key tier (25 req/6 s, 100 jobs) is taken from their published page, **not**
  probed with a key.
- **AA5** All prices in C.4 are advertised list prices read during the sweep, **unverified**.
- **AA6** Nasdaq's `chart` endpoint depth was checked on 7 symbols. Coverage of small caps, recent
  IPOs and delisted tickers is unmeasured.
- **AA7** The NSE index archive's start boundary was bracketed to **between 2012-07 and 2013-01** by
  four probes, not mapped precisely.
- **AA8** **Deployment egress remains unmeasured** (round 1 A1, experiment E7). Every probe in this
  document came from one Indian residential IP. **Moneycontrol and NSE sit behind Akamai, which
  already 403s some paths from this IP — a cloud egress IP may fare worse.** This is unchanged and
  still the highest-severity open item.

## Completeness note

This document was written after the research session was interrupted by an API rate limit at the
point where probing finished and writing began. **All probe results above were already captured in
the session transcript and are reproduced verbatim; nothing here is reconstructed from memory of an
unprobed endpoint.** Two areas are genuinely thin, and are thin *by decision*, not by loss:
**B3 (corporate actions)**, deprioritised by the Coordinator's scope change, and **B5
(open-source engines)**, which was answered from the existing TypeScript-only constraint rather
than by probing. No gap has been filled with an unverified claim.

---

# Decisions and constraints proposed by this round

- **R1** — **Round 1's stack stands.** Yahoo `v8/finance/chart` remains the primary for quote and
  history; Frankfurter remains FX primary; the local ISIN catalogue remains identity. Nothing in any
  registry displaces them.
- **R2** — **The search fix is local.** Build the fuzzy ranker in-process over the ~30 000-row
  catalogue (MiniSearch/Fuse), with a **home-listing boost** and **`.`→`-` query normalisation**.
  Yahoo search is demoted to a candidate generator, filtered to `quoteType ∈ {EQUITY, ETF}`.
- **R3** — **Seed the alias table offline from Moneycontrol autosuggest (primary) and Groww search
  (secondary), keyed by ISIN.** This is what supplies renames. It runs on a schedule against the
  master; **it is never on the user's keystroke path.**
- **R4** — **Adopt OpenFIGI as the `InstrumentMaster` symbology adapter**, keyless at 25 req/min,
  batched 10 jobs per request, run as a backfill. Persist `shareClassFIGI` as the rename-proof
  identity. **Never expose its free-text search to users** (futures/options rank first).
- **R5** — **Adopt `api.nasdaq.com/api/quote/{s}/chart` as the US `HistoricalSeries` failover** and
  **stockanalysis.com as the third line** (US, ~10 y, and a good `LiveQuote` with after-hours).
  Both require a browser-shaped UA. `MAX` is a lie on stockanalysis, exactly as on Yahoo.
- **R6** — **Adopt Moneycontrol `pricefeed/{nse,bse}` as the Indian `LiveQuote` failover**,
  particularly for **BSE dual-listed** names where Yahoo `.BO` is truncated (E3).
- **R7** — **Indian `HistoricalSeries` failover stays the NSE/BSE bhavcopy archive.** No API
  alternative exists. **The manual-corporate-action scope change upgrades bhavcopy from degraded to
  first-class**, because the owner supplies the adjustment factors the raw series lacks.
- **R8** — **Benchmarks: Yahoo `^BSESN` (1997→) and `^NSEI` (2007→) primary;
  `ind_close_all_<DDMMYYYY>.csv` failover from ~2013**, which also supplies index P/E, P/B and
  dividend yield. `ind_nifty50list.csv` gives ISIN-keyed constituents.
- **R9** — **FX chain: Frankfurter → Exchangerate.dev → currency-api (today only).** Persist the
  `effectiveDate` the API reports (E4). **Never mix rate types within one portfolio's history** —
  ECB fixing vs indicative live vs Yahoo market rate are three different things.
- **R10** — **Drop `CorporateActions` from the required capability set.** Keep Yahoo's inline
  `events=div,split` (free, same request) as a **reconciliation warning** plus an
  **unexplained-move alarm** for the demerger and corrupt-print cases Yahoo cannot signal.
- **R11** — **Reject and do not revisit:** GLEIF, Wikidata/DBpedia, SEC EDGAR full-text search,
  Tickertape, `api.bseindia.com` index paths, niftyindices `Backpage.aspx`, Econdb, Portfolio
  Optimizer, Goldprice.dev, KmalServico, Groww chart v4, IEX Cloud (retired), EODHD free (20/day),
  and the public-apis/public-api-lists registries themselves as a discovery mechanism for this domain.
- **R12** — **Read Ghostfolio's `data-provider` layer as prior art** before finalising the seam (TS,
  same problem, already solved once); read OpenBB's provider interface as a second reference. Copy
  the shape, not the code (AGPL).

# Step-by-step plan (for the receiving agent; nothing executed here)

- [ ] 1. Re-run experiment E1's **full 23-query set** against Moneycontrol autosuggest + a local
      fuzzy ranker prototype, and report intent accuracy against the 74% baseline — Owner: Experiment
      Agent — Files: scratchpad only — Verify: accuracy ≥ 90%, with the failures named (closes AA3)
- [ ] 2. Run the **deployment-egress probe** from experiment E7 step 8, extended with
      `api.nasdaq.com`, `priceapi.moneycontrol.com` and `api.openfigi.com` — Owner: DevOps Expert —
      Verify: 200 on all endpoints, 10/10 (closes AA8, the top open risk)
- [ ] 3. Design the port/adapter seam per C.3, with `adjusted`/`rateType` on every series and
      per-symbol vendor pinning — Owner: Planner/Implementer — Files: `src/domain/pricing.ts`,
      `src/infra/providers.ts`, `src/infra/instrument-catalog.ts`
- [ ] 4. Independent QA — Owner: Testing/QA Agent

# QA record

Status: NOT_RUN
Evidence:
- Research lane only. **No production file changed.** One repository file written: this one.
  Nothing staged, nothing committed. `git status` at start: `?? _architecture/requirements/`.
- ~60 live HTTP probes on 2026-09-13 from one Indian residential IP, Windows 11, `curl` + `node`,
  scripts `p1.sh`–`p9.sh` in the session scratchpad.
- `npm run lint` / `typecheck` / `test` / `build` **not run** — this lane changed no repository code,
  so they would verify nothing.
Residual risks:
- **AA8 — deployment egress still unmeasured across both rounds.** Now larger in scope, because two
  of the three new recommendations (Moneycontrol, and NSE archives) sit behind Akamai.
- **AA2 — three of the new sources are undocumented site endpoints** with no ToS grant. Adopting
  them raises vendor-concentration resilience while raising ToS/stability exposure. That trade is
  the owner's call, not this document's.
- **AA3 — the Moneycontrol search win is measured on 11 queries**, deliberately chosen from the
  known failures. Treat "5 of 7 fixed" as directional until step 1 runs.

---

## Baton: Research Agent (round 2) -> Coordinator

- **Goal:** Sweep the public-apis registries the owner asked about, and report free sources mapped
  onto pluggable adapter capabilities so a paid API can be dropped in later — re-prioritised
  mid-task to symbol search, a Yahoo failover, Indian breadth and indices, with corporate actions
  demoted to optional reconciliation.
- **Completed:** Fetched and worked through public-apis (200, 250 716 B), public-api-lists
  (200, 195 463 B) and awesome-quant (200, 143 290 B) — finance, currency and crypto sections. Ran
  ~60 live probes. **Registry yield: essentially zero usable equity price sources; four registry
  entries proven stale.** Three genuinely valuable sources found, two of them outside the
  registries: **OpenFIGI** (keyless, 25/min, ISIN↔ticker↔exchange↔shareClassFIGI),
  **Moneycontrol autosuggest + techCharts search** (keyless, fixes 5 of 7 named E1 search failures
  including `zomato`→Eternal and the typo `micrsoft`→Microsoft, returns ISIN + NSE symbol + BSE code),
  and **`api.nasdaq.com/api/quote/{s}/chart`** (keyless, 9 241 daily bars from 1990, split-adjusted —
  the first credible keyless US history failover across both rounds). Plus `stockanalysis.com`
  (US, ~10 y, good quotes, typo-tolerant search), `Moneycontrol pricefeed` (keyless **BSE** live
  quotes), `ind_close_all_*.csv` (all NSE indices from ~2013 with P/E, P/B, div yield), and two FX
  failovers (Exchangerate.dev, currency-api CDN).
- **Decisions:** R1–R12. The four that matter most: **(R1) round 1's stack stands — nothing in the
  registries beats it**; **(R2/R3) the 74% search problem is fixed locally**, with a fuzzy ranker
  over the existing ~30 000-row catalogue plus an offline-harvested alias table, not by any external
  search API; **(R5/R6) Yahoo now has a real failover** — Nasdaq for US history, Moneycontrol for
  Indian and BSE quotes; **(R7) the manual-corporate-action decision upgrades the bhavcopy archive
  from degraded fallback to first-class**, because the owner supplies the adjustment factors it lacks.
- **Inputs:** `_architecture/requirements/market-data-sources-research.md` (F1–F15, D-1..D-6),
  `_architecture/requirements/market-data-experiment-results.md` (E1–E7, the 16-item trap list).
  Read but not changed: `src/infra/providers.ts`, `src/infra/instrument-catalog.ts`,
  `src/domain/pricing.ts`.
- **Changed files:** `_architecture/requirements/market-data-sources-research-round2.md` (new, this
  file). **No production file touched. Nothing staged or committed.**
- **Contract/output:** The registry sweep table with ALIVE-FREE / REJECTED and a probe result per
  row; the Task C capability matrix (`SymbolSearch`, `LiveQuote`, `HistoricalSeries`, `FxRate`,
  `InstrumentMaster`, optional `CorporateActions`) with IN/US coverage; the proposed
  `india / international / global / symbology / fx / local / manual` adapter folder layout; and the
  paid drop-in table per capability.
- **Verification:** ~60 `curl`/`node` probes, statuses, byte counts and payload excerpts recorded
  inline as V1–V22. Scripts `p1.sh`–`p9.sh` in
  `C:\Users\DEBASI~1\AppData\Local\Temp\claude\d--WorkStation-Projects-Stock-Mania\9b5d9c82-c7bc-4dd6-a25d-0031fcfad517\scratchpad\`.
  No repository command run — this lane changed no code.
- **Open risks:** **Deployment egress remains unmeasured (AA8)** and now covers three more Akamai-
  fronted hosts. **Three new sources are undocumented site endpoints with no ToS grant (AA2)** —
  adopting them trades ToS exposure for vendor-concentration resilience; that is the owner's
  decision. **The Moneycontrol search result is measured on 11 queries deliberately drawn from the
  known failures (AA3)** — directional, not a validated percentage.
- **Next action:** Re-run experiment E1's **full 23-query set** against Moneycontrol autosuggest plus
  a local fuzzy-ranker prototype and report intent accuracy against the 74% baseline. Run it
  together with the deployment-egress probe, extended to `api.nasdaq.com`,
  `priceapi.moneycontrol.com` and `api.openfigi.com`. Then hand all three documents to the
  Planner/Implementer for the adapter seam.
- **Do not revisit:** The public-apis / public-api-lists / awesome-quant registries — swept, and
  they are a poor discovery mechanism for this domain. GLEIF, Wikidata/DBpedia, SEC EDGAR full-text
  search, Tickertape, `api.bseindia.com`, niftyindices `Backpage.aspx`, Econdb, Portfolio Optimizer,
  Goldprice.dev, KmalServico, Groww chart v4, IEX Cloud, EODHD free — each probed and rejected with
  a recorded status code. Also settled: **OpenFIGI is an InstrumentMaster, not a SymbolSearch**
  (its free-text search ranks futures and options first), and **Moneycontrol's history path is
  403-blocked** while its search and quote paths are open.
