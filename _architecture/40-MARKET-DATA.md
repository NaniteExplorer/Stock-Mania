# 40 — Market Data, Providers, and Integrations

> The layer that decides whether the product is trustworthy. Paisa's data layer is the best of the four
> and still has a single point of failure on a hobbyist's personal domain (Dossier 04 §5.3).
> This document is written to make that class of failure impossible.

---

## 1. Principles

1. **Two providers minimum per data need.** A single upstream is an outage waiting to happen.
2. **The instrument master is ours.** Provider identifiers are *mappings*, never the identity. Paisa's
   `Price{Provider, Code}` (Dossier 04 §3) binds instruments to one provider; swapping invalidates user data.
3. **Prices are bitemporal and never overwritten.** A vendor correction is a new row (`20-DOMAIN-MODEL.md` §3.8).
4. **Missing is not zero.** An unavailable price yields `null` and a stale marker, never a zero valuation.
5. **Never trust one vendor's number silently.** Cross-check, and record disagreement.
6. **Credentials never reach the client.** Every myFinance finding (Dossier 05 §2.5) is a requirement here.

---

## 2. Provider landscape

Seeded by what the four repos actually use, extended to production grade.

### 2.1 Equities — India

| Provider | Endpoint | Auth | Cost | Verdict |
|---|---|---|---|---|
| **Yahoo Finance** | `query2.finance.yahoo.com/v8/finance/chart/{t}` (Paisa `stock/yahoo.go:130`) | none | free | **Undocumented internal endpoint.** Breaks without notice, IP rate-limited. Dev/fallback only. |
| **Alpha Vantage** | `alphavantage.co/query?function=TIME_SERIES_DAILY` (Paisa `stock/alphavantage.go:99`) | API key | free tier **25 req/day** | Its own config help admits the limit. Unusable at scale. |
| **NSE India** | `nseindia.com/api/allIndices` (myFinance) | none, cookie-gated | free | Requires browser-like session priming. Fragile. |
| **Finnhub** | `finnhub.io/api/v1/quote` (myFinance) | API key | free 60/min, paid tiers | **Good MVP choice.** |
| **EOD Historical Data** | `eodhd.com/api/eod/{sym}` | API key | ~$20/mo | **Recommended production.** Explicit NSE/BSE coverage, corporate actions, splits, dividends. |
| **Kite Connect** | `api.kite.trade/quote`, `/instruments` | broker OAuth | ₹2000/mo | **Best India data** — authoritative, includes the full instrument master and websocket ticks. Requires a broker account. |

**Recommendation:** MVP on **Finnhub** + Yahoo fallback. Production on **EOD Historical Data** as the
golden source with **Kite Connect** as primary for users who connect a Zerodha account (their broker
data is authoritative for their own holdings anyway).

### 2.2 Equities — global

| Provider | Notes |
|---|---|
| **EOD Historical Data** | 150k+ tickers, 30 years history, splits and dividends included |
| **Polygon.io** | Best US coverage; tick data available — the natural upgrade for the quant phase |
| **Alpaca** | Free market data with a brokerage account; also an execution venue |
| **Twelve Data** | Reasonable free tier, good for redundancy |

### 2.3 Mutual funds (India)

| Provider | Endpoint | Verdict |
|---|---|---|
| **MFAPI** | `api.mfapi.in/mf/{schemeCode}` (Paisa `mutualfund/nav.go:20`, myFinance ×9) | Both repos chose it independently. Free, reliable, full NAV history. **Primary.** |
| **AMFI** | `portal.amfiindia.com/DownloadSchemeData_Po.aspx?mf=0` (Paisa `mutualfund/scheme.go:13`) | The authoritative scheme master. **Use for the instrument master**, refreshed daily. |
| finbodhi | `mutualfund.finbodhi.com` (Paisa) | **Reject** — personal domain, no SLA. |

### 2.4 The other classes

| Need | Recommendation | Notes |
|---|---|---|
| **NPS NAV** | Scrape NPS Trust directly; cache aggressively | Paisa uses `nps.finbodhi.com` — a personal mirror. Own this. |
| **Precious metals** | **IBJA** (`ibjarates.com`, from myFinance) primary; metals-api.com secondary | IBJA is the authoritative Indian bullion benchmark — a genuinely good find in the weakest repo. |
| **FX** | **ECB daily reference** (free, authoritative) primary; `latest.currency-api.pages.dev` (myFinance) secondary; Finnhub tertiary | Firefly's `currency_exchange_rates` with `user_rate` override is the right storage shape (Dossier 03 §5). |
| **Crypto** | **CoinGecko** (free tier) → CoinMarketCap paid | Absent from all four repos. |
| **Bonds / G-secs** | CCIL and RBI published yields; NSE for listed bonds | No repo models these. Needs coupon schedule + YTM computation, not just a price. |
| **Cost Inflation Index** | Publish our own table from CBDT notifications | Paisa uses `india.finbodhi.com/api/cii/v2.json`. CII is ~1 value per year — **there is no reason to have a network dependency for this at all.** Ship it as seed data. |
| **Corporate actions** | EOD Historical Data; BSE/NSE announcements as cross-check | The critical gap (§5). |
| **Bank aggregation** | India: **Account Aggregator** (Setu / Finvu / OneMoney). EU/UK: **GoCardless** (Actual's choice). US: **Plaid** or **SimpleFIN** (Actual's choice). | |
| **Broker** | Kite Connect, Upstox, Angel One, Groww, HDFC Securities (all five from myFinance, Dossier 05 §2) | |

---

## 3. The provider abstraction

Extends Paisa's `PriceProvider` interface (Dossier 04 §5.1), which is the right shape but lacks
capabilities, rate limits, health, and incremental fetch.

```ts
interface DataProvider {
  readonly id: string;                    // 'eodhd', 'mfapi', 'kite'
  readonly displayName: string;
  capabilities(): ProviderCapabilities;   // declared, machine-readable
  health(): Promise<HealthStatus>;        // for failover decisions
  rateLimit(): RateLimitBudget;           // requests per window, burst
}

interface ProviderCapabilities {
  assetClasses: AssetClass[];
  supportsIntraday: boolean;
  supportsHistorical: boolean;
  supportsCorporateActions: boolean;
  supportsInstrumentSearch: boolean;
  identifierTypes: ('ISIN'|'FIGI'|'TICKER'|'SCHEME_CODE'|'MIC_TICKER')[];
  maxHistoryYears: number;
  quoteDelayMinutes: number;              // 0 = realtime, 15 = delayed
}

interface QuoteProvider extends DataProvider {
  // Incremental range fetch — Paisa's GetPrices returns ALL history every time
  fetchQuotes(req: {
    instruments: InstrumentRef[];
    from: PlainDate;
    to: PlainDate;
    quoteType: QuoteType;
  }): Promise<Result<Quote[], ProviderError>>;
}

interface CorporateActionProvider extends DataProvider {
  fetchActions(instrument: InstrumentRef, from: PlainDate, to: PlainDate)
    : Promise<Result<CorporateAction[], ProviderError>>;
}

interface InstrumentMasterProvider extends DataProvider {
  search(query: string, filter?: { assetClass?: AssetClass }): Promise<InstrumentCandidate[]>;
  resolve(ref: InstrumentRef): Promise<InstrumentMaster | null>;
}

interface FxProvider extends DataProvider {
  fetchRates(base: string, quotes: string[], from: PlainDate, to: PlainDate)
    : Promise<Result<FxRate[], ProviderError>>;
}
```

Retained from Paisa and worth keeping: **self-description**. A provider declares its own configuration
fields so the "add an instrument" UI is generated from the provider rather than hard-coded.

### 3.1 Resilience — required of every provider

| Mechanism | Specification |
|---|---|
| Retry | Exponential backoff, 3 attempts, full jitter. Never retry 4xx except 429. |
| Rate limiting | Token bucket per provider from `rateLimit()`. Requests queue, never drop. |
| Circuit breaker | Open after 5 consecutive failures; half-open probe after 60s. |
| Timeout | 10s per request, 30s per batch. |
| Failover | On open circuit, the registry moves to the next provider by priority for that need. |
| Caching | Redis, TTL by class: intraday 60s, EOD 24h until next close, NAV 12h, FX 1h, corporate actions 24h, instrument master 7d. |

### 3.2 Conformance suite

Every provider must pass one shared test suite before registration:

1. Returns a known-good historical price for a reference instrument within 0.5% of the golden value.
2. Returns a typed `ProviderError`, never a throw, for an unknown symbol.
3. Respects its declared rate limit under a burst of 100 requests.
4. Trips its circuit breaker under induced failure.
5. Returns quotes in ascending date order with no duplicate `(instrument, as_of)`.
6. Declares capabilities that match its actual behaviour (asserted by probing).

**This suite is why adding a seventh provider is safe.** None of the four repos has anything like it.

---

## 4. Ingestion architecture

```
Scheduler (BullMQ repeatable)
   ├── EOD refresh        after each exchange close, per exchange calendar
   ├── NAV refresh        daily 23:00 IST (AMFI publishes ~22:00)
   ├── FX refresh         hourly
   ├── Instrument master  daily 04:00
   ├── Corporate actions  daily 05:00
   └── Backfill           on-demand when an instrument is first added
         │
         ▼
   Fetch → Normalise → Validate (Q01–Q06) → Reconcile → Persist
                                                 │
                              ┌──────────────────┴──────────────────┐
                              │ Golden record: highest-priority     │
                              │ healthy provider wins; disagreement │
                              │ > 1% is logged and flagged          │
                              └─────────────────────────────────────┘
```

**Backfill on add.** When a user first adds an instrument, we fetch its full available history
immediately. Without this, XIRR and TWR over any period predating the user's signup are impossible.

**Vendor disagreement.** When two providers give different prices for the same
`(instrument, as_of, quote_type)`, both rows persist (the primary key includes `provider_id`). The
golden record is chosen by priority, and a divergence above 1% raises a `WARN`. Silent selection is
how bad data becomes invisible.

---

## 5. Corporate actions — the critical gap

Absent from all four repos (Dossier 06 §8). Without it, a 1:5 split makes a position look like it lost
80% of its value, and cost basis is permanently wrong.

```sql
CREATE TABLE corporate_actions (
  id             UUID PRIMARY KEY,
  instrument_id  UUID NOT NULL REFERENCES instruments(id),
  action_type    TEXT NOT NULL,
  ex_date        DATE NOT NULL,
  record_date    DATE,
  pay_date       DATE,
  ratio_from     NUMERIC(38,18),      -- SPLIT 1:5 → from 1, to 5
  ratio_to       NUMERIC(38,18),
  cash_amount    NUMERIC(38,18),      -- dividends
  currency       CHAR(3),
  target_instrument_id UUID,          -- mergers, spinoffs
  source         TEXT NOT NULL,
  status         TEXT NOT NULL,       -- PENDING | APPLIED | REJECTED
  applied_at     TIMESTAMPTZ,
  UNIQUE (instrument_id, action_type, ex_date)
);
```

### 5.1 Application semantics

| Action | Effect on lots | Effect on prices |
|---|---|---|
| `SPLIT` 1:n | Every open lot: `quantity ×= n`, `cost_basis` unchanged (unit cost ÷= n) | Historical quotes before `ex_date` divided by `n` for charting; **raw quotes retained** |
| `REVERSE_SPLIT` n:1 | Inverse; fractional residue paid as cash → a realised disposal | Inverse |
| `BONUS` | New lots at zero cost (jurisdiction-dependent), `acquired_on = ex_date` | — |
| `DIVIDEND_CASH` | No lot change; a `DIVIDEND` transaction is generated | — |
| `DIVIDEND_STOCK` | New lots at the declared value | — |
| `MERGER` | Close lots in the source, open in the target at carried-over basis | — |
| `SPINOFF` | Basis apportioned between parent and spun-off entity by relative fair value | — |
| `RETURN_OF_CAPITAL` | Reduces cost basis; if basis reaches zero, the excess is a realised gain | — |

### 5.2 Replay, not mutation

Corporate actions are **applied as ledger transactions** (`txn_type = 'CORPORATE_ACTION'`), never as
in-place edits to lots. This means:

- the action is visible, auditable, and reversible;
- a wrongly-applied action is undone by reversing its transaction;
- the event log stays the single source of truth;
- late-arriving actions replay through the normal backdated-write path, bumping the account revision
  and invalidating exactly the affected projections (`10-SYSTEM-ARCHITECTURE.md` §8).

**Charts use adjusted prices; cost basis uses raw prices and explicit action transactions.** Conflating
these is the most common corporate-action bug.

---

## 6. Bank and broker connectivity

### 6.1 The adapter registry

Two independent pieces of evidence say a generic integration does not exist: Actual needs **48
bank-specific adapters** behind a "standard" PSD2 API (Dossier 02 §5.2), and myFinance needs **five
different auth-header schemes** for five brokers (Dossier 05 §2.3).

```ts
interface BrokerAdapter {
  readonly id: string;
  buildAuthUrl(redirectUri: string, state: string, pkce: PkceChallenge): string | null;
  exchangeToken(code: string, verifier: string): Promise<TokenSet>;
  buildAuthHeaders(token: string): Record<string, string>;
  fetchHoldings(token: string): Promise<Holding[]>;
  fetchPositions(token: string): Promise<Position[]>;
  fetchFunds(token: string): Promise<Funds>;
  normaliseInstrument(raw: unknown): InstrumentRef;   // the per-broker quirk lives here
}
```

Directly modelled on myFinance's `BROKER_CONFIG` (Dossier 05 §2.1), which has the right shape, plus
the mandatory `state` and PKCE its version lacks.

### 6.2 Broker specifics

| Broker | Auth | Header | Quirk |
|---|---|---|---|
| Zerodha Kite | `SHA256(api_key ‖ request_token ‖ api_secret)` | `token {key}:{token}` | Token expires daily at 06:00 IST — re-auth is *interactive*, so a daily user action is unavoidable |
| Upstox | OAuth2 authorization code | `Bearer` | Standard |
| Groww | OAuth2 authorization code | `Bearer` | Standard |
| Angel One | TOTP, no OAuth redirect | `Bearer` + `X-PrivateKey`, `X-ClientLocalIP`, `X-ClientPublicIP`, `X-MACAddress` | myFinance's implementation passes the TOTP as both `password` and `totp` — malformed (Dossier 05 §2.5, Finding 4) |
| HDFC Securities | API key in query + secret in body | **raw token, no scheme prefix** | `?api_key=` must be appended to every request |

**Zerodha's daily expiry is a product constraint, not a bug.** Design for it: sync on user login, cache
holdings, and show the last-synced timestamp prominently rather than pretending data is live.

### 6.3 Consent lifecycle

```
PENDING_CONSENT → ACTIVE → (EXPIRED | REVOKED | ERROR)
```

Tokens are stored envelope-encrypted (`connections.access_token_enc`), never returned to the client,
and never logged (invariant I04). Consent expiry is tracked and the user is prompted before it lapses —
GoCardless consents last 90 days, and Account Aggregator consents carry an explicit user-chosen term.

### 6.4 India Account Aggregator

The correct long-term path for Indian bank data (RBI-regulated, unlike email scraping):

```
1. User selects an AA (Setu / Finvu / OneMoney)
2. We create a consent request: purpose, data range, frequency, validity
3. User approves in the AA app, authenticating with the FIP (their bank)
4. AA returns a consent handle; we poll or receive a webhook
5. We request an FI (financial information) fetch against the handle
6. Data arrives encrypted per the ReBIT schema; we decrypt with our key pair
7. Consent must be re-obtained at expiry
```

This is materially more work than a screen-scrape and is the only defensible approach for a product
handling Indian bank data.

### 6.5 Import deduplication

Adopting Actual's 3-pass descending-fidelity matcher wholesale (Dossier 02 §5.3) — the best algorithm
in any of the four repos:

```
Pass 0: run rules to normalise counterparty/category BEFORE matching
Pass 1: exact match on (external_id, account_id)
Pass 2: candidates = same account, same amount, |date diff| <= 7 days,
        ordered by |date diff|; take the first unmatched with the same counterparty
Pass 3: take the first unmatched candidate regardless of counterparty
```

The two details that make it correct and that a reimplementation must preserve:

- a shared `matched` set, so two incoming rows never claim the same existing row;
- **three complete sweeps over all rows**, not per-row passes, so a high-fidelity match always beats a
  low-fidelity one regardless of input order.

Plus, from Actual: `strictIdChecking` — if the incoming row has an external id, only consider
candidates that have none.

**Our additions:** content-addressed file hashing so re-importing the same statement is a no-op
(invariant I02), and a staging table (`import_rows`) where nothing enters the ledger until `CONFIRMED`
(invariant I01).

---

## 7. LLM-assisted ingestion

myFinance's Gmail → LLM → transaction pipeline (Dossier 05 §5) is a genuinely good idea executed
unsafely. For markets where open banking is immature, bank alert emails are a real transaction feed,
and an LLM handles format diversity that would otherwise need a regex set per bank per alert type.

**Our version — propose, validate, confirm:**

```
1. Fetch emails server-side via Gmail API (least-privilege scope, token server-side only)
2. Dedupe by message id BEFORE any LLM call (cheap, deterministic)
3. Extract with an LLM into a STRICT schema (tool-use / structured output, not free text)
4. DETERMINISTIC VALIDATION:
     - amount parses to a valid Money in the account's currency
     - date within the requested range
     - the sender domain matches a known bank config
     - the amount is corroborated by a regex over the raw body  ← the key check
     - the resulting balance change is plausible
5. Confidence scoring; anything below threshold goes to manual review
6. Land in `import_rows` as DRAFT → user confirms → posting created
7. Never auto-post
```

The corroboration step in (4) is what makes this safe: the LLM's job is to *locate and structure*, and
a regex independently confirms the number. If they disagree, the row goes to review. An LLM-extracted
amount must never become a posting on the model's word alone.

Privacy: this ships full financial email content to a model provider. It must be opt-in, disclosed
explicitly, and run against a provider under a data-processing agreement with no training retention.

---

## 8. Security requirements

Each row is an executable test, not a document — the lesson of Dossier 05 §2.5, Finding 1, where the
audit claimed CORS was restricted while the code reflected origins.

| Requirement | Test |
|---|---|
| CORS is a fixed allow-list, never reflection, never `*` | Request with a disallowed `Origin` is rejected |
| Every OAuth flow sends `state` and PKCE | Callback without a matching `state` fails |
| Broker tokens never in a response body | Response-schema assertion on every endpoint |
| Broker tokens never in logs | Pino redaction test over a captured log stream |
| The proxy is authenticated | Unauthenticated request returns 401 |
| Tokens encrypted at rest | Column type is `BYTEA`; a plaintext-token test fails |
| No third-party CORS relays | Dependency/URL allow-list check in CI |
| Secrets from a vault, not `process.env` | Startup assertion in production mode |
