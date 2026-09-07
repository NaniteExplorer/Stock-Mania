# Instrument identity and intraday replay experiment

Date: 2026-09-06
Owner: Experiment Agent
Execution path: Research then experiment
Primary mode: Experiment
Status: COMPLETE

## Scope and evidence inherited from research

This is an isolated engineering experiment. It does not change production code, use credentials, place orders, publish a provider catalogue, or establish that a strategy is profitable. The experiment consumes the official public Upstox and Dhan instrument-master downloads once and stores private snapshots outside the checkout under `D:/WorkStation/Artifacts/stock-mania-investment-20260906/data/`.

The research handoff establishes these constraints:

- Upstox's public instrument file documents ISIN, name, trading symbol, exchange, segment, instrument key and provider tokens. Provider tokens are mappings, not permanent internal identity.
- Dhan's public detailed scrip master provides an independent security/symbol mapping. Public download access is not evidence of a redistribution licence, so bulk snapshots remain private.
- The authenticated Upstox search API is outside this experiment. No bearer token is needed for the master-file fetch.
- The proposed production model is an immutable internal security identity plus effective-dated listing/provider mappings. A fuzzy or ambiguous result must never select a listing automatically.
- A quote or catalogue entry cannot reconstruct the price and charges actually paid in a historic trade.

Primary documentation: [Upstox instrument files](https://upstox.com/developer/api-documentation/instruments/) and [Dhan instruments](https://dhanhq.co/docs/v2/instruments/). The broader research synthesis is in `report-source.md`.

## Protocol defined before execution

### Hypothesis 1: two independent masters can support conservative NSE cash-equity identity matching

If both public masters are available, a Node-only parser can normalize NSE cash `EQ` listings and join the two providers on exact ISIN while retaining their separate provider identifiers. Exact ISIN/symbol/name fixtures should resolve the intended security; prefix fixtures should return candidates without selecting one when multiple listings remain; an unknown query should remain unresolved.

Success thresholds:

1. Each fetch records URL, retrieval time, final HTTP status, response bytes and SHA-256. Retries are limited to one retry and only for transient network failures, HTTP 408/425/429, or HTTP 5xx.
2. Both files parse without silently skipping malformed source structure. The run reports source-row counts, NSE cash `EQ` normalized counts, exact-ISIN intersection count and normalization exclusions.
3. All 13 fixed cases pass their explicit expectations: six exact identity/symbol cases for Reliance Industries, Infosys and TCS; two exact-name cases; one punctuation-bearing symbol case (`M&M`); two deliberately broad prefixes (`TATA`, `HDFC`); one narrower prefix (`INF`); and one unknown value.
4. Every successful exact-identity result includes the same ISIN from both providers. Any case with more than one candidate has `selected: null`; fuzzy matching is absent.
5. A failed/blocked provider fetch is reported as such. Synthetic fallback, if invoked explicitly, is labeled `SYNTHETIC_FALLBACK` and cannot satisfy the live-catalogue threshold.

### Hypothesis 2: a deterministic replay can expose lookahead, cost, latency and safety behavior

A seeded synthetic five-minute opening-range breakout replay can enforce completed-bar signals and earliest-next-bar fills, then quantify how explicit friction and one-bar latency affect a chronological holdout. The exercise tests harness semantics, not market edge.

Frozen method and thresholds:

- Generate 90 labeled synthetic NSE-like sessions with seed `20260906`, 75 five-minute bars per session. The first 60 sessions are the development segment and the final 30 are the untouched chronological holdout. Parameters are fixed before examining holdout results.
- Opening range is the first three completed bars. A long signal occurs only after a later completed bar closes above the range high; a short signal mirrors this below the range low. Only the first eligible signal per day is considered.
- Baseline fill is the next bar's open. The latency stress fills one additional bar later. Stops and targets are fixed from the opening-range width and exits use later bars or the final session close.
- Run 0, 5, 10 and 20 basis points each side as a synthetic combined fee-and-slippage assumption, not an Indian statutory charge schedule. If a later bar touches both stop and target, choose the stop as the conservative same-bar outcome. Report gross expectancy, net expectancy, trade count and maximum drawdown for development and holdout, plus the same holdout matrix with one extra bar of latency.
- Automated assertions must prove: every fill follows its signal; no exit uses a bar before entry; on the same fill path higher costs never improve net trade P&L; stale data blocks an intent; a duplicate intent blocks; a breached daily-loss gate blocks; and a kill switch blocks.
- Replay output is reproducible for the fixed seed. Any failed assertion fails the experiment. Even if synthetic expectancy is positive, the live-strategy decision remains `DISCARD`; only the harness design may be retained for later work with licensed historical data, documented corporate actions and broker-specific execution evidence.

## Commands

Run from `D:/WorkStation/Projects/Stock-Mania`:

| Command | Result |
|---|---|
| `node --check _architecture/investment-experience/data-strategy-checks.mjs` | Exit 0 before execution. |
| `git diff --check -- _architecture/investment-experience/data-strategy-experiment.md _architecture/investment-experience/data-strategy-checks.mjs` | Exit 0 before execution. |
| `node _architecture/investment-experience/data-strategy-checks.mjs --refresh` | Both public masters returned HTTP 200 on their first attempt; exit 1 because the first catalogue parser/fixture result was 11/13. Replay assertions passed. |
| `node _architecture/investment-experience/data-strategy-checks.mjs` | Reused the two private snapshots, with no new network fetch; exit 1 because the corrected catalogue result was 12/13. Replay assertions passed and reproduced the same hash. |

The non-zero experiment exits are intentional: the script fails its process status when the predeclared catalogue threshold is not met. `data-strategy-results-initial.json` preserves the first run and `data-strategy-results.json` contains the corrected-parser run outside the checkout.

## Measured results

### Catalogue fetch and normalization

Both public downloads succeeded without retry on 2026-09-06 UTC. Snapshots and result JSON remain private under `D:/WorkStation/Artifacts/stock-mania-investment-20260906/data/`.

| Provider | HTTP/fetch time | Bytes | SHA-256 |
|---|---:|---:|---|
| Upstox NSE JSON gzip | 200 at `2026-09-06T04:50:54.873Z` | 1,905,130 | `18e2d1fdcb22151a1f897d29065188d18ebc5eea041ee737910426c3bc841751` |
| Dhan detailed CSV | 200 at `2026-09-06T04:51:03.754Z` | 33,964,897 | `6e65523933d51e6aad54cb4b3cff4f27708fe0e4710a8c03f239da666f674fd2` |

| Measure | Upstox | Dhan |
|---|---:|---:|
| Source rows parsed | 76,431 | 200,289 |
| NSE cash `EQ` rows normalized | 2,655 | 2,655 |
| Exact-ISIN intersection | \- | 2,655 |

No structurally malformed CSV row or invalid JSON root was tolerated. The first run exposed an experiment-code defect: the current Dhan detailed header uses `UNDERLYING_SYMBOL` as the NSE equity symbol and `SYMBOL_NAME` as its provider name, while the first parser precedence treated `SYMBOL_NAME` as a symbol. The saved-snapshot rerun corrected that mapping and raised the fixed-case score from 11/13 to 12/13.

The hypothesis's all-cases threshold was **not met**. The remaining predeclared query, `TATA CONSULTANCY SERVICES LTD`, returned no exact candidate. The observed provider names were truncated variants (`TATA CONSULTANCY SERV LT` in Upstox and Dhan's NSE row), so exact matching could not equate the requested text. The harness correctly did not fuzzy-select TCS. The six exact ISIN/symbol cases, Reliance exact-name case, `M&M`, unknown case and all three ambiguity cases passed; every ambiguous result had `selected: null`. This is evidence for immutable ISIN identity and explicit user disambiguation, while also showing that provider names cannot be treated as portable exact identifiers.

### Deterministic synthetic strategy replay

All temporal, matched-cost, fixed-seed and safety assertions passed. Development covers the first 60 synthetic sessions and holdout the final 30. Values below are synthetic currency-unit P&L per trade and cumulative maximum drawdown; they are not INR forecasts or performance evidence.

| Segment | Fill latency | Combined bps each side | Trades | Gross expectancy | Net expectancy | Max drawdown |
|---|---:|---:|---:|---:|---:|---:|
| Development | next bar | 0 | 60 | 311.70 | 311.70 | 139.45 |
| Development | next bar | 5 | 60 | 311.70 | 162.77 | 289.87 |
| Development | next bar | 10 | 60 | 311.70 | 13.84 | 703.74 |
| Development | next bar | 20 | 60 | 311.70 | -284.01 | 17,040.64 |
| Development | one extra bar | 0 | 60 | 311.70 | 311.70 | 139.45 |
| Development | one extra bar | 5 | 60 | 311.70 | 162.78 | 289.82 |
| Development | one extra bar | 10 | 60 | 311.70 | 13.86 | 703.60 |
| Development | one extra bar | 20 | 60 | 311.70 | -283.98 | 17,038.98 |
| Holdout | next bar | 0 | 30 | 327.63 | 327.63 | 0.00 |
| Holdout | next bar | 5 | 30 | 327.63 | 180.92 | 0.00 |
| Holdout | next bar | 10 | 30 | 327.63 | 34.20 | 252.59 |
| Holdout | next bar | 20 | 30 | 327.63 | -259.23 | 7,776.81 |
| Holdout | one extra bar | 0 | 30 | 327.63 | 327.63 | 0.00 |
| Holdout | one extra bar | 5 | 30 | 327.63 | 180.92 | 0.00 |
| Holdout | one extra bar | 10 | 30 | 327.63 | 34.20 | 252.73 |
| Holdout | one extra bar | 20 | 30 | 327.63 | -259.23 | 7,776.83 |

The fixed-seed replay hash was `7e47f7918165c96e930c08e325bc5f76cbb235ff7f1a1759f80210bc2cc16aef`. Costs monotonically reduced net P&L on every matched fill. On the holdout, net expectancy fell from 327.63 at zero friction to 34.20 at 10 bps each side and -259.23 at 20 bps each side. This cost model is a synthetic combined fee-and-slippage stress, not an actual statutory or broker charge model.

The one-extra-bar stress produced almost no change because the synthetic trends and entry-relative stop/target distances made the exit payoff nearly invariant to entry time. That is a harness limitation, not evidence that latency is harmless. A later experiment should anchor exits to market structure and use licensed observed bars before treating latency output as decision-useful.

`STALE_DATA`, `DUPLICATE_INTENT`, `DAILY_LOSS_LIMIT`, and `KILL_SWITCH` each blocked their test intent. Every signal used a completed bar; every fill followed the signal; every exit was at or after entry. The replay considers only one candidate trade per session, so the daily-loss gate was asserted directly but not reached through multiple sequential losses in a session.

### Limitations

- These are daily current masters, not a historical effective-dated mapping source. Corporate actions, delistings and provider-token changes are not reconstructed.
- Exact ISIN intersection does not prove redistribution rights, catalogue completeness for other series/exchanges, or correct handling of all duplicate listings. The snapshots must not be committed or published.
- The deliberately conservative matcher has no fuzzy-name auto-selection. A later user flow needs an explicit candidate/review state for name variants such as TCS.
- The generated price process embeds directional trends, has no spread book, partial fills, rejects, price limits, halts, auctions or corporate actions, and makes its positive zero-cost expectancy circular. It cannot validate an edge.
- Same-bar stop/target collisions resolve to the stop, a conservative convention. Real tick/order data would be needed to establish event order.
- The 0/5/10/20 bps values combine fees and slippage. Actual taxes, exchange levies, brokerage, impact and broker behavior were not modeled.

## Decision

**Catalogue hypothesis: FAIL at 12/13.** Keep the cross-provider ISIN normalization and ambiguity-policy design for implementation review; revise the exact-name acceptance model so provider aliases become reviewable candidates without automatic selection.

**Replay harness design: KEEP with revision. Live strategy promotion: DISCARD.** Retain completed-bar signals, later-bar fills, deterministic splits, friction matrices and safety assertions. Revise latency and intraday loss-path coverage before using licensed real data. Synthetic positive results do not validate a tradable edge.

## Baton: Experiment Agent -> Coordinator

- Goal: Prove or falsify conservative two-provider instrument identity matching and a deterministic, safety-gated intraday replay without production or live activity.
- Completed: Downloaded both public masters once, recorded fetch evidence, normalized 2,655 NSE cash `EQ` rows from each, ran 13 fixed identity/search cases, and ran the 90-session deterministic strategy/cost/latency matrix.
- Decisions: Exact ISIN remains the internal identity candidate; provider IDs stay mappings; ambiguous and non-exact names require user review. Live strategy promotion is `DISCARD`.
- Inputs: `report-source.md`; official Upstox and Dhan documentation linked above; private snapshots and result JSON under `D:/WorkStation/Artifacts/stock-mania-investment-20260906/data/`.
- Changed files: `_architecture/investment-experience/data-strategy-experiment.md`; `_architecture/investment-experience/data-strategy-checks.mjs`.
- Contract/output: Node-built-in-only reproducible harness; current catalogue result FAIL 12/13; all replay semantic/safety assertions PASS; live promotion DISCARD.
- Verification: Commands and measured tables above. Fetches were first-attempt HTTP 200; replay hash `7e47f7918165c96e930c08e325bc5f76cbb235ff7f1a1759f80210bc2cc16aef`.
- Open risks: Provider-name truncation, historical/effective-date coverage, redistribution permission, broker charges/execution, weak synthetic latency sensitivity and real market data are unresolved.
- Next action: Coordinator should carry the explicit catalogue failure and replay limitations into independent QA and the user-facing proposal; do not present synthetic P&L as evidence.
- Do not revisit: No fuzzy auto-selection, no claim that quotes recreate historic paid prices/charges, no catalogue publication, and no live strategy promotion from this experiment.
