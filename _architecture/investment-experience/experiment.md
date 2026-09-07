# Investment workspace experiment

Status: READY_FOR_QA
Owner: Experiment Agent
Updated: 2026-09-06

## Scope
This is an isolated concept experiment for a professional investment workspace. It does not change production code, does not call broker or market APIs, does not use credentials, and does not imply live trading authorization. The durable mockup fragment is outside the checkout at `D:/WorkStation/Artifacts/stock-mania-investment-20260906/investment-workspace.html`.

## Hypotheses and thresholds
- Progressive disclosure passes if the default Overview renders no more than three primary metrics, exactly one overview chart, and no trade, lease, instrument administration, or strategy parameter forms. Holdings, holding detail, analytics, activity, and Trading Lab must be reachable within two navigation actions from Overview.
- Search-first trade entry passes if a local fixture catalogue supports name or symbol search, shows exchange disambiguation, autofills name, symbol, exchange, asset type, provider key, and ISIN from labeled synthetic metadata, and offers a manual fallback for unknown queries.
- Financial clarity passes if executable prototype functions verify a one-year 10% XIRR fixture, cashflow-neutral linked TWR fixture, gross-to-net cost treatment, and unavailable total gain when a required quote is missing.
- Automation safety passes if the paper-only Trading Lab gate blocks stale data, daily loss-limit breach, duplicate order intent, and kill switch conditions without any network order call.
- Responsive structure passes if the fragment contains scoped product CSS for 320px, 736px, and 1024px layout breakpoints, uses semantic controls, native focusable elements, and no viewport-fixed shell sizes.

## Artifact design notes
- The Overview is intentionally quiet: priced portfolio value, net gain on priced holdings, and return availability are the only metric cards; one inline SVG shows a synthetic value path.
- Holdings is the main working branch, with search/category filters and a selected holding drilldown. Gold lease management appears only inside the selected gold holding's `Income & leases` tab, while ownership remains counted once.
- Analytics uses an on-demand selector. XIRR and TWR are shown as capability states with scope, dates, and unavailable reasons where fixtures lack required valuations.
- Activity is separated from analytics and forms.
- Trading Lab is separated from portfolio management and marked as a paper-only stage. Strategy parameters, modeled costs, and risk gates are visible without any claim of profitability, HFT capability, or regulatory readiness.
- The trade recorder starts with search, then identity selection, then trade facts and expandable charges, then cash-impact review. Unknown searches expose a manual historical-entry fallback.

## Verification
- `node _architecture/investment-experience/experiment-checks.mjs` - PASS
  - Executed at 2026-09-06 after artifact creation.
  - Verifies the real fragment script in a Node VM with a minimal DOM mock.
  - Checks overview metric/chart structure, reconciled priced value scope, navigation depth, incremental holdings filters, selected holding tabs, catalogue search and fallback, visible identity confirmation, side-aware trade cash impact, paise-preserving trade currency, 10% XIRR, linked TWR neutrality, mode-specific analytics states, missing quote unavailable state, and four paper-risk blocks.

## Repair log
- QA returned defects around mixed-scope gain labels, incorrect return basis, side-insensitive trade cash impact, inert form controls, rounded trade currency, chart scope mismatch, mode leakage, and focus-destroying search rerenders.
- Repaired by relabeling the Overview to priced value plus unrealized P&L subtotal, making portfolio return unavailable until a valid external-cashflow scope is selected, reconciling the chart endpoint to the priced holdings subtotal, wiring trade/search/category controls, adding visible instrument identity and manual fallback updates, using two-decimal trade money, making BUY cash out and SELL cash in side-aware, removing unrelated hardcoded trade P&L, and rendering mode-specific analytics/holding chart series.

## Limits
- Browser inspection was not run because the upstream browser connection is unavailable; this experiment does not claim visual QA, keyboard traversal proof, or real responsive rendering.
- All market prices, identifiers, trades, charts, returns, and gate states are synthetic fixtures unless labeled as a calculation definition.
- Regulatory and broker onboarding claims are intentionally absent from the UI. Any live automation path needs a separate approved architecture and compliance review.

## Keep, revise, or discard
Recommendation: KEEP AS A CONCEPT DIRECTION, then revise with user choices before production planning. The experiment satisfies the structural and calculation thresholds for concept approval, but it should not be treated as usability validation or implementation design freeze.

## Baton: Experiment Agent -> QA
- Goal: Verify an isolated professional investment workspace mockup and deterministic synthetic checks.
- Completed: Created `D:/WorkStation/Artifacts/stock-mania-investment-20260906/investment-workspace.html`, `_architecture/investment-experience/experiment-checks.mjs`, and this experiment record.
- Decisions: Lease controls are demonstrated inside holding detail as a pending concept departure; Trading Lab remains paper-only; every calculation and identifier in the mockup is labeled synthetic or unavailable.
- Inputs: `_architecture/70-UPGRADE-PLAN.md` section `Investment experience research and experiment - 2026-09-06`; `_architecture/investment-experience/report-source.md`; visualize skill mockup rules.
- Changed files: `_architecture/investment-experience/experiment.md`; `_architecture/investment-experience/experiment-checks.mjs`; `D:/WorkStation/Artifacts/stock-mania-investment-20260906/investment-workspace.html`.
- Contract/output: Standalone HTML fragment with root `sm-investment-workspace` and `window.StockManiaInvestmentExperiment` exposing `core`, `fixtures`, `state`, `goto`, `selectHolding`, `setHoldingTab`, `openTrade`, `setTradeQuery`, `selectInstrument`, `setTradeField`, `setScenario`, and `snapshot`.
- Verification: `node _architecture/investment-experience/experiment-checks.mjs` passed.
- Open risks: No browser visual/responsive QA due to unavailable browser connection; no user validation; no live data, broker, regulatory, or performance validation.
- Next action: Independent QA should run the check script, inspect the fragment for scope/claim issues, and record PASS/PASS_WITH_RISKS/FAIL in the plan of record.
- Do not revisit: Production Next.js code, broker/API integrations, live trading, or real account data.
