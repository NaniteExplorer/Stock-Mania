# Live equities, mutual funds and fundamentals data plan

Audience: Stock-Mania owner and future implementation agents  
Date: 2026-09-07  
Geography: India-first, Zerodha preferred  
Mode: Research then experiment; no production code changed

## Direct answer

Zerodha can support exact stock selection, authenticated current prices, historical candles, WebSocket streaming, holdings, positions, margins, orders and mutual-fund holdings/instruments through Kite Connect. It is the right primary broker integration if you want Zerodha execution later. It is not a free source of live or historical market data: Zerodha's Personal API plan is free for order/account/portfolio workflows, while live WebSocket data and historical candles require the paid Connect plan at INR 500 per app per month according to Zerodha Support.

For mutual funds, the strongest free path is AMFI as the official daily NAV source, with MFAPI used only as a convenient JSON/search layer. The experiment resolved Parag Parikh Flexi Cap Fund Direct Plan Growth from AMFI and MFAPI with the same 04-Sep-2026 valuation date.

For stock fundamentals such as P/E, P/B, ROE, ROCE, market cap, sector comparison and statements, there is no single reliable free Zerodha endpoint. NSE/BSE/SEBI filings are official but require a parser and are not live ratios. NSE website data is not suitable for automated scraping or app-backed simulation. Upstox now documents fundamentals by ISIN and free market-data APIs, but that is a second broker/data account, not Zerodha.

## Researched source families

### Zerodha/Kite

Primary sources checked:

- Kite Connect introduction: https://kite.trade/docs/connect/v3/
- Authentication/user/token fields: https://kite.trade/docs/connect/v3/user/
- Market quotes and instruments: https://kite.trade/docs/connect/v3/market-quotes/
- WebSocket streaming: https://kite.trade/docs/connect/v3/websocket/
- Historical candles: https://kite.trade/docs/connect/v3/historical/
- Mutual funds: https://kite.trade/docs/connect/v3/mutual-funds/
- Exceptions/rate limits: https://kite.trade/docs/connect/v3/exceptions/
- Current pricing support article: https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/what-are-the-charges-for-kite-apis

Findings:

- `/instruments` and `/instruments/:exchange` return gzipped CSV instrument masters. The dump is generated daily and `last_price` is not real-time. The docs recommend requesting it once daily around 08:30 and storing exchange plus tradingsymbol as identity rather than numeric token because tokens can be reused.
- `/quote`, `/quote/ohlc`, and `/quote/ltp` return authenticated snapshots. Full quote supports up to 500 instruments; OHLC and LTP support up to 1000 instruments per request in the current market-quotes page.
- WebSocket streaming supports live quotes; the current docs state up to 3000 instruments per connection and up to 3 WebSocket connections per API key.
- Historical candles support intervals from minute to day and OI for derivatives. Expired futures/options require cached old instrument tokens because the live instrument master contains live contracts.
- Access tokens expire at 6 AM the next day, so a fully unattended long-running trading/data system needs a daily user-login expectation unless an approved platform arrangement applies.
- Rate limits are material for design: quote 1 request/second, historical 3 requests/second, order placement 10 requests/second, all other endpoints 10 requests/second; Zerodha also documents 400 orders/minute and 5000 orders/day.
- Mutual-fund APIs expose recent MF orders, SIPs, DEMAT MF holdings, and the Coin mutual-fund instrument master. Fund `tradingsymbol` is the ISIN, and the instrument master includes `last_price` and `last_price_date`.

### Mutual funds

Primary sources checked:

- AMFI latest NAV downloads: https://www.amfiindia.com/net-asset-value/nav-download
- AMFI latest NAV file: https://www.amfiindia.com/spages/NAVAll.txt
- MFAPI docs: https://www.mfapi.in/docs/

Findings:

- AMFI is the authority for daily NAV. The old-format NAV download is available only until 30-Sep-2026, so implementation must parse the current 8-column shape and be ready for the post-sunset download format.
- The experiment fetched AMFI through the public URL and followed redirect to `portal.amfiindia.com/spages/NAVAll.txt`. It saw 18,022 lines and matched scheme code `122639`, ISIN `INF879O01027`, NAV `90.5289`, date `04-Sep-2026`.
- MFAPI provides `/mf/search`, `/mf/{scheme_code}` and `/mf/{scheme_code}/latest` without authentication. It resolved the same scheme and date. It should be cached and cross-checked because it is not the official source.

### Equities and fundamentals

Primary sources checked:

- NSE Terms of Use: https://www.nseindia.com/static/nse-terms-of-use
- NSE real-time data subscription: https://www.nseindia.com/static/market-data/real-time-data-subscription
- NSE all reports / daily archives: https://www.nseindia.com/all-reports
- SEBI corporate filings curation: https://www.sebi.gov.in/curation/corporate_filings.html
- NSE financial results page: https://www.nseindia.com/companies-listing/corporate-filings-financial-results
- Upstox instruments: https://upstox.com/developer/api-documentation/instruments/
- Upstox API overview: https://upstox.com/developer/api-documentation/api-overview
- Upstox key ratios: https://upstox.com/developer/api-documentation/get-key-ratios/

Findings:

- NSE has paid real-time data products. Its website terms restrict copying, automated collection, caching, redistribution, reverse engineering and use of website data for gaming, virtual trading or simulation. That rules out NSE website APIs as a professional app backend for free live prices.
- NSE/BSE/SEBI provide official filings and downloads, including financial results and XBRL-oriented workflows. These can power quarterly fundamentals after parsing and validation, but they are not a quick live P/E endpoint.
- P/E is derived: latest price divided by trailing or forward earnings per share. To show a trustworthy P/E, the app must carry the price source, earnings period, consolidated/standalone basis, calculation date and whether it came from a provider or our parser.
- Upstox currently documents free trading and data APIs, an analytics token, public instrument files, and a fundamentals API that returns P/E, P/B, ROA, ROE, ROCE and EV/EBITDA by ISIN. This is attractive as a fallback or parallel provider, but it is outside the Zerodha-preferred path and must be treated as another authenticated provider.

## Experiment summary

Commands:

```powershell
node _architecture/live-investment-data/provider-spike.mjs
node _architecture/live-investment-data/provider-spike-checks.mjs
```

Results:

- Spike command: PASS, wrote `D:/WorkStation/Artifacts/stock-mania-live-data-20260907/data/provider-spike-result.json`.
- Checks: PASS, 14 assertions.
- Zerodha unauthenticated `quote/ltp` probe: HTTP 400, state `UNAVAILABLE`; no response body persisted.
- Zerodha credentialed quote: skipped because no local credentials were provided.
- Zerodha documented fixture: normalized as `LIVE` only when authenticated and entitled.
- AMFI: `NAV_DAILY`, exact Parag Parikh match.
- MFAPI: `NAV_DAILY`, same scheme code/date.
- Upstox public instrument master: 76,431 rows seen; `INFY` resolved with ISIN; loose search ambiguity observed.

## Proposed product behavior

The investment page should get a `Live Data Center` branch rather than exposing every data concern on the main investment overview. The normal investor flow remains quiet:

1. Search stock or mutual fund.
2. See candidates with source, exchange, ISIN/scheme code, asset class and freshness.
3. Confirm the exact instrument.
4. If entering a manual investment, record fill price, quantity, date, account, platform and charges. The app may prefill a reference price, but the user's trade price or broker fill remains the transaction truth.
5. If connected to Zerodha, import holdings/fills and refresh authenticated current prices where entitlement exists.
6. Show stale/unavailable states explicitly; never show blank or zero valuation.

## Proposed data architecture

Provider registry:

- `ZerodhaKiteProvider`: authenticated broker source for instruments, quotes, WebSocket, candles, holdings, positions, margins and future order workflows. Requires daily token and paid data entitlement for live/historical market data.
- `AmfiNavProvider`: official daily mutual-fund NAV source.
- `MfapiProvider`: convenience search/history cache, never authority unless AMFI is unavailable and the UI marks source/freshness.
- `ExchangeEodProvider`: official daily bhavcopy/download-backed prices for end-of-day tracking, terms-reviewed and private-cache only.
- `FundamentalsProvider`: separate interface for financial statements, ratios, shareholding, corporate actions and sector benchmarks.
- `ManualProvider`: user-entered price or valuation with provenance.

State model:

- `LIVE`: authenticated current market data with quote timestamp and entitlement.
- `EOD`: exchange/day close or bhavcopy data with market date.
- `NAV_DAILY`: daily mutual-fund NAV with valuation date.
- `STALE`: available but past class-specific threshold.
- `UNAVAILABLE`: auth missing, entitlement missing, provider error, no quote or licensing block.

Search model:

- Canonical instrument identity uses ISIN/MIC/exchange/tradingsymbol/scheme code.
- Provider ids such as Zerodha `instrument_token` and Upstox `instrument_key` are mappings with dates and source, never canonical identity.
- Search returns ranked candidates; confirmation is required when name tokens match more than one security.

## Implementation plan after approval

1. Add data-provider capability metadata and state types in the domain layer.
2. Extend the instrument catalogue with provider entitlement, source freshness and provider-mapping provenance.
3. Add AMFI current-format parser and MFAPI convenience adapter behind conformance checks.
4. Add Zerodha provider stubs for instrument master, holdings, quotes and token lifecycle, gated by env/connection state; no order placement.
5. Add `Live Data Center` UI branch with provider health, entitlement, stale/unavailable states and search-confirm-add flow.
6. Add fundamentals data model and UI placeholders showing calculated-vs-provider ratios with basis and date.
7. Add scheduled refresh design but keep it disabled until user supplies provider choices and credentials.
8. Send implementation to independent QA with no live trading and no secret logging.

## Approval questions for the next step

Ask these only after the user approves this plan:

1. Will you pay for Zerodha Connect data at INR 500/month, or should v1 use only daily/EOD free tracking?
2. Are you willing to connect a second broker/data account such as Upstox for free market data/fundamentals, or should we stay Zerodha-only?
3. Should mutual-fund history use AMFI-only official data, or AMFI plus MFAPI fallback for speed?
4. Which fundamentals are required first: P/E/P/B/market cap only, or statements/shareholding/corporate actions too?
5. Should price refresh run manually from the UI first, or as a local scheduled job?

## Relay batons

### Coordinator -> Research Agent

- Goal: verify Zerodha, official/free India price/NAV/fundamentals sources.
- Completed: primary-source evidence recorded in this report and claim ledger.
- Decisions: no production edits; broker data must be entitlement-labelled.
- Inputs: `_architecture/40-MARKET-DATA.md`, Kite docs, Zerodha Support, AMFI, MFAPI, NSE, SEBI, Upstox docs.
- Changed files: `_architecture/live-investment-data/report-source.md`, `_architecture/live-investment-data/claim-ledger.md`.
- Contract/output: provider matrix and implementation constraints.
- Verification: source URLs checked 2026-09-07.
- Open risks: pricing/licensing can change; Upstox is outside preferred broker.
- Next action: experiment agent runs bounded public probes.
- Do not revisit: NSE website scraping is not an acceptable app backend.

### Research Agent -> Experiment Agent

- Goal: prove search-to-identity-to-price/NAV state model without production code.
- Completed: experiment hypotheses written before probe.
- Decisions: persist compact measurements only; no raw large market files or secrets.
- Inputs: `_architecture/live-investment-data/experiment.md`.
- Changed files: `_architecture/live-investment-data/provider-spike.mjs`, `_architecture/live-investment-data/provider-spike-checks.mjs`.
- Contract/output: JSON measurement and pass/fail checks.
- Verification: `node _architecture/live-investment-data/provider-spike-checks.mjs` PASS, 14 assertions.
- Open risks: credentialed Zerodha path not executed.
- Next action: coordinator creates approval artifact.
- Do not revisit: no live broker order or credential probe.

## Limitations

The experiment did not authenticate to Zerodha, so it proves the unauthenticated path is unavailable and that the documented shape is implementable, not that the user's account is entitled. Browser visual QA was not run for the artifact. Legal interpretation is implementation guidance, not legal advice; before public redistribution or multi-user hosting, data-source terms need review.
