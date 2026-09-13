# Free market-data sources for IN + US equities: search, live quote, full history, FX

Status: READY
Owner: Research Agent (lane: Research only, per AGENTS.md "Requirement modes" option 2)
Updated: 2026-09-13

## Requirement

Stock-Mania must let a user type `relia` or `appl`, pick a real instrument, and have the app
**refuse the entry if that instrument cannot be priced**. Once added, the instrument needs a
near-live quote (for unrealised P&L), a full daily OHLC series back to its listing date (for
long-range charts and comparison analytics), and a USD/INR series so a USD holding can be
reported in INR. Every source must be free, with no paid tier and no trial key; keyless and
self-hostable is strongly preferred; Indian coverage is first-class.

## Acceptance criteria

- [ ] Every source in the comparison table below was probed live on 2026-09-13 and its HTTP
      status, payload shape and history depth recorded (done in this document).
- [ ] A primary + fallback stack is named separately for IN and US, for each of
      search / live quote / full history / FX.
- [ ] An identifier-mapping strategy exists that makes "unpriceable ⇒ unaddable" a structural
      guarantee, not a runtime hope.
- [ ] A falsifiable hypothesis list is handed to the Experiment Agent.
- [ ] No recommendation appears that was not verified live and free.

## Context map

| Need | Authoritative file/section | Why it is needed |
|---|---|---|
| Provider base class, retry/token-bucket/circuit-breaker, existing keyless providers | `src/infra/providers.ts` (`PriceProvider`, `YahooQuoteProvider` L812, `NseQuoteProvider` L921, `EcbFxProvider` L1231, `AmfiNavHistoryProvider` L1449) | The recommendation must land as new/edited `PriceProvider` subclasses, not a new HTTP layer |
| Instrument master ingestion (Upstox / Zerodha / AMFI / SEC) | `src/infra/instrument-catalog.ts` | Search catalogue already exists; this research tells it which masters to trust |
| Provider ports, `QuoteRequest`, `ProviderCapabilities`, `IdentifierType` | `src/domain/pricing.ts` | Defines the contract any new source must satisfy |
| Catalogue search output consumed by the add form | `src/domain/instrument-catalog.ts`, `app/(root)/investments/catalog-actions.ts`, `app/(root)/investments/add-instrument-form.tsx` | Where the "refuse unpriceable" gate must be enforced |
| Scheduled refresh + FX refresh | `app/api/cron/market-data/route.ts` | The backfill/delta job that will carry the history strategy |
| HTTP client default headers | `src/infra/providers.ts` L66-94 (`FetchHttpClient`) | Its default User-Agent is currently rejected by sec.gov (see Defect D-1) |

### Which codebase this targets

**`src/` (the drizzle/libSQL ledger), not the mongoose `app/` v1 path.** Evidence: on this
branch `app/api/cron/market-data/route.ts` and `app/(root)/investments/catalog-actions.ts`
already import `@/infra/container`, `@/domain/pricing` and `@/domain/instrument-catalog` —
the live App Router surface is consuming the `src/` domain. `grep` for HTTP URLs across
`app/` and `lib/` returns only TradingView embeds, favicon services and email images: there
is **no market-data fetching in the v1 path at all**. Every provider URL in the repository
lives in `src/infra/`. So the work belongs there, and the v1 float-based path needs no change.

---

## Verified facts (all probed 2026-09-13 from a server-side HTTP client, no browser)

Probes were plain `curl` with a browser-like User-Agent — the same shape as
`FetchHttpClient.get` in `src/infra/providers.ts`.

### F1 — Yahoo `v8/finance/chart` is alive, keyless, and carries quote + full history + splits

`GET https://query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?period1=0&period2=<now>&interval=1d&events=div,split`
→ **200**, `7714` daily rows, first `1996-01-01`, last `2026-09-09`.
`meta` carries `currency: "INR"`, `fullExchangeName: "NSE"`, `instrumentType: "EQUITY"`,
`firstTradeDate: 820467900` (1995-12-31) and `regularMarketPrice: 1257.5`.
`indicators.adjclose` is present; `events.splits` lists `2:1` in 1997, 2009 and 2017.
Raw `close[0] = 6.3105` vs `adjclose[0] = 3.9480` — i.e. **adjclose is back-adjusted for
splits and dividends, raw `close` is not**.

Same endpoint, `AAPL`, `period1=0` → **200**, `11527` rows, first `1980-12-12`.

### F2 — `range=max` silently downgrades to *monthly* granularity (trap)

`...chart/RELIANCE.NS?range=max&interval=1d` → **200** but only `370` rows spanning
1995-12-31 → 2026-09-11 (~30.3 days apart). `range=10y&interval=1d` correctly returns `2475`
daily rows. **Full daily history requires explicit `period1`/`period2`, never `range=max`.**
This is the single most important operational finding in this document.

### F3 — Yahoo `.BO` (BSE) history is effectively unusable

`...chart/RELIANCE.BO?period1=0&interval=1d` → **200** but only **39 rows**, first
`2026-07-17`. Yahoo's BSE series is truncated. NSE (`.NS`) is the only usable Yahoo Indian
listing. Consequence: canonicalise Indian equities to their **NSE** listing wherever one
exists, and treat BSE-only scrips as a separate, degraded tier.

### F4 — Yahoo's authenticated quote endpoints are closed; the chart endpoint is not

`GET https://query1.finance.yahoo.com/v7/finance/quote?symbols=AAPL` → **401**
`{"code":"Unauthorized","description":"User is unable to access this feature"}`.
`v6/finance/quote` → **404**.
This is the crumb/cookie wall that `yahoo-finance2` fights
([issue #764](https://github.com/gadicc/yahoo-finance2/issues/764),
[issue #741](https://github.com/gadicc/yahoo-finance2/issues/741)). **`chart` needs none of it**,
and `chart.meta.regularMarketPrice` is a perfectly good live quote — which is exactly what
`YahooQuoteProvider` already does (`src/infra/providers.ts` L843). Keep it that way; do not
migrate to `quote`/`quoteSummary`, and do not add `yahoo-finance2` as a dependency for the
sake of quotes.

### F5 — Yahoo search endpoints are alive and keyless, and return exchange-qualified symbols

`GET https://query2.finance.yahoo.com/v1/finance/search?q=relia&quotesCount=8&newsCount=0`
→ **200**, returning `RELIANCE.NS / NSI / NSE`, `RELIANCE.BO / BSE / Bombay`,
`RPOWER.NS`, `RCOM.NS`, `RS (NYSE)`, `EZRA (NASDAQ)`, `RIGD.IL` — each with
`symbol`, `shortname`, `exchange`, `exchDisp`, `quoteType`, `isYahooFinance`.
`q=appl` → `AAPL / NMS / NASDAQ` ranked first, with `sector`/`industry`.
`GET https://query1.finance.yahoo.com/v1/finance/lookup?query=relia&type=equity` → **200**
(a richer variant that also returns live change %).
**Crucially the search result key is the same string the chart endpoint takes** — no mapping
layer is needed between Yahoo search and Yahoo quotes.

### F6 — Yahoo rate limiting is real and IP-scoped

Reported ceiling around **~360 requests/hour per IP**, with `429 Edge: Too Many Requests` on
bursts, and shared cloud egress IPs (Vercel/AWS) hit it sooner because the IP is shared
([yfinance #2128](https://github.com/ranaroussi/yfinance/issues/2128),
[#2422](https://github.com/ranaroussi/yfinance/issues/2422),
[yahoo-finance2 #982](https://github.com/gadicc/yahoo-finance2/issues/982),
[scrapfly 2026 guide](https://scrapfly.io/blog/posts/guide-to-yahoo-finance-api)).
A browser-like User-Agent is required. `YahooQuoteProvider.rateLimit()` currently declares
`20 req / 60s` = 1200/hour — **above the observed ceiling**. This is Defect D-2.

### F7 — Stooq is now behind a JavaScript proof-of-work wall. Unusable server-side.

`GET https://stooq.com/q/d/l/?s=aapl.us&i=d` → **200 but not CSV**: an HTML page with
`<noscript>This site requires JavaScript to verify your browser</noscript>` and an inline
SHA-256 proof-of-work loop POSTing to `/__verify`. Identical for `usdinr`, `reliance.in`,
`infy.in`, `^nsei`, `reliance.bo`. **Stooq is eliminated**; any document or blog post
recommending it as a keyless CSV source is stale.

### F8 — `nseindia.com/api/*` is hard-blocked; `nsearchives.nseindia.com` is wide open

`GET https://www.nseindia.com/` → **403 Access Denied** (Akamai, `Reference #18.ac0e0317`).
Cookie priming cannot help, because the priming request itself is the one that is blocked.
`GET https://www.nseindia.com/api/quote-equity?symbol=RELIANCE` → **403**, cold and primed.
**`NseQuoteProvider` (`src/infra/providers.ts` L921) is dead code in any environment whose
egress IP Akamai dislikes** — this is Defect D-3.

But the archive host is a different story, and it is the best Indian find here:

- `https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv` → **200, 181 KB**,
  header `SYMBOL, NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE`.
  This is the **official NSE equity master with ISIN and listing date** — keyless.
- `https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_20260911_F_0000.csv.zip`
  → **200, 204 KB**, zip containing one CSV, 3647 rows, columns
  `TradDt, ISIN, TckrSymb, SctySrs, FinInstrmNm, OpnPric, HghPric, LwPric, ClsPric, LastPric, PrvsClsgPric, TtlTradgVol, …`.
  Verified row: `2026-09-11,…,INE002A01018,RELIANCE,EQ,…,1267.00,1267.40,1253.00,1257.50,…`.
  Also present: `20250102` → 200, `20240102` → 200; `20230103` → **404** (the UDiFF format
  starts mid-2024).
- The legacy format covers the older years:
  `https://nsearchives.nseindia.com/content/historical/EQUITIES/<YYYY>/<MON>/cd<DD><MON><YYYY>bhav.csv.zip`
  → **200** for 2024-01-02, 2020-01-02, 2015-01-02 and 2010-01-04.

So a **full official Indian daily OHLC archive back to at least 2010 is bulk-downloadable,
keyless, with ISIN on every row** — but it is *raw, unadjusted* (bhavcopy is what traded that
day; a 2:1 split shows as a 50% overnight gap).

### F9 — BSE bhavcopy is equally open, and also carries ISIN

`https://www.bseindia.com/download/BhavCopy/Equity/BhavCopy_BSE_CM_0_0_0_20260911_F_0000.CSV`
→ **200, 857 KB**, same UDiFF column set, verified row
`2026-09-11,…,500002,INE117A01022,ABB,A,…,7285.50,7324.80,7170.00,7269.10,…`.
This is the only working BSE OHLC source found (Yahoo `.BO` is F3; `api.bseindia.com` JSON
redirects and is unstable).

### F10 — Upstox and Zerodha public instrument masters are live and keyless

- `https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz` → **200, 1.94 MB**
- `.../BSE.json.gz` → **200, 770 KB**; decoded, **12 878 `BSE_EQ` rows**, each with
  `instrument_key` (`BSE_EQ|INE002A01018`), `exchange_token` (`500325`), `trading_symbol`,
  `name`, `isin`, `tick_size`, `lot_size`. Verified `INE002A01018` → `RELIANCE`.
- `.../complete.json.gz` → **200, 3.35 MB** (all segments)
- `https://api.kite.trade/instruments` → **200, 8.97 MB** CSV, header
  `instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange`
  — **no ISIN column**, so it is a symbol/token mapping aid, not an identity source.

`src/infra/instrument-catalog.ts` already ingests the Upstox NSE master
(`UPSTOX_NSE_MASTER_URL`) and the Zerodha dump. **The BSE master is the gap** — adding
`BSE.json.gz` gives BSE-only scrips an ISIN-keyed identity.

### F11 — US symbol masters: SEC and Nasdaq Trader, both keyless

- `https://www.sec.gov/files/company_tickers.json` → **200, 798 KB**
  (`{"0":{"cik_str":1045810,"ticker":"NVDA","title":"NVIDIA CORP"}, …}`)
- `https://www.sec.gov/files/company_tickers_exchange.json` → **200, 523 KB**,
  `{"fields":["cik","name","ticker","exchange"],"data":[[1045810,"NVIDIA CORP","NVDA","Nasdaq"],…]}`
  — **only with a contact-declaring User-Agent.** With the repository's current default UA
  `Mozilla/5.0 (compatible; StockMania/1.0)` it returns **403**. This is Defect D-1.
- `https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt` → **200, 348 KB**,
  pipe-delimited `Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares`
- `https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt` → **200, 540 KB**,
  `ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol`
  — this is where NYSE/AMEX/ARCA listings and the ETF flag live.

### F12 — FX: Frankfurter is the winner; exchangerate.host is now key-walled

- `https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR` → **200**,
  `{"amount":1.0,"base":"USD","date":"2026-09-11","rates":{"INR":95.56}}`
- `https://api.frankfurter.dev/v1/1999-01-04..?base=USD&symbols=INR` → **200, 189 KB**,
  series starting **2000-01-13** and running to 2026-09-11. (ECB publishes INR from 2000,
  not 1999 — the API silently clamps to first available.)
- `https://api.frankfurter.dev/v1/currencies` → **200**. Keyless, open-source
  (github.com/lineofflight/frankfurter), **self-hostable via Docker** — which removes the
  single-point-of-failure objection entirely.
- `https://api.exchangerate.host/latest?base=USD` → **200 but**
  `{"success":false,"error":{"code":101,"type":"missing_access_key"}}`. **Eliminated — it is
  now an apilayer key product.**
- `https://open.er-api.com/v6/latest/USD` → **200**, keyless, but **latest-only** (no
  historical series on the free/open tier). Usable as a *today-only* fallback.
- Yahoo `chart/USDINR=X?period1=0&interval=1d` → **200, 5944 daily rows from 2003-12-01**.
  Note this is the *market* rate, whereas Frankfurter/ECB is a reference fixing; they differ
  by tens of paise. Pick one and stay on it for the life of a portfolio.
- `https://www.rbi.org.in/Scripts/ReferenceRateArchive.aspx` → **200**, but it is an ASP.NET
  postback form, not an API. Only worth the scraping cost if an auditor demands RBI rates.
- ECB `eurofxref-hist-90d.xml` is already wired as `EcbFxProvider` (`src/infra/providers.ts`
  L1231) but is **EUR-based and only 90 days** — it cannot serve historical USD/INR.

### F13 — AMFI and MFAPI (Indian mutual funds) remain healthy

`https://portal.amfiindia.com/spages/NAVAll.txt` → **200, 1.52 MB**.
`https://api.mfapi.in/mf/119551` → **200, 133 KB** with full NAV history and scheme metadata.
Both already wired (`AmfiNavProvider` L694, `MfApiNavProvider` L626,
`AmfiNavHistoryProvider` L1449). No change recommended.

### F14 — Keyed free tiers, exact current limits (fallback candidates only)

| Provider | Free limit (verified 2026) | Verdict |
|---|---|---|
| Alpha Vantage | **25 requests/day**, 5/min | Not a data source. Matches the judgement already written into `src/infra/providers.ts` L14-16. |
| Finnhub | **60 requests/minute**; US real-time only, Indian equities are a paid add-on | Viable **US-only** emergency fallback. `FinnhubQuoteProvider` already exists (L474). |
| Twelve Data | **800 calls/day**, stock data **4-hour delayed** on free | Viable low-volume fallback, IN + US; delay is acceptable for EOD but not for "live". |
| Financial Modeling Prep | **250 requests/day** | Marginal. |
| Marketstack | Free tier exists, EOD only, limits not publicly pinned; paid from $9.99/mo | Do not depend on it. |
| Polygon.io (rebranded **Massive**, 30 Oct 2025) | **No free tier**; from $99/mo | **Eliminated by the no-paid-API constraint.** |

Sources: [dev.to 2026 comparison](https://dev.to/nexgendata/best-free-stock-market-apis-and-data-tools-in-2026-a-developers-honest-comparison-1926),
[thenextgennexus 2026 tested list](https://thenextgennexus.com/2026/05/15/10-best-free-stock-market-apis-2026/),
[nb-data 2026](https://www.nb-data.com/p/best-financial-data-apis-in-2026),
[apilayer comparison](https://blog.apilayer.com/marketstack-vs-alpha-vantage-vs-polygon-io-which-stock-market-api-is-actually-worth-paying-for-in-2026/).

### F15 — Zerodha Kite quotes require a paid, per-user authenticated session

`ZerodhaQuoteProvider` (`src/infra/providers.ts` L542) calls `api.kite.trade/quote/ltp`,
which needs a Kite Connect subscription and an access token. It violates the no-paid-API
rule and should be marked opt-in-only, never part of the default chain.

---

## Comparison table

Legend: ● strong · ◐ partial · ○ none/unusable.
Auth: **K** keyless · **UA** needs declared/browser User-Agent · **A** needs API key.

| Source | Auth | 1. Search | 2. Live quote | 3. Full daily history | 4. USD/INR | IN | US | Corp. actions | ToS risk |
|---|---|---|---|---|---|---|---|---|---|
| **Yahoo `v8/finance/chart`** | K+UA | ○ | ● `meta.regularMarketPrice`, ~15 min delayed | ● NSE 1996→, US 1980→ (`period1=0` only, F2) | ● `USDINR=X` 2003→ | ● NSE; ○ BSE (F3) | ● | ● `adjclose` + `events.splits/dividends` | High — undocumented, unstable, 429-prone |
| **Yahoo `v1/finance/search` + `/lookup`** | K+UA | ● exchange-qualified, IN+US in one call | ○ | ○ | ○ | ● | ● | n/a | High |
| Yahoo `v7/quote`, `quoteSummary` | crumb+cookie | ○ | ○ **401** (F4) | ○ | ○ | ○ | ○ | n/a | Eliminated |
| `yahoo-finance2` npm | crumb+cookie | ◐ | ◐ fragile | ◐ | ◐ | ◐ | ◐ | ● | Adds a dependency to work around a wall we can walk past |
| **Stooq CSV** | JS PoW wall | ○ | ○ | ○ | ○ | ○ | ○ | ○ | **Eliminated (F7)** |
| `nseindia.com/api/*` | cookie | ○ | ○ **403** (F8) | ○ | ○ | ○ | ○ | ◐ | **Eliminated (F8)** |
| **`nsearchives` `EQUITY_L.csv`** | K+UA | ● official NSE master: symbol, name, **ISIN**, listing date | ○ | ○ | ○ | ● | ○ | n/a | Low — public archive |
| **NSE bhavcopy zip archive** | K+UA | ○ | ◐ T+0 EOD | ● official OHLC, ≥2010→today, ISIN per row | ○ | ● | ○ | ○ **unadjusted** | Low |
| **BSE bhavcopy CSV** | K+UA | ○ | ◐ T+0 EOD | ● official OHLC, ISIN per row | ○ | ● BSE | ○ | ○ unadjusted | Low |
| **Upstox public masters (NSE/BSE/complete)** | K | ● ISIN-keyed identity, both exchanges | ○ | ○ | ○ | ● | ○ | n/a | Low — published for public use |
| Zerodha `api.kite.trade/instruments` | K | ◐ no ISIN column | ○ | ○ | ○ | ● | ○ | n/a | Low |
| Zerodha Kite quote API | A (paid) | ○ | ● | ◐ | ○ | ● | ○ | ● | **Eliminated — paid (F15)** |
| **SEC `company_tickers_exchange.json`** | UA (contact) | ● CIK+ticker+exchange, authoritative | ○ | ○ | ○ | ○ | ● | n/a | None — public domain |
| **Nasdaq Trader SymDir** | K | ● NASDAQ + NYSE/AMEX/ARCA, ETF flag | ○ | ○ | ○ | ○ | ● | n/a | Low |
| **AMFI `NAVAll.txt`** | K | ● MF schemes | ● daily NAV | ● via `DownloadNAVHistoryReport` | ○ | ● MF only | ○ | n/a | Low |
| **MFAPI.in** | K | ◐ | ● | ● full NAV history | ○ | ● MF only | ○ | n/a | Low — community |
| **Frankfurter (`api.frankfurter.dev`)** | K | ○ | ○ | ○ | ● ECB, 2000-01-13→today, **self-hostable** | ● | ● | n/a | None — open source |
| `exchangerate.host` | A | ○ | ○ | ○ | ○ | ○ | ○ | n/a | **Eliminated (F12)** |
| `open.er-api.com` | K | ○ | ○ | ○ | ◐ latest only | ● | ● | n/a | Low |
| ECB `eurofxref-hist-90d.xml` | K | ○ | ○ | ○ | ◐ EUR-base, 90d only | ◐ | ◐ | n/a | None |
| RBI Reference Rate archive | K+UA | ○ | ○ | ○ | ◐ ASPX form, scrape-only | ● | ○ | n/a | Medium |
| Alpha Vantage (free) | A | ◐ | ◐ | ◐ | ◐ | ◐ | ● | ● | 25/day — not a source |
| Finnhub (free) | A | ◐ | ● 60/min | ○ (US history is paid) | ○ | ○ paid | ● | ● | US-only fallback |
| Twelve Data (free) | A | ● | ◐ 4 h delayed | ◐ 800 calls/day | ● | ● | ● | ● | Low-volume fallback |
| FMP (free) | A | ◐ | ◐ | ◐ | ◐ | ◐ | ● | ● | 250/day |
| Marketstack (free) | A | ○ | ○ EOD only | ◐ | ○ | ◐ | ● | ◐ | Do not depend |
| Polygon.io / Massive | A (paid) | — | — | — | — | — | — | — | **Eliminated — no free tier** |
| OpenBB / `nsepython` / `jugaad-data` | K | — | — | — | — | — | — | — | Python-only; wrap the same upstreams we already call. Not worth a Python runtime in a Next.js app. |

---

## Recommended stack

### Indian equities (NSE/BSE)

| Need | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| Search | **Local catalogue** built from NSE `EQUITY_L.csv` + Upstox `NSE.json.gz` + Upstox `BSE.json.gz`, refreshed daily, keyed by ISIN | Yahoo `v1/finance/search` filtered to `.NS`/`.BO` | — |
| Live quote | **Yahoo `chart?range=1d&interval=1d` → `meta.regularMarketPrice`** | Today's NSE/BSE bhavcopy (T+0 EOD) | Twelve Data (4 h delayed, 800/day) |
| Full history | **Yahoo `chart?period1=0&interval=1d&events=div,split` with `adjclose`** (split/dividend adjusted, NSE from 1996) | Self-hosted NSE+BSE bhavcopy archive (official, unadjusted, ≥2010) + apply `events.splits` ourselves | — |

Rationale: Yahoo is the only free source that gives *adjusted* Indian history, and corporate
actions are precisely where Indian data goes wrong. The bhavcopy archive is the insurance
policy: it is official, ISIN-keyed and bulk-downloadable, so if Yahoo goes dark we still own
the series. **Canonicalise to the `.NS` listing** — F3 makes `.BO` history worthless on Yahoo,
so a BSE-only scrip is a knowingly degraded tier served from bhavcopy.

### US equities (NASDAQ/NYSE)

| Need | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| Search | **Local catalogue** from SEC `company_tickers_exchange.json` + Nasdaq Trader `nasdaqlisted.txt`/`otherlisted.txt` | Yahoo `v1/finance/search` | — |
| Live quote | **Yahoo `chart` `meta.regularMarketPrice`** | **Finnhub free, 60 req/min** (already implemented, L474) | Twelve Data |
| Full history | **Yahoo `chart?period1=0&interval=1d` `adjclose`** (AAPL back to 1980-12-12) | Twelve Data 800/day | — |

### FX (USD/INR)

| Need | Primary | Fallback 1 | Fallback 2 |
|---|---|---|---|
| Daily + historical | **Frankfurter `api.frankfurter.dev/v1/<start>..<end>?base=USD&symbols=INR`** (ECB, 2000→today) | **Self-hosted Frankfurter** (Docker) — removes the SPOF | Yahoo `USDINR=X` chart (2003→, market rate) |
| Today | Frankfurter `/v1/latest` | `open.er-api.com/v6/latest/USD` | — |

Frankfurter replaces `EcbFxProvider` as primary: same ECB data, but USD-based and with real
history instead of 90 days. Keep `EcbFxProvider` as a third line. **Do not mix Frankfurter and
Yahoo rates within one portfolio's history** — they are different rate types and the seam
would show up as a phantom gain.

### The single architectural recommendation

**Self-host the history; fetch only the delta live.** Backfill each instrument's full
`adjclose` series once from Yahoo `chart?period1=0`, store it, and thereafter have the cron in
`app/api/cron/market-data/route.ts` fetch only `range=5d`. This turns Yahoo from a dependency
into a seed, and collapses request volume far under the ~360/hour IP ceiling (F6). For Indian
instruments, the daily bhavcopy zip is *one request for all 3647 scrips* — strictly better
than one Yahoo call per holding.

---

## Identifier / mapping strategy: "if it cannot be priced, it cannot be added"

Make it structural, not a validation rule that someone can forget.

1. **Canonical identity is the ISIN.** Every Indian row from `EQUITY_L.csv`, the Upstox NSE/BSE
   masters and both bhavcopies carries one (F8, F9, F10). US rows carry CIK + ticker + exchange
   (F11). `src/domain/instrument-catalog.ts` already has `verifiedIsin`; that stays the key.
2. **The catalogue row is not complete until it holds a `quoteKey`.** A row must persist the
   exact provider-resolvable string — `RELIANCE.NS`, `AAPL`, `USDINR=X` — alongside the ISIN.
   A row with `quoteKey === null` is **excluded from the search index**, so the user never sees
   it. This is the whole gate: the search source and the quote source are reconciled at
   *ingest* time, offline, not at add time under a user's cursor.
3. **Reconciliation at ingest.** For each master row, derive the candidate quoteKey
   (`<TckrSymb>.NS`, then `.BO`; US ticker as-is with `.` → `-`), probe
   `chart?range=5d&interval=1d`, and accept the row only if the response has ≥1 timestamp
   **and** `meta.currency` matches the expected currency (INR/USD) **and** `meta.instrumentType`
   is `EQUITY`/`ETF`. `YahooQuoteProvider` already performs the currency check at
   `src/infra/providers.ts` L871-885 — hoist that same check into ingest.
4. **`firstTradeDate` is recorded at the same moment.** `meta.firstTradeDate` (F1) is the
   inception date the charting feature needs, and it costs nothing extra.
5. **Selection carries the ID, never the text.** `add-instrument-form.tsx` already posts
   `catalogInstrumentId` + `listingId` with a `selectionConfirmed` literal
   (`catalog-actions.ts` L48-52). Server-side, re-resolve that ID against the catalogue and
   reject if the row's `quoteKey` is null. Free-text `MANUAL` mode must be routed to
   `ManualProvider` (L1174) and **flagged in the UI as not live-priced** — never silently
   mixed with priced holdings.
6. **A quoteKey that stops resolving degrades, it does not delete.** Mark the row
   `quoteStale`, stop offering it in search, keep existing holdings valued at last known close
   with a visible staleness badge. Never retro-delete a user's instrument.

Net effect: the search index is by construction a subset of what the quote provider can price.

---

## Decisions and constraints

- **D1** — Target `src/infra/`, not the v1 mongoose path. Reason: the App Router surface on
  this branch already imports `@/infra/container` and `@/domain/instrument-catalog`; there is
  no market-data code in `app/`/`lib/` at all.
- **D2** — Yahoo `v8/chart` only. Never `v7/quote`, `v6/quote` or `quoteSummary` (F4); do not
  add `yahoo-finance2` to `package.json` to chase crumbs we do not need.
- **D3** — Never `range=max`. Always `period1`/`period2` for history (F2).
- **D4** — Canonicalise Indian equities to `.NS`; BSE-only is a degraded tier served from
  bhavcopy (F3).
- **D5** — Stooq, `nseindia.com/api/*`, `exchangerate.host` and Polygon are eliminated with
  evidence (F7, F8, F12, F14). Remove or gate them rather than leaving hopeful code.
- **D6** — Frankfurter becomes the FX primary and is self-hosted when the SPOF matters (F12).
- **D7** — Keyed free tiers are fallbacks only and must be per-provider opt-in via env:
  Finnhub 60/min (US), Twelve Data 800/day 4 h-delayed (IN+US). Alpha Vantage at 25/day is
  not a data source (F14) — consistent with the comment already at `src/infra/providers.ts` L14-16.
- **D8** — Self-host history, fetch deltas. One bhavcopy zip beats N Yahoo calls.

## Defects found in existing code (for the Planner, not fixed here)

- **D-1** — `FetchHttpClient`'s default UA `Mozilla/5.0 (compatible; StockMania/1.0)`
  (`src/infra/providers.ts` L79) gets **403** from sec.gov.
  `SEC_COMPANY_TICKERS_URL` in `src/infra/instrument-catalog.ts` L15 therefore fails.
  A contact-declaring UA returns 200 (F11).
- **D-2** — `YahooQuoteProvider.rateLimit()` = `20 req/60 s` (1200/hour) exceeds Yahoo's
  observed ~360/hour IP ceiling (F6).
- **D-3** — `NseQuoteProvider` (L921) targets a host that returns 403 to both its priming
  request and its API call (F8). Its `supportsCorporateActions: true` is also the only such
  claim in the chain, so the registry may be preferring a dead provider.
- **D-4** — `ZerodhaQuoteProvider` (L542) requires a paid Kite Connect subscription,
  contradicting the file's own keyless-by-design docstring (F15).
- **D-5** — `EcbFxProvider` (L1231) reads `eurofxref-hist-90d.xml`: EUR-based and 90 days, so
  it cannot serve the historical USD/INR that XIRR over a multi-year portfolio needs (F12).
- **D-6** — `src/infra/instrument-catalog.ts` ingests the Upstox **NSE** master only; the BSE
  master (12 878 ISIN-keyed rows, F10) is missing, so BSE-only scrips have no identity source.

## Assumptions (NOT verified — for the Experiment Agent)

- **A1** — Probes ran from a single Indian residential-grade IP. Yahoo's and NSE's behaviour
  **from Vercel's egress IPs is unknown** and is the highest-risk unknown in this document.
- **A2** — NSE legacy bhavcopy was confirmed at 2010, 2015, 2020, 2024. Coverage before 2010,
  and the exact UDiFF cutover date, were not mapped.
- **A3** — Yahoo's `adjclose` was confirmed to reflect three RELIANCE splits. Whether it
  handles Indian **bonus issues and demergers** (e.g. the Jio Financial demerger) correctly was
  not checked, and demergers are where free adjusted series usually break.
- **A4** — Corporate-action correctness of Yahoo `adjclose` was not cross-checked against
  bhavcopy for any instrument.
- **A5** — Finnhub's and Twelve Data's free tiers were taken from 2026 secondary sources, not
  from a signed-up key.
- **A6** — `EQUITY_L.csv` `DATE OF LISTING` vs Yahoo `meta.firstTradeDate` agreement is
  unverified; they will disagree for pre-1996 listings.
- **A7** — Yahoo's `~360 req/hour` figure is community-reported, not documented by Yahoo.

## Step-by-step plan (for the receiving agent, not executed here)

- [ ] 1. Run the hypothesis suite below — Owner: Experiment Agent — Files: scratchpad only — Verify: recorded HTTP codes + row counts
- [ ] 2. Decide adjusted-history source from H3/H4 — Owner: Experiment Agent — Verify: written keep/revise/discard
- [ ] 3. Plan provider changes per D1-D8 and defects D-1..D-6 — Owner: Planner/Implementer — Files: `src/infra/providers.ts`, `src/infra/instrument-catalog.ts`
- [ ] 4. Independent QA — Owner: Testing/QA Agent

## Falsifiable hypotheses for the Experiment Agent

Success threshold in brackets. All probes server-side, no browser.

- **H1 (deployment risk — run first).** From a **Vercel serverless function in production**,
  `GET query1.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?period1=0&period2=<now>&interval=1d`
  with a browser UA returns 200 with >7000 rows. [PASS = 200 and >7000 rows on 10 of 10 calls
  spaced 30 s apart.] *If this fails, the entire primary stack must be rebuilt on bhavcopy.*
- **H2.** From that same Vercel function, `nsearchives.nseindia.com/content/equities/EQUITY_L.csv`
  and a bhavcopy zip both return 200. [PASS = 200 on both, 10/10.]
- **H3 (corporate actions — the one that decides the design).** For an instrument with a
  **bonus issue** and one with a **demerger** (e.g. `RELIANCE.NS` around the Jio Financial
  demerger, and a 1:1 bonus such as `INFY.NS`), Yahoo `adjclose` produces a continuous series
  with **no unexplained overnight gap >15%** that is not matched by an entry in
  `events.splits`/`events.dividends`. [PASS = every >15% single-day move is explained by a
  recorded event.]
- **H4.** For the same instruments, the raw NSE bhavcopy series reconstructed with
  `events.splits` reproduces Yahoo's `adjclose` to within **0.5%** on 99% of days over 10
  years. [PASS = ≤1% of days outside 0.5%.] *H3+H4 together decide whether the bhavcopy
  archive is a true fallback or merely a raw-data archive.*
- **H5.** NSE legacy bhavcopy is available continuously from **2000-01-03** to the UDiFF
  cutover. [PASS = <2% missing trading days, with the earliest available date recorded.]
- **H6.** Sustained Yahoo `chart` throughput from one IP before the first `429`. [Record the
  number; PASS = ≥300 requests/hour sustained for 3 hours.] *Sets `YahooQuoteProvider.rateLimit()`.*
- **H7.** Of the ~2100 `SctySrs=EQ` rows in one NSE bhavcopy, ≥95% resolve to a Yahoo
  `<TckrSymb>.NS` chart with ≥1 timestamp and `meta.currency === "INR"`. [PASS = ≥95%; record
  the unresolvable list — those are the rows the search index must exclude.]
- **H8.** Of the top 3000 SEC/Nasdaq-Trader US tickers, ≥98% resolve to a Yahoo chart with
  `meta.currency === "USD"` after `.` → `-` normalisation. [PASS = ≥98%.]
- **H9.** `api.frankfurter.dev/v1/2000-01-01..?base=USD&symbols=INR` returns every ECB
  business day with no gap >4 consecutive calendar days outside known holidays. [PASS = no
  unexplained gap.] And the Docker self-host serves the identical series. [PASS = byte-identical
  for a 1-year window.]
- **H10.** `sec.gov/files/company_tickers_exchange.json` returns 200 with a contact-declaring
  UA and 403 with `Mozilla/5.0 (compatible; StockMania/1.0)`. [PASS = confirms Defect D-1;
  already observed once, needs one confirming re-run.]
- **H11.** `www.nseindia.com/` returns 403 from a Vercel egress IP too. [PASS = 403 confirms
  D-3 is environmental-independent and `NseQuoteProvider` should be retired.]
- **H12.** Upstox `BSE.json.gz` ISINs join to the BSE bhavcopy `ISIN` column for ≥95% of
  actively traded BSE scrips. [PASS = ≥95%.] *Decides whether the BSE-only tier is viable.*

## Handoffs

### Research Agent -> Experiment Agent

See the baton at the end of this document.

## QA record

Status: NOT_RUN
Evidence:
- Research lane only; no production code changed. `git status` at start: clean on `redesign/v2`.
- All 40+ endpoint probes in "Verified facts" were executed live on 2026-09-13 via `curl`.
Residual risks:
- A1 (Vercel egress behaviour) and A3 (bonus/demerger adjustment) are unresolved and are
  exactly the two that could invalidate the primary recommendation. H1 and H3 exist to close them.

---

## Baton: Research Agent -> Experiment Agent

- **Goal:** Decide, with measurements, whether the Yahoo-primary / bhavcopy-fallback /
  Frankfurter-FX stack recommended above survives contact with the real deployment
  environment and with Indian corporate actions.
- **Completed:** Live probes of 25+ candidate sources on 2026-09-13. Confirmed alive and
  keyless: Yahoo `v8/chart` (+`search`, `+lookup`), NSE `EQUITY_L.csv`, NSE and BSE bhavcopy
  archives, Upstox NSE/BSE/complete masters, Zerodha instrument dump, SEC company tickers,
  Nasdaq Trader SymDir, AMFI, MFAPI, Frankfurter, `open.er-api.com`.
  Confirmed **dead or paywalled**: Stooq (JS proof-of-work wall), `nseindia.com/api/*` (403),
  Yahoo `v7`/`v6` quote (401/404), `exchangerate.host` (key required), Polygon/Massive (no
  free tier), Alpha Vantage (25/day). Six defects logged against existing `src/infra` code.
- **Decisions:** D1-D8 in "Decisions and constraints". The two that most shape the spike:
  never use `range=max` (it silently returns monthly data), and canonicalise Indian equities
  to `.NS` because Yahoo's `.BO` history is truncated to ~39 rows.
- **Inputs:** This file. Repository code to read but not change:
  `src/infra/providers.ts` (L474 Finnhub, L542 Zerodha, L812 Yahoo, L921 NSE, L1231 ECB,
  L1449 AMFI history), `src/infra/instrument-catalog.ts`, `src/domain/pricing.ts`,
  `src/domain/instrument-catalog.ts`, `app/api/cron/market-data/route.ts`.
- **Changed files:** `_architecture/requirements/market-data-sources-research.md` (new). No
  other file touched.
- **Contract/output:** The recommended stack table, the ISIN-anchored
  `quoteKey`-required-at-ingest gate, and hypotheses H1-H12 with numeric pass thresholds.
- **Verification:** `curl` probes, statuses and row counts recorded inline in "Verified facts"
  (F1-F15). No repository command was run; no build, lint or test was executed because this
  lane changed no code.
- **Open risks:** A1 — every probe came from one Indian IP; Yahoo and NSE behaviour from
  Vercel egress is unmeasured. A3 — `adjclose` correctness across Indian bonus issues and
  demergers is unverified, and that is where free adjusted series typically fail.
- **Next action:** Run **H1 first** (Yahoo `chart` from a deployed Vercel function). If H1
  fails, stop and escalate: the primary stack must be re-planned on the bhavcopy archive
  before any implementation begins. If H1 passes, run H3, then H6, then the rest.
- **Do not revisit:** Stooq, `nseindia.com/api/*`, Yahoo `v7`/`v6` quote,
  `exchangerate.host`, Polygon/Massive, Alpha Vantage as a primary, and Zerodha Kite quotes.
  Each was probed and eliminated with a recorded status code or a published free-tier limit.
