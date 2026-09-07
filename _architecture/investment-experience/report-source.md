# Investment workspace: research and proposed experience

Audience: Stock-Mania owner and the next Planner/Implementer. Date: 2026-09-06.
Scope: research then isolated experiment, Indian markets initially. Production implementation and live trading are not authorized by this packet. Status: research synthesis complete, experiments and QA pending; see the plan of record in `../70-UPGRADE-PLAN.md`, Investment experience research and experiment.

## Recommended direction

Make Investments a place to understand and manage invested wealth. Use a quiet overview, searchable holdings, a dedicated performance workspace, and an activity/reconciliation view. Put intraday strategy development and execution monitoring in a separate Trading Lab reached from the application navigation. Share instruments, accounting and price provenance underneath; keep the user tasks distinct.

This is a design recommendation to test, not a claim that this arrangement has already been validated with users.

## Current repository findings

`app/(root)/investments/page.tsx` currently assembles asset category cards, allocation controls, holdings, leasing information and forms, return/allocation panels and the instrument creation form. `add-instrument-form.tsx` asks for symbol, name, ISIN, exchange and pricing configuration for applicable instruments. This is source inspection; the local page was not visually observed because the browser runtime returned no available browser.

The foundations already exist: `src/domain/portfolio.ts` returns typed XIRR failures, residuals and cashflows; `src/domain/risk.ts` has risk checks and a simulated venue. Phase 8 explicitly describes quant readiness, not a delivered live trading system. We should audit and reuse these contracts before proposing replacement engines.

The research also found material reporting gaps: `src/app/investing.usecases.ts` exposes XIRR and absolute return but not TWR, and its portfolio income output is zero. In `src/domain/lots.ts`, disposal gain uses deductible sell charges when supplied, so the current realized figure cannot simply be relabeled economic net P&L. Reconciliation must also include fully closed holdings, which a current-holdings-only aggregate can omit. These need scoped verification and correction in a later implementation phase, not cosmetic renaming.

The proposed hierarchy is supported by first-party examples: IBKR describes an expandable snapshot dashboard, while Zerodha separates Holdings and Analytics. GOV.UK advises keeping essential information visible and using separate pages where substantial detail merits them. These are precedents, not proof of optimal usability for this user. [IBKR overview](https://www.interactivebrokers.com/campus/trading-lessons/portfolioanalyst-overview/), [Zerodha analytics](https://support.zerodha.com/category/console/portfolio/console-holdings/articles/console-analytics), [GOV.UK accordion guidance](https://design-system.service.gov.uk/components/accordion/).

## Information architecture for the mockup

| Branch | Default content | Open on demand |
|---|---|---|
| Overview | Portfolio value, total investment gain, personal return; one value chart; valuation date/quality | Allocation, performance explanation, data issues |
| Holdings | Search and asset/broker filters; compact holdings table | Selected holding detail |
| Holding detail | Position value, units, cost basis and gain | Performance, transactions/lots, income and leases, tax, instrument settings |
| Performance | Explicit portfolio scope, date range and one selected analysis | Growth/TWR benchmark, cashflow/XIRR, allocation, drawdown/risk, realized P&L |
| Activity | Trades, distributions and transfers in one timeline | Import/reconcile, correction/reversal, corporate actions, charges |
| Trading Lab | Strategy library and stage, with paper mode unmistakable | Parameters, backtest, paper session, execution journal, risk controls |

Proposed route names are illustrative contracts for a later planner: `/investments`, `/investments/holdings`, existing `/investments/[instrumentId]`, `/investments/performance`, `/investments/history`, and `/trading`. The implementation should decide route vs query-state based on existing navigation and preserve deep links.

Move lease management into the holding's Income & leases branch while counting the underlying gold only once. This intentionally proposes changing the historical placement decision, not the ownership rule. Existing authoritative decisions remain in force until approval.

## Metric contracts

Every metric carries scope, date range, valuation timestamp, currency, fee treatment and calculation availability. A missing required quote prevents a complete portfolio valuation; a separately labeled priced subtotal may remain useful. Stale observations retain age/source labels.

- Unrealized P&L: current value minus the remaining position's cost basis. Do not subtract capitalized purchase charges twice.
- Realized P&L: net disposal proceeds minus the disposed basis, with explicit expense allocation and selected accounting method. Tax reporting may require a jurisdiction-specific method independently of an analytical comparison.
- Total investment gain: reconcile realized gain, unrealized gain and income less costs that are not already included. Transfers between included accounts are not new gains.
- Period P&L requires the change in unrealized gain from the opening date, not the full lifetime unrealized balance added to only the period's realized gains. For a consistently bounded portfolio, reconcile against ending value minus opening value minus net external contributions, including cash and all relevant flows. Default the prototype's total gain to clearly labeled since-inception scope to avoid mixing periods.
- XIRR: investor money-weighted annualized return, using dated external flows and a terminal value. Show the included cashflows and undefined reasons; same-day trading needs rupee/percentage P&L rather than a meaningless annualized XIRR.
- TWR: geometrically link returns between external cashflows; use matching-period and matching-currency benchmark returns. Missing boundary valuations require a named approximation or unavailable state.
- Tax: distinguish transaction levies and withholding already booked from an estimated eventual tax liability. Estimated exit proceeds require proposed sale price, disposal lots and applicable rules; a market quote cannot reveal actual historic charges.

Money-weighted returns respond to external-flow timing and size; true TWR separates those flows into linked subperiods. These definitions inform the design without claiming GIPS compliance. [CFA Institute, GIPS Handbook](https://www.gipsstandards.org/standards/gips-standards-for-firms/gips-standards-handbook-for-firms/).

## Search-first transaction entry

Start with Search investment; show the full security name, symbol, exchange and asset/contract type. Selecting a result populates identity and provider mapping. The user then records side, trade date, quantity, execution price and account; show an expandable charges section and a review of cash impact. Prefer a saved account default when unambiguous. Import actual broker records into a review stage to reduce typing further.

An identifier is not a price. Maintain an internal instrument identity plus exchange-specific listings and dated provider mappings. Do not infer a listing solely from a company name or reuse an exchange token as a permanent cross-provider key. Unknown/delisted instruments need a manual historical-entry fallback with unresolved pricing made visible.

Upstox documents a daily JSON master with identifiers and exchange information and warns of exchange-token reuse; its authenticated search endpoint supports partial name/symbol matches and ISIN lookup across listings. These support the design, but catalogue availability does not establish unrestricted redistribution rights. [Instrument files](https://upstox.com/developer/api-documentation/instruments/), [Instrument search](https://upstox.com/developer/api-documentation/instrument-search/).

### Provider decision

| Provider | Instrument identity path | Current account/data constraint | Proposed role |
|---|---|---|---|
| Upstox | Public BOD JSON; authenticated search API | API product page currently advertises free trading/data APIs; account and token conditions still apply | Primary catalogue candidate for the isolated spike |
| Dhan | Public detailed CSV with ISIN and security ID | Trading APIs free for individuals with account/token; data subscription currently advertised at INR 499 + GST/month | Independent identity cross-check; do not assume free live data |
| Zerodha | Authenticated instrument CSV; holdings response supplies ISIN | Personal API excludes live/historical data; Connect currently INR 500/month/app | User-specific broker import/execution mapping if chosen |

These prices are observations on 2026-09-06, not lasting project commitments. Upstox's page includes a separate time-limited order-pricing offer; free API access does not mean free trades. [Upstox API](https://upstox.com/trading-api/), [Dhan instruments](https://dhanhq.co/docs/v2/instruments/), [Dhan data subscription](https://dhan.co/support/platforms/dhanhq-api/how-does-the-dhanhq-data-api-subscription-work/), [Zerodha API plans](https://zerodha.com/products/api), [Kite instrument fields](https://kite.trade/docs/connect/v3/market-data-and-instruments/), [Kite holdings fields](https://kite.trade/docs/connect/v3/portfolio/).

Store private raw snapshots with fetch time and checksum for reproducibility. Archive historical identity mappings because expired/delisted securities leave current catalogues. NSE's data policy covers identifiers and limits distribution to agreed terms; broker catalogue pages did not establish a general licence to republish their bulk data. Resolve the intended private/commercial use before production distribution. [NSE data policy](https://www.nseindia.com/static/market-data/nse-data-policy).

Actual fills can differ from order prices and an order can fill in parts. Reconcile fill IDs, quantities, timestamps, contract notes and actual charge lines rather than using today's quote or tariff to invent historical execution economics. [Kite orders and trades](https://kite.trade/docs/connect/v3/orders/), [Zerodha charges](https://zerodha.com/charges/).

## Trading architecture proposal

The feasible initial target is a measured retail intraday system, with a cadence selected after broker/data constraints are known. Exchange-proximity HFT is a distinct infrastructure proposition: NSE describes co-location inside exchange premises for sophisticated algorithmic participants. A browser application and a free price API do not establish equivalent latency or execution capability. [NSE trading technology](https://www.nseindia.com/static/trade/platform-services-neat-trading-system), [NSE co-location](https://www.nseindia.com/static/trade/platform-services-co-location-facility).

Proposed lifecycle: hypothesis -> versioned strategy -> replay/backtest -> out-of-sample evaluation -> paper trading -> supervised limited live trial -> separately approved automation. Do not optimize strategy parameters using the final holdout. Model trading costs, spread, slippage, latency, partial fills, rejects, corporate actions, missing bars and session boundaries. Store the data snapshot, parameters, code version and all simulated decisions so a run is reproducible.

Candidate mathematical building blocks, to refine with the user: volatility-adjusted position sizing, a liquidity/spread filter, a signal based on completed bars, ATR-derived stop distance and a daily loss budget. For an illustrative long trade, risk-limited units are the floor of risk budget divided by stop distance plus an adverse cost allowance per unit; round to lot size and cap by cash, exposure and liquidity. Gap/slippage risk can still exceed the planned stop loss. This is an experimental specification, not evidence of positive expectancy.

A future execution worker should own connectivity, risk decisions, idempotency, broker acknowledgements, fills and reconciliation independently of a browser tab. This is a proposed architecture departure that needs explicit approval and a deployment decision. The current repository's simulated venue remains the only established venue in this review.

Keep pre-trade checks visible in a concise readiness state, with drill-down for stale quotes, permissions, margin, position limits, order limits and kill switch. An unknown order status must be reconciled before retrying; a network timeout is not proof an order failed.

SEBI's September 30, 2025 circular makes the retail algo framework and exchange modalities applicable to all brokers from April 1, 2026. Broker-specific onboarding and current exchange rules must be checked before enabling live execution. [SEBI circular](https://www.sebi.gov.in/sebi_data/attachdocs/sep-2025/1759232056254.pdf).

The original framework provides broker accountability, API identification/authentication, static-IP controls and algo tagging. NSE's May 2025 implementation standard sets a 10 orders/second threshold for the specified unregistered client-algo path; exceeding it requires registration, and being below it does not exempt API orders from the framework. Design well below broker limits, not at a presumed entitlement to 10 successful fills/second. [SEBI original framework](https://www.sebi.gov.in/sebi_data/attachdocs/feb-2025/1738665456458.pdf), [NSE implementation standard](https://nsearchives.nseindia.com/content/circulars/INVG67858.pdf).

Currentness limitation: NSE's current landing page references April 30, 2026 circular 73992; its ZIP operational package was not inspected in this research. Order-type/session exceptions are evolving. Treat live onboarding, order types, static-IP setup, registration and current broker limits as open implementation prerequisites, not certified readiness. [NSE current algo resources](https://www.nseindia.com/static/trade/platform-services-non-neat-decision-support-tools-algorithm-trading).

### What the strategy experiment can establish

Run a fixed transparent rule on deterministic synthetic bars with next-bar fills and compare zero-cost vs cost/slippage and latency stress. Record trade count, gross/net results, expectancy and drawdown. The purpose is to test causal accounting and rejection controls, not to find a profitable rule on made-up prices. A real candidate later needs permitted historical data, chronological validation, untouched holdout, parameter stability and paper/live execution measurements. Net expectancy can be written as win probability times average win minus loss probability times average loss minus costs; a useful signal must survive realistic uncertainty in each component.

Advanced monitoring belongs on demand: drawdown and recovery duration; exposure by symbol/sector; turnover and cost drag; profit factor and expectancy; rolling out-of-sample results; data staleness; signal-to-order and order-to-acknowledgement latency distributions; fills/rejections; and reconciliation status. Sharpe/Sortino need stated frequency, sample size and return convention. VaR and stop losses do not cap losses during gaps. No numerical performance threshold in this report promises future profit.

## Approval sequence

First approve or revise the interaction concept. Then ask only the questions that change delivery: broker/account, priority asset classes, tracking vs order execution, intended signal cadence, data/hosting budget, reporting boundary and broker import format. A non-Astra Planner/Implementer then turns those answers into bounded file scopes and acceptance tests; experts implement sequentially where dependencies exist, and independent QA signs off each delivered phase.

Suggested delivery order: navigation and overview; search-first recording/import; performance provenance and charts; strategy research/backtest workspace; paper execution and reconciliation; separately authorized live integration. No live phase should be inferred from approval of the investment-page mockup.

## Evidence gaps and verification limits

Browser inspection is unavailable. Current facts are grounded in source and official documentation; prototype interaction, calculation and structural results will be added by the experiment/QA relay. User preferences, broker eligibility, redistribution permissions, live-feed quality and end-to-end latency remain unresolved. No live account, market feed or trading strategy performance has been tested.
