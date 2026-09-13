# Live equities and mutual-fund data experiment

Status: DONE
Owner: Experiment Agent (Sol 5.5 bounded task)
Updated: 2026-09-07

## Scope

This is a reversible research spike for Indian listed equities and mutual funds. It does not change production code, does not use broker credentials unless the local developer explicitly provides throwaway environment variables, and does not place or prepare orders. Futures, options and automated execution are kept out of scope except where source data shape affects future extensibility.

## Hypotheses and thresholds

1. AMFI latest NAV can resolve an exact mutual-fund scheme by scheme code, ISIN or normalized name tokens and return NAV, valuation date and provenance. Pass threshold: HTTP 200 or redirect-followed 200, parseable semicolon rows, at least one exact Parag Parikh Flexi Cap Direct Growth match, and latest NAV date classified as `NAV_DAILY` or `STALE`, never `LIVE`.
2. Unauthenticated Zerodha quote cannot supply free live price. Pass threshold: an unauthenticated quote probe returns non-2xx or an entitlement/auth error, while the documented authenticated fixture normalizes exact NSE identity and quote metadata.
3. Public instrument discovery can model exact symbol identity without becoming the source of truth for price. Pass threshold: one public master source resolves `INFY` to exchange, trading symbol, ISIN/provider key and provenance, with provider identifiers stored as mappings.
4. The data-state model distinguishes `LIVE`, `EOD`, `NAV_DAILY`, `STALE` and `UNAVAILABLE`. Pass threshold: fixtures and live public probes exercise all five states and checks fail if a stale or NAV value is labelled live.

## Method

Run:

```powershell
node _architecture/live-investment-data/provider-spike.mjs
node _architecture/live-investment-data/provider-spike-checks.mjs
```

The script writes only compact measurements to `D:/WorkStation/Artifacts/stock-mania-live-data-20260907/data/provider-spike-result.json`: HTTP status, counts, small candidate samples, dates, state labels and hashes. It does not persist large raw exchange/broker files or API secrets.

## Decision rule

Keep the architecture if the spike proves a truthful source hierarchy:

- Zerodha Connect paid data for authenticated current prices and broker reconciliation.
- AMFI as official mutual-fund NAV source.
- MFAPI as a convenience cache only after AMFI cross-check.
- Public instrument masters as discovery aids, not canonical identities.
- Fundamentals only through licensed/authenticated APIs or a slower filing-derived model.

Revise if AMFI parsing is broken, a public source cannot resolve exact identities, or the state model mislabels stale/NAV data as live. Discard free-live-equity claims if Zerodha, NSE or BSE cannot provide licensed unauthenticated current quotes.

## Results

KEEP with revisions.

Measured on 2026-09-07:

- `node _architecture/live-investment-data/provider-spike.mjs` exited 0 and wrote `D:/WorkStation/Artifacts/stock-mania-live-data-20260907/data/provider-spike-result.json`.
- `node _architecture/live-investment-data/provider-spike-checks.mjs` exited 0 with 14 assertions.
- Zerodha unauthenticated quote probe for `NSE:INFY` returned HTTP 400 with JSON content and no persisted body; state classified as `UNAVAILABLE`. The credentialed path was skipped because no broker credentials were present.
- AMFI `NAVAll.txt` redirected to `portal.amfiindia.com`, returned HTTP 200, 18,022 lines, and exactly matched Parag Parikh Flexi Cap Fund Direct Plan Growth: scheme code `122639`, ISIN `INF879O01027`, NAV `90.5289`, valuation date `04-Sep-2026`, state `NAV_DAILY`.
- MFAPI search/latest matched scheme code `122639`, valuation date `04-09-2026`, state `NAV_DAILY`.
- Upstox public NSE instrument master returned HTTP 200, 76,431 rows, and resolved `INFY` to `INFOSYS LIMITED`, NSE symbol `INFY`, ISIN `INE009A01021`. The same loose query also matched `HCL-INSYS`, proving the UI needs exchange/security confirmation rather than blind autofill.

Decision:

- Keep the state model and search-to-confirm workflow.
- Revise the architecture to mark Zerodha live/historical market data as paid entitlement, not free.
- Keep AMFI as official mutual-fund NAV authority and MFAPI as convenience cache.
- Treat fundamentals as a separate `FundamentalsProvider`; free official filing sources can populate statements slowly, but current ratios need licensed/authenticated data or derived calculations.
