# Investment enterprise-readiness: zero-subscription data ceiling

Date observed: 2026-09-19  
Scope: research for a private investment tracker; no production implementation or legal opinion.  
Meaning of "zero subscription cost": the application may require the investor to hold and authenticate an existing broker/platform account, but it does not buy a market-data subscription. Brokerage, demat, transaction, tax, storage, insurance and redemption charges are outside that phrase.

## Executive finding

A trustworthy zero-subscription tier is feasible as an **end-of-day/NAV/manual-ledger portfolio tracker**. It is not credible as a generally available, multi-user, real-time Indian or US market-data product. Enterprise readiness must come from exact accounting, immutable transaction history, reconciliation, authorization, provider health, provenance and honest stale/unavailable states. It cannot be inferred from a free quote endpoint.

The strongest free official source is AMFI for Indian mutual-fund NAVs. Indian equity quotes can be available through an authenticated broker account, but this is user entitlement, not a redistributable public feed. Physical gold can use a daily benchmark as an estimate only; digital gold requires provider statements and explicit counterparty/custody risk; SGBs need series-specific coupon/redemption handling and cannot be valued reliably from a generic gold spot price. Optional US equities should remain manual/EOD at zero cost unless a provider's written licence covers the intended deployment.

## Verified facts

### Capability and constraint matrix

| Asset | Zero-cost availability and freshness | Authentication | Redistribution/licensing | Product and regulatory limits | Tracking conclusion |
|---|---|---|---|---|---|
| Indian listed equities | Zerodha's free Personal API includes portfolio management but explicitly excludes live and historical market data. Its Connect tier includes real-time WebSockets and historical candles for INR 500/month. Upstox documents authenticated real-time WebSocket market data and standard historical/holdings APIs. | Zerodha requires an API app and broker login/token. Upstox uses OAuth 2.0 authorization code flow; market feeds require a bearer token and one-use authorized WebSocket URL. | NSE's policy covers real-time, delayed, EOD, historical, identifiers and corporate data; redistribution is allowed only as agreed in the relevant agreement. Zerodha says displaying or redistributing Kite data externally violates exchange vending policies. | Broker access is account- and token-dependent. A broker API is not an anonymous public SLA, and enhanced Upstox feed capacity is attached to its Plus plan. | Support manual trades/import plus EOD or last-known quotes. Call broker quotes `account-connected`, not `free public data`; never promise general redistribution or uninterrupted real time. |
| Indian mutual funds | AMFI provides official NAV download/history. AMFI explains that scheme NAVs are declared after market close and published daily, so intraday freshness is not the correct expectation. | Public website/download access; no API key is described on the cited AMFI pages. Investor holdings/CAS access is separate and requires investor-specific registration or mail-back flows through CAMS, KFintech or MFCentral. | The public pages establish availability, not a general API SLA or republication licence. No unrestricted redistribution grant was found in the reviewed official pages. | NAV is scheme-level valuation, not an executable intraday quote. Scheme code, ISIN, plan and growth/dividend option must not be flattened into a name match. | Best zero-cost automated class: daily official NAV with scheme identity, NAV date and source. Keep holdings/import separately authenticated and user-owned. |
| Digital gold | No regulator-operated price or holdings API was identified. Provider statements/manual entries are the defensible zero-cost baseline; an IBJA benchmark may be shown only as a separate estimate. | Provider-specific login/export or manual evidence; no common regulated aggregation interface was identified. | Provider contracts govern account data. IBJA publicly displays benchmark rates but its page does not provide an API SLA or an unrestricted redistribution licence. | SEBI's 2025 caution says platform "Digital Gold/E-Gold" is neither a security nor a regulated commodity derivative, lies outside SEBI's purview, carries counterparty/operational risk, and lacks securities-market investor protections. This differs from regulated Gold ETFs, exchange commodity derivatives and EGRs. | Create a dedicated `Digital gold` subtype with provider, grams, purity, custody claim, invoice/statement date, buy/sell spread and redemption terms. Never silently merge it with regulated gold securities or physical inventory. |
| Physical gold | IBJA publishes Indian benchmark AM/PM rates by purity; rates exclude 3% GST and making charges and are not published on Sundays/holidays. It is a benchmark, not the owner's realizable sale price. | Public webpage; no authentication stated. | The reviewed page states publication terms but no API/SLA or unrestricted reuse grant. Treat automated extraction and redistribution as unlicensed until written permission exists. | Value depends on purity, net weight, hallmark/evidence, making charges, stones, dealer spread and resale deductions. A benchmark cannot prove existence, title, custody or realizable proceeds. | Manual inventory is primary. Show benchmark valuation as an estimate with purity and deduction assumptions; preserve invoice/appraisal evidence and a manual valuation override. |
| Sovereign Gold Bonds | RBI's official SGB portal publishes outstanding-bond data, notifications, premature-redemption calendars and series-specific redemption prices. On the page observed, the latest issuance notification listed was 2023-24, while later entries concern redemption. | Public RBI information; holdings still require the investor's bank/broker/depository evidence. | Public official notices can support reference data; exchange-traded prices remain exchange market data subject to venue/vendor terms. | SGB is an interest-bearing government security with series, issue date, coupon, maturity and conditional premature-redemption windows. RBI says premature redemption is permitted after five years under the scheme procedure. Absence of a newer issue on the portal is not proof that the scheme has legally ended. | Dedicated SGB model/UI: series and ISIN, grams, issue price/date, 2.5% coupon terms where applicable, interest cashflows, maturity/redemption eligibility and valuation basis (`market`, `RBI redemption`, or `manual`). |
| US equities (optional) | SEC EDGAR APIs are keyless and update filings throughout the day, but provide submissions/XBRL fundamentals and ticker/exchange metadata, not market prices. Alpha Vantage currently offers 25 free requests/day for most datasets; it says real-time and 15-minute-delayed US data are premium-only. | SEC data APIs need no key but require compliant automated access. Alpha Vantage requires a free API key. | Alpha Vantage's standard grant is personal, non-commercial and non-sublicensable; use by an entity or provision to other users is commercial unless separately agreed. US exchange quote entitlements cannot be inferred from SEC data access. | SEC identifiers/fundamentals do not solve price valuation. Twenty-five daily calls is too small for an enterprise portfolio service without batching, caching or a licence. FX provenance is also required for INR reporting. | Keep optional USD holdings and manual/EOD prices. Use SEC only for identity/fundamentals. Enable a quote provider only when its entitlement and deployment licence are recorded. |

### Primary sources checked

- NSE, [Data Sharing & Usage Policy](https://www.nseindia.com/static/market-data/nse-data-policy): market data includes identifiers and real-time, delayed, EOD, historical and corporate data; redistribution depends on the relevant agreement.
- Zerodha, [API plans](https://zerodha.com/products/api), [charges and plan inclusions](https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/what-are-the-charges-for-kite-apis), and [Kite API FAQ](https://support.zerodha.com/category/trading-and-markets/general-kite/kite-api/articles/kite-connect-api-faqs): free Personal versus INR 500/month Connect and external-display restriction.
- Upstox, [OAuth authentication](https://upstox.com/developer/api-documentation/authentication/), [Market Data Feed V3](https://upstox.com/developer/api-documentation/v3/get-market-data-feed/), [feed authorization](https://upstox.com/developer/api-documentation/get-market-data-feed-authorize-v3/), and [rate limits](https://upstox.com/developer/api-documentation/rate-limiting/): authenticated access, stream shape and service limits.
- AMFI, [NAV download/history](https://www.amfiindia.com/net-asset-value), [NAV explanation and daily publication](https://www.amfiindia.com/investor/knowledge-center-info?zoneName=NetAssetValueNAV), and [CAS access](https://www.amfiindia.com/online-center/download-cas).
- SEBI, [2025 caution on Digital Gold](https://www.sebi.gov.in/media-and-notifications/press-releases/nov-2025/caution-to-public-regarding-dealing-in-digital-gold-_97676.html) and [Gold ETF investor material](https://investor.sebi.gov.in/pdf/reference-material/ppt/Mutual-Fund-for-intermediate.pdf).
- IBJA, [daily benchmark rates and publication terms](https://www.ibjarates.com/).
- RBI, [Sovereign Gold Bonds portal](https://sovereigngoldbonds.rbi.org.in/) and [premature-redemption rule example](https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=58564).
- US SEC, [EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces): keyless filing/XBRL access and update schedules.
- Alpha Vantage, [free-tier limits and delayed-data statement](https://www.alphavantage.co/support/) and [terms of service](https://www.alphavantage.co/terms_of_service/).

## Dated observations, not durable guarantees

- On 2026-09-19, Zerodha's official pages stated INR 0 for Personal APIs without live/historical data and INR 500/month per app for Connect with those data capabilities.
- On 2026-09-19, Upstox documentation exposed authenticated real-time V3 market feeds. The reviewed documentation did not establish a right for Stock-Mania to redistribute that feed to unrelated users; some expanded WebSocket capacity was explicitly associated with Upstox Plus.
- On 2026-09-19, AMFI exposed NAV download/history pages and described NAV as a daily post-market value. Public availability should be monitored as a provider dependency, not treated as a contractual SLA.
- On 2026-09-19, RBI's SGB portal showed no issuance notification newer than 2023-24 but did show later redemption operations. This supports `no currently evidenced new issue`, not the stronger claim `SGB permanently discontinued`.
- On 2026-09-19, Alpha Vantage stated 25 free requests/day and premium-only real-time/15-minute-delayed US quotes. Pricing, quotas and licence terms can change.

## Assumptions and unresolved items

- The intended first deployment is private/self-hosted or single-household. A public SaaS, employer deployment or adviser workflow changes market-data and commercial-use licensing materially.
- "Tracking" means recording ownership and transactions, reconciliation, valuation and reporting; it does not include advice, solicitation, execution or custody.
- No written AMFI or IBJA bulk-use/redistribution permission was found in the reviewed official pages. Legal review or written permission is required before commercial redistribution.
- No universal API for digital-gold balances, custody verification, spreads or redemption terms was identified. Each provider needs a separate contract and adapter review.
- Current broker token lifetime, app approval, account eligibility and commercial-platform onboarding must be verified during integration; documentation can change independently of this report.
- Reliable SGB exchange quotes and delisted/illiquid-series coverage remain unresolved at zero subscription cost. A manual/RBI-reference valuation path is mandatory.

## Recommendations

1. Market the free tier as **private portfolio tracking with daily, last-known and manual valuations**, never as free live market data.
2. Make every displayed value carry `source`, `as of`, `valuation method`, `freshness`, `currency` and `confidence/availability`. Missing must remain unavailable, not zero.
3. Separate provider entitlement from asset support: an asset can be tracked manually even when automated pricing is unavailable. Credentials, licences and rate limits belong in a Data Center, not hidden behind a refresh icon.
4. Preserve a transaction ledger and reconciliation evidence independently of quote history. Broker imports and CAS/provider statements should enter a review queue with deduplication and immutable source metadata.
5. Require an explicit deployment licence decision before enabling any multi-user quote display. Free account access is not equivalent to redistribution permission.

## Compact recommendation for the UI experiment

Test one shared shell with specialized asset workspaces rather than one universal holding card:

- **Overview:** total, invested amount, gain and allocation, with a persistent valuation-quality strip (`current`, `daily`, `stale`, `manual`, `unavailable`) and a priced-subtotal disclosure when coverage is incomplete.
- **Equities / ETFs:** exchange, account, units, average cost, last/EOD price, corporate-action/reconciliation alerts and quote entitlement.
- **Mutual funds:** AMC/scheme/plan/option, folio, units, NAV date, CAS reconciliation and daily-NAV semantics.
- **Gold:** segmented control for `Digital`, `Physical`, `SGB`, `ETF/EGR`. Each segment gets different fields and risk copy; only ETF/EGR behaves like a listed security.
- **Holding detail:** immutable activity, lots/cost basis, income/coupons, documents, valuation history and data provenance. For physical/digital gold, include purity/custody/redemption; for SGB, include series/coupon/maturity.
- **Data quality states:** show stale age and reason inline; keep the last known value visibly dated; allow manual override without replacing provider history; make `unavailable` a designed state.

Experiment hypothesis: users can identify an asset's valuation basis, freshness and next corrective action without opening settings, while asset-specific fields avoid false equivalence. Suggested success threshold: in deterministic desktop and mobile checks, every asset detail exposes asset type, source/method, as-of date and one relevant lifecycle field; no stale/manual/unavailable value is styled as live; incomplete coverage changes the portfolio label to `priced subtotal` rather than a complete total.

## Research Agent relay baton

### Research Agent -> Experiment Agent

- Goal: test an asset-segregated investment UI that remains truthful under free-data constraints.
- Completed: verified present-day data availability, freshness, authentication, licensing and product limits for Indian equities, mutual funds, digital/physical gold, SGBs and optional US equities.
- Decisions: zero-subscription mode is EOD/NAV/manual-ledger; broker quotes are account-connected entitlements; digital gold, physical gold and SGBs require distinct models; multi-user quote redistribution is not assumed.
- Inputs: this report; the active `Investment enterprise-readiness review and isolated experiment - 2026-09-19` plan section.
- Changed files: `_architecture/investment-experience/enterprise-readiness-research-2026-09-19.md`.
- Contract/output: use the compact experiment recommendation and predeclared success threshold above; synthetic values must be labelled.
- Verification: primary links opened/checked on 2026-09-19; Markdown structure and repository diff checked after writing.
- Open risks: AMFI/IBJA redistribution rights, digital-gold provider contracts, SGB exchange-price coverage and broker commercial onboarding remain unresolved.
- Next action: define the bounded experiment hypothesis/method and build only under `_architecture/investment-enterprise-review/**`.
- Do not revisit: production code, order execution, automated trading and claims of free exchange-grade real-time data are outside scope.
