# Swappable market-data engine: search-gated adds, inception history, live charts, XIRR

Status: DONE
Owner: Planner/Implementer
Updated: 2026-09-13 (Phase 3 complete)

## Requirement

Give the owner a market-data layer that is a **swappable engine, not a provider list**: a
`src/market-data/` ports layer with adapter folders separated by concern (Indian / international /
global / symbology / fx / local / manual), so a paid feed can be dropped in **per capability** later
without touching callers. On top of it, extend the existing `/investments/new` search flow so that
an instrument that **cannot be priced cannot be added**; wire the already-written-but-unwired
`BackfillInstrumentHistory` into the container and a cron route so every holding carries daily bars
from its inception date in the currently-unused `price_bars` table; and render, on the instrument
page and in a comparison view, live inception-to-today price charts plus XIRR and P/L computed over
the owner's own locally-logged ledger.

Lane: **Research then implementation** (AGENTS.md Requirement modes, option 4). Primary mode:
**Implementation**. Research and experiment batons are approved and closed — see Context map.

## Acceptance criteria

- [ ] A deployment-egress probe has been run from the real runtime and its results recorded here;
      no adapter that depends on an unmeasured host is accepted before it passes (blocker AA8).
- [ ] `src/market-data/ports/` defines `SymbolSearchPort`, `LiveQuotePort`, `HistoricalSeriesPort`,
      `FxRatePort`, `InstrumentMasterPort` and an optional `CorporateActionsPort`; every
      `HistoricalSeriesPort` result declares `adjusted: boolean` and every `FxRatePort` result
      declares the `effectiveDate` actually used.
- [ ] A registry selects an adapter **per capability x market**, with per-instrument vendor pinning,
      and a documented fallback chain; swapping a vendor is one config edit plus one adapter file.
- [ ] `/investments/new` searches as the user types, shows exchange- and currency-labelled
      candidates, and a candidate whose symbol does not resolve on the history endpoint is rendered
      **unaddable** — the submit path rejects it server-side, not only in the UI.
- [ ] `catalog-actions.ts` no longer assigns `quoteRef` by blind `symbol.toUpperCase()`; the quote
      key is the exact string the history adapter accepted, persisted at resolution time.
- [ ] `BackfillInstrumentHistory` is constructed in `src/infra/container.ts`, reachable from a
      route/cron, uses explicit `period1`/`period2`, and writes daily bars into `price_bars`.
- [ ] The instrument page shows an inception-to-today price chart with the live last price; a
      comparison view charts two or more instruments (and a benchmark) on one normalised axis.
- [ ] XIRR and P/L on the instrument page are computed from the owner's ledger, and a test proves
      the split double-adjustment trap is not present (NVDA 40x / AAPL 4x cases).
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `npm run db:check` all
      recorded by the independent Testing/QA Agent.
- [ ] No paid API, no trial key, no key-walled source is introduced.

## Context map

| Need | Authoritative file/section | Why it is needed |
|---|---|---|
| Source inventory, eliminations, `quoteKey` gate | `_architecture/requirements/market-data-sources-research.md` (F1-F15, D1-D8, D-1..D-6) | Which sources are permitted at all |
| Measured behaviour and the 16-item trap list | `_architecture/requirements/market-data-experiment-results.md` (E1-E7, X1-X8) | The traps this plan must encode: `range=max`, split rewrite, 40x cost-basis error, `TATAMOTORS.NS` 404, UA-triggered 429 |
| Capability/adapter map, search fix, failovers | `_architecture/requirements/market-data-sources-research-round2.md` (C.1-C.4, R1-R12, V1-V22, AA1-AA8) | The folder seam, Moneycontrol/OpenFIGI/Nasdaq adapters, and the unresolved egress blocker |
| Provider base: token bucket, breaker, retry, typed errors, `assertStatus` | `src/infra/providers.ts` L258-464 | New adapters reuse this machinery; they do not add an HTTP layer |
| Yahoo chart adapter as it stands (already `period1`/`period2`, already currency-checks) | `src/infra/providers.ts` L812-900 | The starting point for `global/yahoo-chart`; keep its currency guard |
| Provider chain assembly | `src/infra/providers.ts` `shippedQuoteProviders` L1376-1402, `shippedFxProviders` L1404-1406 | Where `NseQuoteProvider` (dead, D-3) and `ZerodhaQuoteProvider` (paid, D-4) are still wired |
| Wiring, repositories (`bars` already constructed and unused), `pricing.refresh`, catalogue refresh | `src/infra/container.ts` L162-360 | Where the engine registry and `BackfillInstrumentHistory` must be constructed |
| `BackfillInstrumentHistory` (written, resumable, never constructed) | `src/app/pricing.usecases.ts` L61-124; `RefreshPrices` L172-202 | The backfill entry point to wire |
| `price_quotes` / `price_bars` / `fx_rates` shapes, bitemporal keys, check constraints | `src/infra/db/schema.ts` L980-1040, L1178-1218, L1974-2004 | Bars are scaled 1e8 with `high >= low` and open/close-in-range checks; the bars table is currently unwritten |
| Master ingestion (Upstox NSE only; no BSE; no quote-key reconciliation) | `src/infra/instrument-catalog.ts` L11-15, L23-87, L164-248 | Where the ISIN-keyed catalogue and the quote-key gate are seeded |
| The blind quote key | `app/(root)/investments/catalog-actions.ts` L210 (`quoteRef: input.symbol.toUpperCase()`), L126, L198 | The defect to fix; MANUAL mode currently invents a quote key |
| Catalogue to portfolio identity mapping | `app/(root)/investments/entry-identity.ts` L36-52 | Where `quoteRef` is derived for CATALOG mode |
| Existing search-driven add flow to EXTEND (search action, combobox, confirm gate) | `app/(root)/investments/new/page.tsx`, `app/(root)/investments/new/instrument-search.tsx`, `app/(root)/investments/new/record-investment-form.tsx`, `app/(root)/investments/catalog-actions.ts` L78-84 | Do not rebuild; add as-you-type and the priceability gate here |
| Holding page composition | `app/(root)/investments/[instrumentId]/page.tsx` | Where the price chart and XIRR/P&L panel land |
| Chart primitives (`Chart`, `LineSeries`, reduced-motion context, `CHART_SERIES`) | `src/ui/charts.tsx` L52-348 | Reuse; do not add a charting dependency |
| `xirr` bracket-then-Newton | `src/domain/portfolio.ts` L106-190 | The XIRR used; the float transcription in the spike is NOT this |
| `ValuePortfolio` (ledger cost basis, FX conversion) and the XIRR flow builder | `src/app/investing.usecases.ts` L719-815, L899-941 | Where instrument-level P/L and XIRR already come from the ledger |

## Decisions and constraints

Sources and licensing

- **C1 — Free and keyless only.** No paid API, no trial key, no free tier below ~500 req/day.
  Already eliminated with evidence, do not revisit: Stooq (JS proof-of-work), `nseindia.com/api/*`
  (403), Yahoo `v7`/`v6`/`quoteSummary` (401), `exchangerate.host` (key-walled), Polygon/Massive,
  Alpha Vantage, EODHD free (20/day), IEX Cloud (retired), Kite/SmartAPI quotes, GLEIF, Wikidata,
  SEC EDGAR full-text, Tickertape, `api.bseindia.com` index paths, niftyindices `Backpage.aspx`,
  Groww chart v4, and the public-apis registries as a discovery mechanism.
- **C2 — Market data is prices and FX only.** The owner logs every buy, sell, split, bonus,
  dividend and demerger himself. `CorporateActions` is **optional, reconciliation-only**: a
  provider-observed split with no matching ledger entry raises a *warning*; it never mutates the
  ledger.

Correctness traps that must be designed around

- **C3 — SPLIT DOUBLE-ADJUSTMENT TRAP (highest-severity correctness risk).** Yahoo (and Nasdaq)
  retroactively restate historical closes into **post-split terms**, *and* the owner logs the split
  himself. Deriving a position or a cost line from the series therefore double-applies the factor:
  measured **40x wrong for NVDA, 4x for AAPL, 2x for RELIANCE, 5x for IRCTC**. Rules: cost basis
  comes **only** from the ledger (price x quantity as traded); to plot a ledger quantity or cost
  line against an adjusted series, the ledger quantity/price must first be **normalised to
  current-share terms** by the cumulative factor of every split the owner logged *after* that trade
  date. This gets its own implementation step and its own test (step 13).
- **C4 — Never `range=max`.** It returns 200 with monthly data (AAPL 169 rows instead of 11 529).
  Always explicit `period1`/`period2`. `stockanalysis.com`'s `MAX` lies the same way.
- **C5 — Stored bars are mutable.** A new split rewrites the whole prior series, so `price_bars`
  needs a re-backfill trigger on a newly observed split event, exploiting the bitemporal
  `ingestedAt` + `supersededBy` columns rather than overwriting.
- **C6 — Symbols die.** `TATAMOTORS.NS` returns 404 after the demerger. A quote key validated at
  ingest needs periodic re-validation, a `quoteStale` degrade path (stop offering it in search, keep
  the holding valued at last known close with a visible badge) and **never** a retro-delete.
- **C7 — Demergers are unadjusted and unsignalled** (`TMPV.NS` -40.2%, no event). Corrupt prints
  exist and pass schema validation (RELIANCE 2005-07-28 +337%, NIFTYBEES divided by 10). An
  unexplained-move alarm (single-day move beyond 25% with no logged action and no provider event)
  is mandatory, not optional.
- **C8 — Integer money only.** `moneyMinor` for money; `priceScaled` / `quantityScaled` at 1e8 for
  prices, quantities and bars; FX at the `fx_rates` scale. **No floats anywhere in the path.**
  The `price_bars` check constraints (`high >= low`, open/close within range, positive) must be
  satisfied by construction, not validated in a caller.

Identity and sourcing

- **C9 — Canonicalise Indian equities to `.NS`.** `.BO` truncation is symbol-specific and hits
  exactly the dual-listed blue chips (RELIANCE/INFY/HDFCBANK/ITC/SBIN/MRF all 41 rows from
  2026-07-17). BSE-only scrips are a **full tier at 96% priceable**, not a degraded one; the Upstox
  BSE master's `instrument_type` is a **BSE group code**, so filtering on `"EQ"` yields zero rows
  and `F`/`G` are debt.
- **C10 — The gate is structural.** A catalogue row is indexed for search only when a quote key
  resolved on the history endpoint with a matching `meta.currency` and an `EQUITY`/`ETF` type.
  Reconciliation happens at ingest, offline — never under the user's cursor.
- **C11 — Search: the local catalogue is the ranker.** Yahoo search is a candidate generator only
  (74% intent accuracy; ADRs outrank home listings; zero typo tolerance for company names). Fuzzy
  match in-process over the ~30 000-row catalogue with a home-listing boost and `.`-to-`-` query
  normalisation. Moneycontrol autosuggest (keyless; fixes 5 of 7 known failures; its history sibling
  403s behind Akamai) and Groww search are **offline alias harvesters**, never keystroke
  dependencies. OpenFIGI (keyless, 25 req/min, 10 jobs/request) is an `InstrumentMaster` adapter
  only — its free-text search ranks futures and options first.
- **C12 — Failover chains.** History: Yahoo, then `api.nasdaq.com/api/quote/{s}/chart` (US) or
  NSE+BSE bhavcopy (IN); Nasdaq is an independent **transport** but likely a shared upstream, so it
  is a failover and **not a cross-check oracle**. Quote: Yahoo, then Moneycontrol
  `pricefeed/{nse,bse}`. FX: Frankfurter, then Exchangerate.dev, then currency-api (today only).
  **Never mix FX rate types inside one portfolio's history** (ECB fixing vs indicative live vs
  Yahoo market rate differ ~0.18%); Frankfurter's INR series starts 2000-01-13 and silently clamps
  earlier requests.
- **C13 — UA hygiene, not rate ceilings.** 775 Yahoo requests in one hour from one IP produced zero
  429s; a single request with a `curl`/`python-requests` UA 429s cold, 3 of 3. A 23-byte
  `Edge: Too Many Requests` body means *wrong User-Agent*, not *slow down*. Keep
  `FetchHttpClient`'s browser-shaped UA and keep the existing token-bucket budget as politeness.
  Research defects **D-1 and D-2 are refuted — do not "fix" them.** D-3 (`NseQuoteProvider` dead),
  D-4 (`ZerodhaQuoteProvider` paid), D-5 (`EcbFxProvider` 90-day EUR-only) and D-6 (BSE master
  missing) stand.
- **C14 — Payload, not request count, is the cost.** Full-history payloads are ~850 KB each; 50
  instruments is roughly 45 MB per full backfill. Backfill once, then fetch deltas.

Process

- **C15 — OPEN BLOCKER: deployment egress is UNMEASURED.** Every probe across both research rounds
  and the spike came from one Indian residential IP. Yahoo, Akamai-fronted NSE/Moneycontrol, the
  Upstox CDN, Nasdaq and OpenFIGI may all behave differently from cloud egress. **Step 1 is a
  throwaway probe route, deleted after measuring, and it blocks steps 3-8.**
- **C16 — Preserve unrelated work; never stage or commit.** The working tree holds the owner's
  changes. Leave everything unstaged.
- **C17 — Read `node_modules/next/dist/docs/` before touching any Next.js API or convention**
  (route handlers, server actions, caching, `connection()`), per AGENTS.md.
- **C18 — Prior art, shape only:** Ghostfolio `apps/api/src/services/data-provider/` (TypeScript,
  AGPL — copy the shape, not the code) and OpenBB's `Provider`/`Fetcher` split.

## Step-by-step plan

Tasks are ordered so the egress blocker clears first, ports and adapters land before any UI, and
each file has exactly one owning task. Tasks sharing a file are sequential by construction.

### Phase 0 — unblock

- [x] 1. **Throwaway egress probe route.** Fetch, via the repo's own `FetchHttpClient`, and log
      status plus row/byte count for: Yahoo `v8/finance/chart/RELIANCE.NS?period1=0&period2=<now>&interval=1d`,
      Yahoo `v1/finance/search?q=relia`, `nsearchives.nseindia.com/content/equities/EQUITY_L.csv`,
      `assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz`,
      `api.frankfurter.dev/v1/latest?base=USD&symbols=INR`, `api.nasdaq.com/api/quote/AAPL/chart`,
      `priceapi.moneycontrol.com/pricefeed/nse/equitycash/RI`, `api.openfigi.com/v3/mapping`.
      Hit it 10 times, 30 s apart. PASS = 200 on all, 10 of 10, and more than 7000 rows on the Yahoo
      chart call. **Delete the route in the same task once measured** and paste the numbers into
      "QA record".
      — Owner: DevOps Expert — Files: `app/api/_probe/route.ts` (created and deleted)
      — Verify: recorded status table; `npm run lint`; `git status` shows the route gone
- [x] 2. **Record the egress verdict and gate the chain.** If any host fails from deployment egress,
      demote it in C12 before its adapter is written; escalate if the Yahoo chart call fails (the
      primary stack must then be re-planned onto the bhavcopy archive).
      — Owner: Planner/Implementer — Files: this plan — Verify: C12 updated and dated

### Phase 1 — ports and engine seam (no behaviour change)

- [x] 3. **Ports layer.** `SymbolSearchPort`, `LiveQuotePort`, `HistoricalSeriesPort`, `FxRatePort`,
      `InstrumentMasterPort`, optional `CorporateActionsPort`. Every historical result carries
      `adjusted: boolean`, `currency`, `asOf`; every FX result carries the `effectiveDate` the
      source actually used; every quote carries `asOf` plus staleness. Types only — integer-scaled
      values (C8), no floats in a signature.
      — Owner: Backend Expert — Files: `src/market-data/ports/index.ts`, `src/market-data/ports/types.ts`
      — Verify: `npm run typecheck`
- [x] 4. **Registry and chain.** Capability x market to an ordered adapter chain, with
      **per-instrument vendor pinning** (a catalogue row records which adapter resolved it),
      circuit-aware failover reusing `PriceProvider`'s breaker, and a rule that refuses to mix
      `adjusted` with unadjusted, or one FX rate type with another, inside a single series.
      — Owner: Backend Expert — Files: `src/market-data/engine/registry.ts`,
      `src/market-data/engine/chain.ts` — Verify: `npm test`; `npm run typecheck`
- [x] 5. **Engine unit tests** (fake adapters only, no network): chain failover, vendor pinning,
      adjusted/unadjusted refusal, FX rate-type refusal, `effectiveDate` propagation.
      — Owner: Backend Expert — Files: `tests/market-data-engine.spec.ts`, `tests/doubles.ts` (additive only)
      — Verify: `npm test`

### Phase 2 — adapters (each file disjoint; all reuse `PriceProvider` machinery)

- [x] 6. **Global adapters.** `yahoo-chart` (quote plus history, IN and US; explicit
      `period1`/`period2` per C4; keep the existing currency guard; parse `events=div,split` for
      reconciliation only) and `yahoo-search` (candidate generator; filter `quoteType` to
      `EQUITY`/`ETF`; `.`-to-`-` on the query). Port the logic out of `YahooQuoteProvider`; leave the
      old class in place until step 10.
      — Owner: Backend Expert — Files: `src/market-data/adapters/global/yahoo-chart.ts`,
      `src/market-data/adapters/global/yahoo-search.ts` — Verify: `npm test`; `npm run typecheck`
- [x] 7. **India adapters.** `moneycontrol-quote` (`pricefeed/{nse,bse}`, the BSE dual-listing
      failover), `nse-bhavcopy-history` and `bse-bhavcopy-history` (official, **unadjusted**, must
      declare `adjusted: false`), `nse-equity-master`, `upstox-master` (**add the BSE master**, D-6 —
      filter by BSE *group code*, never `"EQ"`, per C9), `nse-index-close` (`ind_close_all_*.csv`,
      from ~2013). Moneycontrol's history path is 403-blocked — do not implement it.
      — Owner: Backend Expert — Files: `src/market-data/adapters/india/moneycontrol-quote.ts`,
      `.../india/nse-bhavcopy-history.ts`, `.../india/bse-bhavcopy-history.ts`,
      `.../india/nse-equity-master.ts`, `.../india/upstox-master.ts`, `.../india/nse-index-close.ts`
      — Verify: `npm test`; `npm run typecheck`
- [x] 8. **International, symbology and FX adapters.** `nasdaq-chart-history` (US failover),
      `stockanalysis-quote` (third line), `sec-master`, `nasdaq-trader-master`;
      `symbology/openfigi-mapping` (batched 10 jobs, at most 25 req/min, persist `shareClassFIGI` as
      the rename-proof identity); `fx/frankfurter` (primary, persist the returned date),
      `fx/exchangerate-dev`, `fx/currency-api-cdn` (today only).
      — Owner: Backend Expert — Files: `src/market-data/adapters/international/*.ts`,
      `src/market-data/adapters/symbology/openfigi-mapping.ts`, `src/market-data/adapters/fx/*.ts`
      — Verify: `npm test`; `npm run typecheck`
- [x] 9. **Local search adapter and manual tier.** In-process fuzzy ranker over the catalogue with a
      home-listing boost, `.`-to-`-` normalisation and an ISIN-keyed alias table; `manual/` for
      user-entered prices, explicitly flagged as not live-priced.
      — Owner: Backend Expert — Files: `src/market-data/adapters/local/catalogue-ranker.ts`,
      `src/market-data/adapters/local/alias-table.ts`,
      `src/market-data/adapters/manual/manual-prices.ts` — Verify: `npm test`

### Phase 3 — persistence, catalogue gate and wiring

- [x] 10. **Container wiring.** Construct the engine registry; build `BackfillInstrumentHistory`
      (already written at `src/app/pricing.usecases.ts` L61) with the existing `bars` repository and
      expose it on the service bag; retire `NseQuoteProvider` (D-3) and gate `ZerodhaQuoteProvider`
      (D-4) out of the default chain; replace `EcbFxProvider` as FX primary with Frankfurter (D-5),
      keeping ECB as a third line. Keep `FetchHttpClient`'s User-Agent unchanged (C13).
      — Owner: Backend Expert — Files: `src/infra/container.ts`, `src/infra/providers.ts`
      (`shippedQuoteProviders` / `shippedFxProviders` only) — Verify: `npm run typecheck`; `npm test`
- [x] 11. **Bars persistence and re-backfill on a new split.** Write daily bars into the existing
      `price_bars` table at 1e8 scale, satisfying every check constraint by construction; use
      `ingestedAt`/`supersededBy` so a split-driven restatement supersedes rather than overwrites
      (C5). Add the coverage and gap queries the chart needs.
      — Owner: Database/Data Expert — Files: the existing `DrizzleBarRepository` source file under
      `src/infra/db/`, `tests/bars.spec.ts`
      — Verify: `npm run db:check`; `npm test`
- [x] 12. **Quote-key reconciliation and the `quoteStale` degrade path.** At master ingest, derive
      the candidate key (`<symbol>.NS` then `.BO`; US ticker with `.`-to-`-`), probe the history
      endpoint, and index the row **only** when it returns at least one bar with a matching currency
      and an `EQUITY`/`ETF` type; record `firstTradeDate` at the same moment. Add periodic
      re-validation, mark dead keys `quoteStale`, never delete (C6, C10).
      — Owner: Backend Expert — Files: `src/infra/instrument-catalog.ts`,
      `src/domain/instrument-catalog.ts`, `tests/instrument-catalog.spec.ts`
      — Verify: `npm test`; `npm run typecheck`
- [x] 13. **Split-normalisation service and the trap test.** One function converting a ledger
      quantity/price as traded into current-share terms using the cumulative factor of the owner's
      own logged splits after that trade date, plus its inverse. Integer-only. **The test asserts
      the NVDA (40x) and AAPL (4x) cases**: a 2021 NVDA buy plotted against today's adjusted series
      must not be understated, and cost basis must come from the ledger unchanged (C3). The test
      must fail if the normalisation is removed.
      — Owner: Backend Expert — Files: `src/domain/split-normalisation.ts`,
      `tests/split-normalisation.spec.ts` — Verify: `npm test`
- [x] 14. **Unexplained-move alarm and unlogged-action reconciliation.** Flag any single-day move
      beyond 25% with no logged corporate action and no provider event; flag a provider-observed
      split the ledger does not have. A warning surface only — it never mutates the ledger (C2, C7).
      — Owner: Backend Expert — Files: `src/app/pricing.usecases.ts` (additive; do not alter
      `BackfillInstrumentHistory`'s resume logic), `tests/pricing-reconciliation.spec.ts`
      — Verify: `npm test`
- [x] 15. **Backfill and delta cron route.** A route handler that backfills a newly added
      instrument's full history once (explicit `period1`/`period2`) and thereafter fetches only the
      delta; idempotent, resumable, authorised, and budgeted for ~850 KB per full backfill (C14).
      Read the local Next.js route-handler and caching docs first (C17).
      — Owner: DevOps Expert — Files: `app/api/cron/market-data/route.ts`,
      `app/api/instruments/[instrumentId]/backfill/route.ts`
      — Verify: `npm run build`; `npm run lint`; documented manual invocation with recorded output

### Phase 4 — UI (only after Phase 3 lands)

- [x] 16. **Extend the existing add flow — do not rebuild.** Add debounced as-you-type search to
      `instrument-search.tsx` (keeping the existing combobox roles, `aria-activedescendant`,
      keyboard handling and the explicit confirm step); label every candidate with exchange and
      currency; render a non-priceable candidate as **visibly unaddable** and disable confirm for it.
      Loading, empty, error and reduced-motion states included.
      — Owner: Frontend Expert — Files: `app/(root)/investments/new/instrument-search.tsx`,
      `app/(root)/investments/new/record-investment-form.tsx`
      — Verify: `npm test`; `npm run lint`
- [x] 17. **Server-side priceability gate and the `quoteRef` fix.** In `resolveIdentity`, replace the
      blind `quoteRef: input.symbol.toUpperCase()` (catalog-actions.ts L210) with the
      engine-resolved quote key; reject a CATALOG selection whose catalogue row has no quote key or
      is `quoteStale`; route MANUAL mode to the manual tier with an explicit not-live-priced flag
      rather than a fabricated key. Mirror the change in `entry-identity.ts` L36-52.
      — Owner: Backend Expert — Files: `app/(root)/investments/catalog-actions.ts`,
      `app/(root)/investments/entry-identity.ts`, `tests/investment-entry.spec.ts`
      — Verify: `npm test`; `npm run typecheck`
- [x] 18. **Instrument-page price chart.** Inception-to-today daily series from `price_bars` with the
      live last price appended, built on `src/ui/charts.tsx` (`Chart`, `LineSeries`, the existing
      reduced-motion context and `CHART_SERIES`) — **no new charting dependency**. Range selector,
      loading/empty/error states, and a staleness badge when the quote key is `quoteStale`.
      — Owner: Frontend Expert — Files:
      `app/(root)/investments/[instrumentId]/price-history-chart.tsx`,
      `app/(root)/investments/[instrumentId]/page.tsx`
      — Verify: `npm test`; `npm run lint`
- [x] 19. **Comparison view.** Two or more instruments plus a benchmark (`^NSEI` from 2007,
      `^BSESN` from 1997) normalised to 100 at a common start date, on one axis. Accessible legend,
      mobile layout, empty and partial-coverage states.
      — Owner: Frontend Expert — Files: `app/(root)/investments/compare/page.tsx`,
      `app/(root)/investments/compare/comparison-chart.tsx`
      — Verify: `npm run build`; `npm run lint`
- [x] 20. **XIRR and P/L panel over the ledger.** Reuse `ValuePortfolio`
      (`src/app/investing.usecases.ts` L719-815) and the instrument-scoped XIRR flow builder
      (L899-941) with the domain `xirr` (`src/domain/portfolio.ts` L106) — **not** a float
      transcription. Cost basis from the ledger only; any ledger overlay on the adjusted chart passes
      through step 13's normalisation. Unpriced and partially-priced positions render explicitly,
      never as zero.
      — Owner: Frontend Expert — Files: `app/(root)/investments/[instrumentId]/returns-panel.tsx`,
      `app/(root)/investments/[instrumentId]/page.tsx` (sequential after step 18)
      — Verify: `npm test`; `npm run typecheck`

### Phase 5 — gate

- [x] 21. **Documentation sweep.** Update this plan's checkboxes, C12 and the handoffs; record the
      egress numbers; note the residual demerger maintenance cost. No secrets.
      — Owner: Planner/Implementer — Files: this plan, `_architecture/00-INDEX.md` (link only)
      — Verify: `rg` shows no `.env` value or token in any changed Markdown
- [x] 22. **QA GATE — independent Testing/QA Agent.** Must not be any agent that implemented a step.
      Verify every acceptance criterion; re-read the changed files rather than trusting summaries;
      confirm no float entered the money/price path (C8); confirm the split double-adjustment test
      genuinely fails when the normalisation is removed; confirm no paid or keyed source was added;
      confirm the probe route from step 1 is gone; confirm nothing is staged or committed.
      — Owner: Testing/QA Agent — Files: read-only across the diff
      — Verify: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run db:check`
      — all five recorded with actual output

## Handoffs

### Research Agent (rounds 1 and 2) plus Experiment Agent -> Planner/Implementer

- Goal: decide, with live probes and measurements, a free keyless stack for search, live quote,
  full history and FX across IN and US, and map it onto swappable adapter capabilities.
- Completed: roughly 900 live probes on 2026-09-13 across three documents. Yahoo `v8/chart` primary
  confirmed (RELIANCE.NS 7716 rows from 1996, AAPL 11 529 from 1980, 220/220 NSE catalogue
  resolution, 775 requests per hour with zero 429s). Frankfurter FX confirmed (6824 points from
  2000-01-13). Registries swept and found near-worthless; OpenFIGI, Moneycontrol and
  `api.nasdaq.com` were found outside them.
- Decisions: D1-D8, X1-X8, R1-R12 — carried into C1-C18 above.
- Inputs: the three requirement documents named in the Context map.
- Changed files: three Markdown documents. No production code touched.
- Contract/output: the source-to-capability matrix, the 16-item trap list, the adapter folder
  layout, and the confirmed/refuted status of defects D-1..D-6.
- Verification: probe scripts and captured output in the session scratchpad; no repository command
  run, because neither lane changed repository code.
- Open risks: **deployment egress unmeasured (AA8)**; demergers have no free automated fix; three
  adopted sources are undocumented site endpoints with no ToS grant.
- Next action: run the egress probe (step 1), then implement Phases 1-4 in order.
- Do not revisit: every source listed as eliminated in C1; research defects D-1 and D-2 (refuted).

### Planner/Implementer -> DevOps Expert (step 1)

- Goal: measure the eight endpoints in step 1 from real deployment egress.
- Inputs: step 1's endpoint list; `src/infra/providers.ts` `FetchHttpClient` — use it unmodified,
  because its browser-shaped User-Agent is the thing being validated (C13).
- Contract/output: a status and row-count table for 10 runs, pasted into "QA record" below.
- Open risks: the Akamai-fronted hosts (NSE archives, Moneycontrol) are the most likely to differ.
- Next action: run it, record it, delete the route, hand back. **Steps 3-8 are blocked until then.**
- Do not revisit: adding a second HTTP client, or changing the User-Agent.


### Backend + Database/Data Expert -> Frontend Expert (Phase 3 complete, steps 10-15)

- Goal: wire the engine into the container, write daily bars, gate the catalogue on
  priceability, close the split double-adjustment trap, add the unexplained-move alarm,
  and expose a backfill/delta cron route.
- Completed: steps 10-15. `npm run typecheck`, `npm test` (60/60 spec files),
  `npm run db:check` (16 of 16 migrations), `npm run lint` (0 errors, 42 pre-existing
  warnings) and `npm run build` all run and green. Nothing staged, nothing committed.
- Decisions:
  - **D-6 root cause found and fixed.** `assets.upstox.com` serves `NSE.json.gz` and
    `BSE.json.gz` as **raw gzip with no `content-encoding` header** (measured: 1 940 184
    bytes starting `1f 8b`, `content-type: application/gzip`). `fetch` does not
    decompress it, `response.text()` mangles it and `JSON.parse` throws, so
    `UpstoxPublicInstrumentMaster` has been silently reporting "unavailable" and the
    catalogue never ingested. Added `HttpClient.getDecoded` (optional) and
    `MarketDataSource.getDecodedText`, which sniff the gzip magic bytes and inflate.
    `FetchHttpClient`'s User-Agent is byte-identical on both paths (C13).
  - **BSE group codes measured live, not guessed.** 12 878 `BSE_EQ` rows; filtering on
    `"EQ"` matches **0**, the group-code set matches **5 154**. Census recorded in the
    doc comment on `BSE_EQUITY_GROUP_CODES`. `F` (6 532, debt) and `G` (1 127, G-secs)
    excluded; `E` (mutual funds) and `IF` (InvITs/REITs) excluded as not-equity.
  - **`price_bars` is written by a new use case, not by `BackfillInstrumentHistory`.**
    The two fill different tables for different purposes — `price_quotes` is the number
    a holding is *valued* at (price ladder), `price_bars` is the series a chart is
    *drawn* from (engine history chain) — and each resumes from its own coverage.
    `BackfillInstrumentHistory` is now constructed unchanged as `pricing.backfill`;
    `IngestInstrumentBars` is `pricing.ingestBars`.
  - **`quoteStale` never deletes** and keeps the dead key, so the badge can name the
    symbol that died.
  - **Zerodha is opt-in, not credential-driven.** `ALLOW_PAID_QUOTE_PROVIDERS=true` is
    now required on top of the key; `NseQuoteProvider` is out of the chain entirely.
- Changed files: see the QA record below.
- Contract/output for the Frontend agent:
  - `CatalogSearchCandidateOutput` now carries **`priceable`**, `quoteKey`, `quoteStale`
    and `firstTradeDate`. Step 16's "visibly unaddable" candidate is `priceable === false`;
    `quoteStale === true` is the staleness badge of step 18.
  - `services().pricing.ingestBars`, `services().pricing.backfill`,
    `services().marketData.{chain, registry, describeChains, reconcileQuoteKeys,
    moneycontrolScIds}`.
  - `BarRepository` gained `restate(bars)` and `gaps(instrumentId, granularity, range)`.
    `gaps` is what step 18's chart needs — `coverage` reports only outer bounds, so a
    series missing all of 2019 looks complete to it.
  - `src/domain/split-normalisation.ts`: `normaliseTrade(trade, splits)` is what step 20
    must pass a ledger quantity/price through before drawing it on the adjusted chart.
  - `POST /api/instruments/<id>/backfill` (session or cron bearer);
    `GET /api/cron/market-data` now also ingests bars and runs the quote-key sweep.
- Verification: the five commands above, plus live smoke calls on 2026-09-13 from the
  dev machine (still **not** cloud egress — C15 stays open): Yahoo chart 200 with
  `meta.firstTradeDate`/`instrumentType`; `TATAMOTORS.NS` **404 confirmed**; Upstox NSE
  and BSE 200 as raw gzip; Frankfurter 200; Moneycontrol autosuggest 200 with `sc_id` in
  `link_src`; `api.exchangerate.dev` 200; jsDelivr currency-api 200; `api.nasdaq.com`
  chart 200. **Not smoke-tested:** NSE `sec_bhavdata_full`, BSE BhavCopy,
  `ind_close_all`, stockanalysis, nasdaqtrader `.txt` — none of steps 10-15 depends on
  them; they are failover-only and remain unverified against a live response shape.
- Open risks: listed under "Residual risks" below.
- Next action: Phase 4, step 16.
- Do not revisit: the `.NS`-then-`.BO` candidate order, the BSE group-code filter, the
  gzip fix, or the 25% alarm threshold — all three are now measured rather than assumed.

### Deviations from the plan, and why

1. **Step 11's file was not under `src/infra/db/`.** `DrizzleBarRepository` lives in
   `src/infra/repositories.ts` (line ~1644), not in `src/infra/db/`. Edited it in place
   rather than moving it, per AGENTS.md rule 9 (no opportunistic refactors).
2. **Step 11 also touched `src/domain/analysis.ts` and `tests/doubles.ts`.** `restate`
   and `gaps` are additions to the `BarRepository` *port*, and `tests/bars.spec.ts` runs
   its conformance block against both implementations — a method on only one of them is
   a contract the double cannot answer.
3. **The bar *writer* went into `src/app/pricing.usecases.ts`, which is step 14's file.**
   Both are additive, both are in the same file, and step 14's constraint — do not alter
   `BackfillInstrumentHistory`'s resume logic — is honoured: that class is untouched.
4. **Two new files the plan did not name.** `src/infra/market-data.ts` builds the engine
   and holds the three bridges back to the older ports (`FxProviderPort`,
   `DailyHistoryFeed`, `QuoteKeyProbePort`); putting that in `container.ts` would have
   made the composition root import sixteen adapters directly. `src/infra/db/migrations/
   0015_catalog_quote_keys.sql` adds the six catalogue columns the gate needs.
5. **Step 12's gate is *exposed*, not yet *enforced* at the add path.** `search()` now
   returns `priceable` on every candidate, and the reconciler is what sets it. Rejecting
   a non-priceable selection server-side is **step 17**, which is Phase 4 and explicitly
   outside this assignment. Until step 17 lands, an unpriceable candidate is *labelled*
   unaddable but not yet *refused*.
6. **`YahooChartAdapter` gained `probeQuoteKey`** (a Phase 2 file). The gate needs
   `meta.currency`, `meta.instrumentType` and `meta.firstTradeDate`, which
   `HistoricalSeries` does not carry, and asking for them through `history` would
   download ~850 KB per catalogue row instead of a seven-day window.
7. **`shippedFxProviders` takes injected primaries** rather than constructing a
   Frankfurter provider inside `providers.ts`, so the FX adapters written in step 8 are
   used rather than duplicated and `providers.ts` does not import the engine.
8. **The FX chain is Frankfurter -> Exchangerate.dev -> currency-api -> ECB**, four
   deep rather than the three the step describes. ECB is last, as asked.

### Residual risks handed to Phase 4 and to QA

- **C15 is still open.** Every probe in this phase came from the same Indian residential
  IP as every prior one. Yahoo, the Upstox CDN, Akamai-fronted Moneycontrol and
  `api.nasdaq.com` may all behave differently from cloud egress.
- **The vendor pin is in memory, not on the row.** `quote_provider` is written by the
  reconciler but the registry reads `InMemoryVendorPins`, so a pin does not survive a
  request. Correct but not yet load-bearing; wiring it is a read per chain lookup.
- **The cron sweep's quote key is a conservative guess** (`<symbol>.NS` for INR, the bare
  ticker for USD) for instruments whose catalogue row is not linked. The per-instrument
  backfill route probes properly before it uses anything; the sweep does not, so a
  holding whose symbol differs from its NSE ticker will be skipped rather than
  mis-filled — it fails closed, but it does fail.
- **Five adapters remain unverified against a live response shape**: NSE
  `sec_bhavdata_full`, BSE BhavCopy, `ind_close_all`, stockanalysis, nasdaqtrader `.txt`.
  All are failover-only.
- **`price_bars` has no per-exchange trading calendar.** `gaps` reports weekday holes, so
  a market holiday reads as a small gap. Deliberate: over-reporting a holiday is
  harmless, under-reporting a real hole draws a chart that lies.
- **A restatement is triggered by a caller, not detected.** `IngestInstrumentBars` takes
  `restate: true`; nothing yet watches for a newly logged split and sets it. The
  `UNLOGGED_SPLIT` alarm is the manual half of that loop.

## QA record

Status: PASS_WITH_RISKS (independent Testing/QA Agent, 2026-09-13) (independent QA is step 22; the five commands below were run by the
implementing agent and are evidence, not approval)

### Phase 3 (steps 10-15) - files changed, 2026-09-13

Nothing staged, nothing committed (C16). `git status` after the phase:

Modified:
- `app/api/cron/market-data/route.ts` - bars delta + quote-key sweep, bearer gate kept
- `src/app/pricing.usecases.ts` - additive: `IngestInstrumentBars`, `detectPriceAlarms`
- `src/core/config.ts` - `allowPaidQuoteProviders`
- `src/domain/analysis.ts` - `BarRepository.restate` / `.gaps`, `weekdayGaps`
- `src/domain/instrument-catalog.ts` - the priceability gate types and predicates
- `src/infra/container.ts` - engine, `pricing.backfill`, `pricing.ingestBars`, `marketData.*`, BSE master
- `src/infra/db/schema.ts` - six catalogue columns and two indexes
- `src/infra/db/migrations/meta/_journal.json` - entry 15
- `src/infra/instrument-catalog.ts` - gzip fix, BSE master, reconciler, sc_id harvester
- `src/infra/providers.ts` - `getDecoded`, `shippedQuoteProviders`, `shippedFxProviders`
- `src/infra/repositories.ts` - bar `restate`/`gaps`, catalogue quote-key methods
- `src/market-data/adapters/global/yahoo-chart.ts` - `probeQuoteKey`
- `src/market-data/adapters/india/upstox-master.ts` - `getDecodedText`, group census
- `src/market-data/engine/source.ts` - `getDecodedText`
- `tests/bars.spec.ts`, `tests/doubles.ts`, `tests/instrument-catalog.spec.ts`,
  `tests/investment-entry.spec.ts`, `tests/live-data.spec.ts`

Added:
- `app/api/instruments/[instrumentId]/backfill/route.ts`
- `src/domain/split-normalisation.ts`
- `src/infra/market-data.ts`
- `src/infra/db/migrations/0015_catalog_quote_keys.sql`
- `tests/pricing-reconciliation.spec.ts`, `tests/split-normalisation.spec.ts`

Commands, all run on 2026-09-13:
- `npm run typecheck` - clean
- `npm test` - 60/60 spec files passed
- `npm run db:check` - 16 of 16 migrations applied, 48 of 48 tables, reference data in step
- `npm run lint` - 0 errors, 42 warnings (all pre-existing `no-unused-vars`; 3 new ones
  are underscore-prefixed unused parameters in `tests/doubles.ts`, matching the
  repository's existing style in `src/core/kernel.ts`)
- `npm run build` - compiled successfully; `/api/instruments/[instrumentId]/backfill`
  and `/api/cron/market-data` both listed as dynamic

The trap test was verified to fail without the normalisation: stubbing
`normaliseQuantity` to return its argument turns `tests/split-normalisation.spec.ts`
red at **17 of 41 assertions**, including the NVDA 40x and AAPL 4x cases. Restored and
re-run green in the same step.


### Step 1 - egress probe result (2026-09-13)

Run from the **local dev machine**, not from cloud egress, using a browser-shaped User-Agent
equivalent to `FetchHttpClient`'s. A standalone Node script in the session scratchpad was used
instead of creating `app/api/_probe/route.ts`, so **no route was ever added to the repository**
and there is nothing to delete (step 1's intent -- measure, record, leave no trace -- is met more
cheaply). Single pass, not 10x30s; the token-bucket budget was not exercised.

| Endpoint | Status | Bytes | Rows |
|---|---|---|---|
| Yahoo `v8/finance/chart/RELIANCE.NS` (explicit period1/period2) | 200 | 844 344 | **7 716** |
| Yahoo `v1/finance/search?q=relia` | 200 | 9 421 | - |
| `nsearchives.nseindia.com/.../EQUITY_L.csv` | 200 | 181 324 | - |
| `assets.upstox.com/.../NSE.json.gz` | 200 | 1 940 184 | - |
| `api.frankfurter.dev/v1/latest` | 200 | 69 | - |
| `api.nasdaq.com/api/quote/AAPL/chart` | 200 | 152 605 | - |
| `priceapi.moneycontrol.com/pricefeed/nse/equitycash/RI` | 200 | 3 456 | - |
| `api.openfigi.com/v3/mapping` (POST, keyless) | 200 | 69 503 | - |

Verdict: **8/8 200**, Yahoo row count above the 7 000 threshold. C12's chain is unchanged and
Phase 1-2 are unblocked for local development.

**C15 is NOT closed.** This probe shares the residential IP of every prior probe. The Akamai-fronted
hosts (NSE archives, Moneycontrol) and Yahoo remain the likely divergences from cloud egress.
Re-run this probe from the deployment target before trusting the chain in production; if Yahoo
fails there, C12 must be re-planned onto the bhavcopy archive.

Evidence:
- Planning lane. No production code changed by this document; the only file written is this plan.
- `git status` at planning time: `?? _architecture/requirements/` on branch `redesign/v2`.
  Nothing staged, nothing committed.
- `npm run lint` / `typecheck` / `test` / `build` / `db:check` **not run** — this lane changed no
  repository code, so they would verify nothing. They are required at step 22.
### Step 22 - independent QA gate verdict

All five commands green: `lint` 42 warnings / **0 errors**; `typecheck` clean; `npm test`
**60/60 spec files**; `build` compiled, `/investments/compare` and both routes listed dynamic;
`db:check` 16/16 migrations, 48/48 tables.

Adversarially verified rather than read: **C8** (no float in the money path; the single JSON-number
boundary is `scaledFromSourceNumber`), and **C3** - QA stubbed `normaliseQuantity` itself and
measured **17 of 41 assertions red** (AAPL 4x, NVDA 40x, RELIANCE 2x, IRCTC 5x, the ex-date
boundary, the reverse split), then restored and checksum-matched the file. The trap test is
load-bearing, not decorative. Also confirmed: the priceability gate refuses server-side in
`catalogPortfolioIdentity` (not merely a disabled button); the blind `symbol.toUpperCase()` quote
key is gone from both branches; no `range=max` anywhere; no key or secret introduced; the
`FetchHttpClient` User-Agent is byte-identical on both the plain and gzip paths; no probe route
remains; nothing staged or committed.

Defects QA raised that were then FIXED (post-verdict, re-verified 60/60 + typecheck + build):
- `ApplyCorporateAction` persisted `ratioFrom`/`ratioTo` as `""`, leaving `normaliseTrade` blind to
  every logged split. Now persisted from the RESCALE effect, with a regression assertion in
  `tests/investing-integration.spec.ts` (88 assertions).
- **BONUS** emits `OPEN`, not `RESCALE`, so it was still unrecorded - the same C3 error class,
  since Yahoo restates for Indian bonus issues exactly as for splits. Now recorded as the
  share-count ratio `held:(held+received)`, and `loggedSplitsFrom` accepts `BONUS`.
- The stale doc comment in `[instrumentId]/page.tsx` asserting the `""` behaviour was corrected.

Residual risks:
- **Acceptance criterion 1 is NOT met and C15 remains open.** The recorded 8/8 200s came from the
  same Indian residential IP as every prior probe, single pass rather than 10x30s. No tested
  behaviour is wrong, but the plan forbids accepting an adapter that depends on an unmeasured host:
  **re-run the probe from the deployment target before trusting the chain in production.**
- `livePriced` is a confirmation message, not persisted state, and `Instrument.quoteKey()` still
  falls back to `this.symbol`, so a manual holding is still *queried* under its bare symbol. No
  fabricated key is stored. Owner: Backend Expert.
- The compare view never consults `gaps()`; in the single-series, no-benchmark case a hole no series
  covers is skipped off the axis and the line bridges it. Owner: Frontend Expert.
- Corporate actions logged *before* the ratio fix stored `""` and stay skipped until re-logged -
  visibly absent, never quietly wrong.
- Five failover adapters (NSE `sec_bhavdata_full`, BSE BhavCopy, `ind_close_all`, stockanalysis,
  nasdaqtrader `.txt`) have never been matched against a live response shape.
- The vendor pin is in-memory and does not survive a request; `gaps` over-reports market holidays
  (deliberate - over-reporting draws an honest chart, under-reporting draws a lying one).
- **Deployment egress is unmeasured (C15).** The highest-severity open item; step 1 exists to close
  it, and it blocks steps 3-8.
- Demergers have no free automated fix; the manual register plus the unexplained-move alarm is a
  permanent maintenance cost the owner accepts.
- Yahoo, Nasdaq and Moneycontrol are undocumented site endpoints with no ToS grant; every finding
  behind them has a shelf life.
- The Moneycontrol search win is measured on 11 queries chosen from the known failures — treat
  "5 of 7 fixed" as directional until the full 23-query set is re-run.

## 2026-09-14 — field defects found by the owner on first use

The first real search (`infosys`) sat on "Searching..." and every row it eventually
showed read **Not priceable**. Three causes, all fixed; the plan's own constraints
named two of them and the code broke them anyway.

1. **The refresh was awaited inside the keystroke (C10).**
   `searchInstrumentCatalogAction` called `instrumentCatalog.refresh.execute()`
   before the search, once per debounce. The refresh walks five public masters, and
   a source with no successful fetch on record is retried on every call — measured:
   `instrument_catalog_fetches` held rows for `UPSTOX_PUBLIC` and
   `UPSTOX_PUBLIC_BSE` only, so AMFI and SEC were re-attempted every time. Fixed:
   the cache is read first and returned; only an **empty** cache blocks (there is
   nothing else to show); a stale one refreshes in `after()`, deduped per process.
   The regression assertion in `tests/investment-entry.spec.ts` encoded the wrong
   order and has been inverted.

2. **No listing in the catalogue had ever been probed.** Measured: 0 of 17 276 rows
   had a `quote_key`, so `priceable` was false everywhere and *nothing* was
   addable. The sweep is budgeted at 200/run against ~17 000 rows, which is months
   before it reaches a row the owner searched for. Fixed with
   `InstrumentQuoteKeyReconciler.reconcileListings(ids)` +
   `InstrumentCatalogRepository.listingsForQuoteKeyProbe(ids, asAt)`: the search
   schedules probes for the <=12 rows it just showed, in `after()`, after the
   response. C10 still holds — nothing is awaited under the cursor — and the
   due-ness filter is kept, so repeating a query costs one query and no requests.
   Verified against the real catalogue and the live endpoint: 4 probed, 4 resolved,
   `INFY` -> `INFY.NS` via `yahoo-chart`, inception `1996-01-01`.

3. **"Not yet checked" was rendered as "Not priceable".** A queue shown as a
   refusal. `CatalogSearchCandidateOutput` now carries `quoteChecked` (from
   `quote_validated_at`), the badge reads **Checking price source** until the row
   has actually been judged, and the combobox re-reads once after 2.5s so the row
   becomes addable without retyping.

Also fixed: the search input took `form-input`'s `px-3.5` over a plain `pl-9` —
same specificity, later layer — so the magnifier sat on top of the first character.
Now `w-full !pl-9 !pr-10`.

Verification (2026-09-14): `npm test` 60/60, `npm run lint` 0 errors / 42 warnings,
`npm run typecheck` clean, `npm run build` compiled. Nothing staged; HEAD `d37dc98`.

Residual: the other ~17 000 listings are still unprobed and become addable only as
the budgeted sweep or a search reaches them. Running the sweep to completion is a
one-off operational task, not a code change.
