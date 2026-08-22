# Dossier 05 — myFinance (FinFolio)

> Source: `myFinance/` @ commit `d4bc9cc` (2026-05-06). ~13,250 LOC — of which **12,693 lines are a
> single `index.html`**. Plus `server.js` (129 lines) and two serverless handlers (425 lines).
> Deployed to Fly.io. 1,884 lines of policy/compliance documentation.

## 1. Positioning

Architecturally this is the weakest of the four repos — a single-file client-side app with no
accounting model, no double entry, no server-side persistence, and browser `localStorage` as the
database.

**It is nonetheless the most valuable repo for two specific things:**

1. **The broadest Indian retail asset-class coverage** of any of the four (§3). It models fixed
   deposits, recurring deposits, post-office schemes, sovereign gold bonds, physical gold with
   duty/GST, real estate, and insurance — none of which Actual, Firefly, or Paisa model at all.
2. **Live broker connectivity** to five Indian brokers (§2) — the direct reference for our future
   quant/execution work.

It also demonstrates a genuinely novel ingestion technique: **LLM-parsed bank emails** (§5).

---

## 2. Broker integrations — the quant-phase reference

### 2.1 Coverage

`api/broker-auth.js` and `api/broker-proxy.js` implement five brokers behind one interface.

| Broker | Auth model | Login URL | Token endpoint |
|---|---|---|---|
| **Zerodha Kite** | API key + request token + **SHA256 checksum** | `https://kite.zerodha.com/connect/login?api_key={k}&v=3` | `POST https://api.kite.trade/session/token` |
| **Upstox** | Standard OAuth2 authorization code | `https://api.upstox.com/v2/login/authorization/dialog` | `POST https://api.upstox.com/v2/login/authorization/token` |
| **Groww** | Standard OAuth2 authorization code | `https://api.groww.in/v1/auth/authorize` | `POST https://api.groww.in/v1/auth/token` |
| **HDFC Securities** | API key in query + secret in body | `https://developer.hdfcsec.com/oapi/v1/login?api_key={k}&redirect_uri=…` | `POST https://developer.hdfcsec.com/oapi/v1/access-token?api_key={k}&request_token={c}` |
| **Angel One** | **TOTP**, not OAuth | *(none — returns `null`)* | `POST https://apiconnect.angelone.in/rest/auth/angelbroking/jwt/v1/generateTokens` |

### 2.2 Zerodha's checksum — the pattern to know

```js
const checksum = crypto.createHash('sha256')
  .update(apiKey + code + apiSecret)
  .digest('hex');
```

`SHA256(api_key ‖ request_token ‖ api_secret)`, sent alongside `api_key` and `request_token` as
form-encoded body. The secret is never transmitted — only proof of possession. This is Kite Connect's
standard flow and it is why the exchange **must** happen server-side.

Subsequent requests authenticate with `Authorization: token {api_key}:{access_token}`
(`broker-proxy.js:buildAuthHeaders`).

### 2.3 Per-broker auth header divergence

Five brokers, five schemes (`broker-proxy.js`):

| Broker | Authorization header | Extra headers |
|---|---|---|
| HDFC Securities | `{token}` — **raw, no scheme prefix** | `?api_key=` appended to every URL |
| Zerodha | `token {api_key}:{access_token}` | — |
| Groww | `Bearer {token}` | — |
| Upstox | `Bearer {token}` | — |
| Angel One | `Bearer {token}` | `X-PrivateKey`, `X-ClientLocalIP`, `X-ClientPublicIP`, `X-MACAddress` |

Same lesson as Actual's 48 bank adapters: **there is no such thing as a generic broker integration.**
The `BROKER_CONFIG` map with per-broker `buildTokenRequest` / `parseToken` / `buildAuthHeaders`
functions is the right shape — a declarative adapter registry.

### 2.4 The four normalised endpoints

Every broker is mapped to the same four operations, which is a sound minimal read-only surface:

| Operation | Zerodha | Upstox | Angel One | Groww | HDFC |
|---|---|---|---|---|---|
| `holdings` | `/portfolio/holdings` | `/portfolio/long-term-holdings` | `/rest/secure/angelbroking/portfolio/v1/getHolding` | `/v1/user/holdings` | `/portfolio/holdings` |
| `positions` | `/portfolio/positions` | `/portfolio/short-term-positions` | `/rest/secure/angelbroking/order/v1/getPosition` | `/v1/user/positions` | `/portfolio/positions` |
| `funds` | `/user/margins` | `/user/get-funds-and-margin` | `/rest/secure/angelbroking/user/v1/getRMS` | `/v1/user/funds` | `/funds-and-margins` |
| `profile` | `/user/profile` | `/user/profile` | `/rest/secure/angelbroking/user/v1/getProfile` | `/v1/user/profile` | `/user/profile` |

**Read-only.** No order placement, no streaming quotes, no websocket. For the quant phase we would
need to add `orders`, `trades`, `instruments` (the master contract file), and a websocket tick feed —
all of which Kite Connect and Upstox provide.

### 2.5 Security defects — including one the repo's own audit gets wrong

**Finding 1 — CORS is not actually restricted.** `docs/SECURITY-AUDIT.md` states:

> | `broker-proxy.js` — CORS restricted to `process.env.URL` | ✅ OK | Only allows the configured Fly.io origin |

The code says otherwise (identical in both handlers):

```js
function corsHeaders(event) {
  const allowedOrigin = process.env.URL || event?.headers?.origin || '*';
  return { 'Access-Control-Allow-Origin': allowedOrigin, ... };
}
```

If `process.env.URL` is unset the function **reflects the caller's own origin**, and if that is absent
too it returns `*`. Origin reflection is equivalent to no origin restriction at all. The audit's
"✅ OK" is incorrect.

**Finding 2 — no OAuth `state` parameter and no PKCE.** None of the login URL builders emit `state`.
The callback is therefore open to CSRF: an attacker can cause a victim's session to be bound to the
attacker's broker account (or vice versa).

**Finding 3 — access tokens are returned to the browser** and cached in `localStorage`
(`mypf_broker_holdings_cache`, `mypf_broker_selected`). The code comment claims the design is
"keeping secrets safe", which is true only of the *api_secret*. A live broker access token in
`localStorage` is XSS-exfiltratable, and the repo's own audit concedes the same risk for AI keys
("XSS = key theft", listed as "⚠️ Accepted").

**Finding 4 — Angel One's token request is malformed:**

```js
body: JSON.stringify({
  clientcode: process.env.ANGEL_CLIENT_ID || '',
  password: code,   // Angel One uses TOTP as the "code"
  totp: code,       // ...and the same value again
}),
```

`password` and `totp` are distinct credentials in Angel One's SmartAPI; passing the TOTP for both
cannot succeed against the real API.

**Finding 5 — the proxy is an open relay.** It accepts `{broker, endpoint, token}` from any caller and
forwards to the broker with server-held API keys attached. There is no authentication on the proxy
itself, so anyone who can reach the endpoint can use the deployment's HDFC/Angel API keys.

**Every one of these is a "do not copy" for our design.** They are catalogued in the architecture
plan's security section as explicit negative requirements.

---

## 3. Asset-class coverage — the genuinely valuable part

Derived from the `localStorage` key inventory in `index.html` (51 keys, prefix `mypf_`):

| Asset / concept | Key | Modelled by Actual? | Firefly? | Paisa? |
|---|---|---|---|---|
| Fixed deposits | `mypf_fds` | ✖ | ✖ | ✖ (manual account) |
| Recurring deposits | `mypf_rds` | ✖ | ✖ | ✖ |
| Post-office schemes | `mypf_po` | ✖ | ✖ | ✖ |
| Sovereign gold bonds | `mypf_sgb` | ✖ | ✖ | ✖ |
| Physical gold (+ duty, GST, per-gram rate) | `mypf_physical_gold`, `mypf_gold_duty_pct`, `mypf_gold_gst_pct`, `mypf_gold_price_per_gram`, `mypf_gold_rate`, `mypf_physical_gold_rates` | ✖ | ✖ | ◐ (`metal` commodity) |
| Real estate | `mypf_realty` | ✖ | ✖ | ◐ (`Assets:House`, untyped) |
| Insurance policies | `mypf_insurance` | ✖ | ✖ | ✖ |
| Loans | `mypf_loans` | ◐ | ✅ | ◐ |
| Mutual funds + NAVs | `mypf_manual_funds`, `mypf_mfnavs`, `mypf_mf_analysis`, `mypf_fund_verdicts` | ✖ | ✖ | ✅ |
| SIP plans | `mypf_sip_plans`, `mypf_sipday` | ✖ | ◐ (recurrence) | ◐ |
| Retirement plan | `mypf_retirement` | ✖ | ✖ | ✅ (SWR goals) |
| Budget + history | `mypf_budget`, `mypf_budget_history` | ✅ | ✅ | ✅ |
| Nifty benchmark | `mypf_nifty_baseline`, `mypf_nifty_last` | ✖ | ✖ | ◐ |

**This is the checklist of what a real Indian personal-finance product must model** and what the three
"serious" repos entirely omit. Physical gold with separate duty and GST percentages is a good example
of domain detail that only appears when someone actually uses the thing.

---

## 4. Market data sources

Extracted from `index.html`:

| Need | Endpoint |
|---|---|
| Mutual fund NAV | `https://api.mfapi.in/mf/{code}`, `https://api.mfapi.in/mf/search` (9 + 3 references) |
| Indian indices | `https://www.nseindia.com/api/allIndices` |
| Global equities | `https://query1.finance.yahoo.com/v8/finance/chart/{t}` |
| Equities / FX | `https://finnhub.io/api/v1/quote`, `https://finnhub.io/api/v1/forex/rates` |
| Equities (fallback) | `https://stooq.com/q/l/` |
| FX | `https://latest.currency-api.pages.dev/v1/currencies/usd.json` |
| Gold rates | `https://ibjarates.com` (IBJA — the Indian bullion benchmark) |
| CORS bypass | `https://api.allorigins.win/get` |
| Geocoding | `https://overpass-api.de/api/interpreter` |

Note `api.allorigins.win` — a **public third-party CORS proxy**. Routing financial requests through an
anonymous relay means an unknown operator sees every query. Another explicit do-not-copy.

`https://ibjarates.com` is a useful find: IBJA is the authoritative Indian gold price benchmark, better
than a generic metals API for SGB and physical gold valuation.

---

## 5. LLM-based ingestion — the one genuinely novel idea

`docs/ARCHITECTURE.md` documents a Gmail → LLM → transaction pipeline:

1. Google OAuth (token in `sessionStorage`, 1-hour expiry).
2. Build a per-bank Gmail search query from `GMAIL_BANK_CONFIGS`, e.g.
   `from:alerts@hdfcbank.bank.in (subject:Account update OR subject:UPI txn OR subject:debited via Credit Card) after:YYYY/MM/DD before:YYYY/MM/DD`.
3. Fetch message ids, **dedupe against `localStorage` by Gmail message id**.
4. Fetch full bodies in batches of 10; `extractEmailBody()` decodes base64url, preferring
   `text/plain` over `text/html`.
5. Batch 15 emails per LLM call with a prompt carrying parse hints and the user's budget categories.
6. Provider-agnostic dispatch (`callAIProvider()`) across Claude, OpenAI, Gemini, OpenRouter, Ollama.
7. LLM returns a JSON array of
   `{idx, merchant, amount, date, card, payment_method, type, category, budgetType}`.

**Assessment.** For markets like India where open-banking aggregation is immature, bank *alert emails*
are a real and widely-available transaction feed, and an LLM handles the format diversity that would
otherwise need one regex set per bank per alert type. The idea is sound.

The execution is not: parsing is non-deterministic, there is no confidence score or human-in-the-loop
confirmation, amounts extracted by an LLM are never verified against a checksum or the account balance,
bodies are truncated to 500 characters, and full financial email content is shipped to a third-party
LLM. Our version must be: LLM proposes → deterministic validator checks → user confirms → only then
does a posting exist. And it must run server-side against a provider under contract.

`mypf_ai_provider`, `mypf_apikey`, `mypf_gemini_key`, `mypf_openai_key`, `mypf_openrouter_key`,
`mypf_finnhub_key` confirm all API keys live in browser `localStorage`.

---

## 6. Storage and compliance posture

- **`localStorage` is the database.** 51 keys, plaintext JSON, per-browser. No cross-device sync
  except optional Supabase (`mypf_supa_config`, `mypf_supa_session`), with security resting entirely
  on Supabase RLS policies and a publishable anon key.
- Documentation is disproportionately thorough: `COMPLIANCE.md`, `PRIVACY-POLICY.md`,
  `TERMS-OF-SERVICE.md`, `DATA-STORAGE-DISCLOSURE.md`, `SECURITY.md`, `SECURITY-AUDIT.md`,
  `COST-ANALYSIS.md` — 1,884 lines for a 13K-line app.

**Credit where due:** the *existence* of a dated, checklist-shaped security audit with reproducible
`grep` commands per check, an explicit data-storage disclosure, and a cost analysis is better practice
than the other three repos manage. The XSS section in particular is concrete and correct (`escHTML()`
on all interpolated user/AI data, `textContent` on `contenteditable` blur).

**The lesson is double-edged:** a security checklist that is not mechanically verified drifts from the
code, as Finding 1 in §2.5 shows. Our plan treats these as CI-enforced tests, not documents.

---

## 7. Judgement

### Adopt

1. **The declarative broker adapter registry** (§2.1–2.3): per-broker `buildTokenRequest`,
   `parseToken`, `buildAuthHeaders`, and a normalised endpoint map.
2. **The four-operation broker read surface** (holdings / positions / funds / profile) as the minimal
   contract (§2.4), extended with orders, trades, instruments, and ticks for the quant phase.
3. **The full Indian retail asset-class inventory** (§3) — FD, RD, post-office, SGB, physical gold with
   duty and GST, realty, insurance. This is our coverage checklist.
4. **IBJA as the gold benchmark** (§4).
5. **LLM-assisted email ingestion as a transaction source** (§5) — restructured as
   propose → validate → confirm.
6. **Shipping a dated security audit, data-storage disclosure, and cost analysis** (§6) — but as
   executable checks.

### Reject

1. **Origin-reflecting CORS** (§2.5, Finding 1), and any security claim not backed by a test.
2. **OAuth without `state` or PKCE** (Finding 2).
3. **Broker access tokens in the browser** (Finding 3).
4. **An unauthenticated proxy holding server-side API keys** (Finding 5).
5. **`localStorage` as the system of record** (§6).
6. **Public third-party CORS relays** (`api.allorigins.win`) on financial requests (§4).
7. **Unvalidated LLM output written directly to financial records** (§5).
8. **A 12,693-line single HTML file** — untestable, unreviewable, unmaintainable.
