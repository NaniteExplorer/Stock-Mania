# Independent QA: investment research and isolated experiments

Status: PASS_WITH_RISKS
Date: 2026-09-06
Scope: research and isolated experiment artifacts only. This record does not approve production implementation, live trading readiness, broker eligibility, strategy profitability, or the user-facing concept.

## Acceptance review

| Area | Status | Evidence |
|---|---|---|
| Research claims and boundaries | PASS | `report-source.md` separates repository facts, recommendations, synthetic experiment scope, and unresolved live prerequisites. `claim-ledger.md` maps consequential external claims to first-party or official sources and records limitations. |
| Repository-derived financial claims | PASS | Targeted inspection confirmed `ValuePortfolio` reports zero income, omits closed instruments from its realised-gain aggregate, and has no TWR output; `LotBook` subtracts stored buy charges and deductible sell charges when calculating disposal gain. |
| No live-readiness or profitability claim | PASS | The report explicitly excludes live orders, live account/feed tests, HFT-equivalent infrastructure, and positive expectancy claims. |
| Progressive-disclosure mockup | PASS (structural) | The default fragment exposes three metric cards and one chart, keeps trade/lease/strategy forms out of Overview, and its navigation graph reaches every required branch within two actions. The independent UI command passed against the stable artifact. |
| Search-first identity experiment | PASS_WITH_RISKS | The mockup provides visible exchange disambiguation, synthetic identifier autofill, and a functioning manual fallback. The live-master experiment joined 2,655 NSE cash `EQ` ISINs across both providers, but its frozen exact-name threshold failed at 12/13 because both providers truncate the TCS name. The harness correctly left that query unresolved. |
| Financial fixture checks | PASS_WITH_RISKS | The stable UI harness verifies 10% one-year XIRR, 15.5% linked TWR invariant to external-flow size, side-aware gross/charge cash impact, paise display, and unavailable portfolio gain when a quote is missing. These are narrow synthetic fixtures, not production calculation coverage. |
| Simulated automation controls | PASS_WITH_RISKS | The replay independently reproduced its fixed hash and passed completed-bar/later-fill, exit ordering, matched-path cost monotonicity, stale-data, duplicate-intent, daily-loss, and kill-switch assertions. Its latency sensitivity and intraday loss-path coverage are explicitly weak. |
| Browser visual, responsive and keyboard checks | NOT_RUN | Browser bootstrap returned no available browser. This cannot be inferred from structural or runtime checks. |

## Research review notes

- The report's period-P&L wording avoids adding a lifetime unrealised balance to period realised activity and requires a consistently bounded portfolio with external flows. This is suitable as a design constraint, not a claim that the repository already implements the calculation.
- The current disposal `gain` is not a general economic-net-P&L field: it uses the stored deductible sell-charge amount when supplied and otherwise falls back to total sell charges. The report correctly requires explicit expense allocation and a separate tax-reporting method.
- The provider table treats prices and entitlements as dated observations and does not infer redistribution rights from catalogue access.
- The report now cites NSE's co-location page directly for the HFT infrastructure distinction.

## Defects returned before experiment handoff

Static inspection of the in-progress prototype found acceptance-blocking defects and returned them to the Coordinator for the prototype owner:

- The displayed priced holdings total 5.21 lakh, while the chart using the stated excluded-foreign-holding scope ends at 12.4 lakh.
- The overview summed `value - cost` holding fields, labeled the result "since-inception net gain," and claimed income and costs were included even though neither realised gain nor income participated in the calculation. The latent complete-scope return branch divided this gain by market value rather than cost.
- BUY and SELL share `gross + charges`; tax-basis and economic-net figures are fixed constants; ordinary trade fields have no event bindings; selected instrument identity is not visibly confirmed; and the manual-fallback button has no behavior.
- Trade cash impact rounds away paise even though the charge breakdown is stated to paise.
- Overview, analytics, and holding-detail charts reuse the same portfolio series. The analytics selector changes presentation rather than the selected metric, and the missing-TWR message is shown regardless of the selected analysis.
- Search handlers replace the complete root on every input event, creating a static risk that focus is lost after one character. This is not recorded as a keyboard test because no supported browser was available.

These findings apply to the in-progress artifact inspected before its owner declared it ready. They were rechecked against the corrected, stable handoff.

The stable artifact repaired these defects: the chart now reconciles to the priced subtotal; the gain card is explicitly unrealised P&L; portfolio return stays unavailable without a valid flow scope; charts use metric- or holding-specific data; BUY/SELL cash directions, paise, visible identity, manual fallback, and form handlers are present; and incremental search updates avoid rebuilding the root. The independent UI command passed after inspection of those corrections.

## Verification record

- Read `AGENTS.md`, the active section of `../70-UPGRADE-PLAN.md`, `report-source.md`, and `claim-ledger.md`.
- Inspected only the cited repository contracts in `src/app/investing.usecases.ts`, `src/domain/lots.ts`, and `src/domain/risk.ts`, plus the relevant calculation and market-data architecture sections.
- Inspected `experiment.md`, `experiment-checks.mjs`, `data-strategy-experiment.md`, `data-strategy-checks.mjs`, the stable external HTML fragment, and the generated result JSON after both experiment owners completed their handoffs.
- `node _architecture/investment-experience/experiment-checks.mjs` — exit 0, `PASS investment workspace experiment checks`.
- `node _architecture/investment-experience/data-strategy-checks.mjs` — intentional exit 1. It reused the two private snapshots, reproduced catalogue `FAIL` 12/13 for `tcs-name`, and passed every replay/safety assertion with hash `7e47f7918165c96e930c08e325bc5f76cbb235ff7f1a1759f80210bc2cc16aef`.
- Independently recalculated the snapshot SHA-256 values: Upstox `18e2d1fdcb22151a1f897d29065188d18ebc5eea041ee737910426c3bc841751`; Dhan `6e65523933d51e6aad54cb4b3cff4f27708fe0e4710a8c03f239da666f674fd2`. They match the experiment record.
- `node --check` for both experiment scripts — exit 0. `git diff --check -- _architecture/investment-experience` — exit 0.
- Repository status showed only the plan and investment-experience documentation/artifacts in this work packet; no production source path was changed by the experiments.
- Did not use an alternate browser path after the supported browser reported no available browser.

## Residual risks

- The catalogue experiment deliberately missed its all-cases threshold. Provider names are not portable identifiers; TCS demonstrates that truncated aliases need an explicit candidate/review flow.
- The current experiment helper selects any sole candidate, including a sole prefix result. Frozen cases cover ambiguous prefixes but not unique non-exact prefixes. Production planning must define whether every non-exact match requires confirmation and test that policy.
- The UI's XIRR, TWR, tax-basis, and P&L functions use JavaScript numbers and simplified synthetic assumptions. They are demonstration code only; production must use the repository's exact-money, typed-unavailable, dated-flow, charge, and jurisdiction contracts.
- The replay's generated trend creates its own apparent zero-cost edge. Costs erase or reverse much of it, and the experiment correctly discards live promotion. Its nearly unchanged latency result is not decision-useful until exits are anchored to observed market structure.
- CSS breakpoints and native controls passed structural inspection, but actual visual layout, screen-reader output, responsive rendering, focus order, and keyboard behavior remain unverified.

## Final decision

Status: PASS_WITH_RISKS

The research and isolated experiments meet the concept-study goal and report their falsified catalogue threshold and simulation limits honestly. This approval is limited to the RESEARCH/EXPERIMENT scope. It is separate from human concept approval, production QA, broker/compliance readiness, and any live or automated trading authorization.
