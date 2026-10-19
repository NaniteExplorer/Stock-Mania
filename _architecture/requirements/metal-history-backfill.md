# Metal price history: backfill gram rates from first purchase

Status: DONE
Owner: Planner/Implementer
Updated: 2026-09-20

## Requirement

The gold instrument page renders "Profit across the years" and "Gold rate per gram" as empty
plots with correct axes but no line. The cause is not the chart: `GoldAnalytics.buildHistory`
resolves `rateMinor` to `null` for every month before the first stored quote, by design, and the
quote store holds only the handful of days the live `IbjaMetalProvider` has fetched. The owner
wants the same inception-to-today history the equity path already gives — gram rates from the
first metal purchase forward — so both plots draw an unbroken line.

## Chosen execution path

Path 4, **research then implementation** (AGENTS.md "Requirement modes"), selected by the owner
2026-09-20. Primary mode: **Implementation**. Research is complete and recorded below.

Owner's two scope decisions, 2026-09-20:

- Backfilled history is **marked as estimated**, not passed off as published IBJA rates.
- Scope is **gold + silver + the IBJA 30-day PDF harvest**.
- Coverage: **from first purchase** forward (not a blanket 5 years).

## Acceptance criteria

- [x] Both plots on a metal instrument page draw a continuous line from the month of the first
      metal purchase to the current month, with no interior gaps where a rate is obtainable.
- [x] Backfilled history is stored with `sourceType: "DERIVED"`, distinguishable in the database
      from real `PROVIDER` IBJA quotes.
- [x] The UI states visibly that pre-live history is an IBJA-calibrated estimate, not a published
      IBJA rate.
- [x] `IbjaMetalProvider.capabilities()` no longer claims historical support it does not have.
- [x] Silver months earlier than the ETF's first trade stay `null` rather than being fabricated.
- [x] A provider failure degrades to "no history", never to a fabricated or flat line.
- [x] `npm run lint`, `npm run typecheck`, `npm test` recorded by an independent QA agent.

## Context map

| Need | Authoritative file/section | Why it is needed |
|---|---|---|
| Broken consumer | `src/app/gold-analytics.usecases.ts:758-860` (`buildHistory`) | Defines why a monthless quote yields `null`; needs no change |
| Live metal quote provider | `src/infra/providers.ts:1154` (`IbjaMetalProvider`) | Declares false historical capability; also the calibration anchor |
| IBJA page parser | `src/infra/providers.ts:1213` (`parseIbjaRatesPage`) | Reused to read the calibration pairs and the 30-day PDF rows |
| Existing ETF reference | `src/infra/providers.ts:1902` (`GOLD_ETF: GOLDBEES.NS`) | The domestic Indian proxy already chosen by this repo |
| Provider base class | `src/infra/providers.ts:321` (`PriceProvider`) | `fetchRaw(request)` contract, `getText`, `codeFor`, `quote` |
| Quote chain wiring | `src/infra/providers.ts:1527` (`shippedQuoteProviders`) | Where metals actually price from; new provider registers here |
| Source marking | `src/domain/pricing.ts:56` (`PriceSourceType`) | `DERIVED` already exists — no migration needed |
| Storage | `src/infra/db/schema.ts:1011` (`price_quotes`), `src/infra/repositories.ts:1171` | Bitemporal, append-only; `supersede` makes a later re-fit legitimate |
| Backfill driver | `src/app/pricing.usecases.ts:68` (`BackfillInstrumentHistory`), wired `src/infra/container.ts:413` | Already exists; no new use case required |

## Decisions and constraints

- **D-1. No free IBJA history exists.** IBJA's own FAQ states the rates API is a paid
  subscription; `/api/rates`, `gold-rate-history.aspx` and `RateHistory.aspx` all 404; the
  homepage carries only **4 dates**. Verified by curl 2026-09-20. Paid feeds are excluded by the
  owner's standing constraint.
- **D-2. The international synthetic is rejected.** `GC=F × USDINR / 31.1035` runs a +12% India
  premium that is not stable: measured 99.9 → 115.4 → 106.3 over ten years, with a ~10 pp step at
  the July-2024 import-duty cut (15% → 6%). No fixed calibration factor can track that.
- **D-3. GOLDBEES.NS / SILVERBEES.NS via the keyless Yahoo chart API is the source.** It is a
  genuinely *domestic* Indian price — it absorbed the 2024 duty change — is keyless, and goes back
  to 2009 (silver: 2022-02). The IBJA/GOLDBEES ratio measured 122.07 / 121.98 / 122.04 on the
  three days where both are known: stable to 0.07%.
- **D-4. Calibration risk is small in this case.** The general worry is expense-ratio drift over a
  long backfill (~0.8%/yr). This owner's first metal purchase is ≈2026-02, entirely inside the
  post-duty-cut regime, so the required window is months, not years.
- **D-5. Metals stay in the `QuoteProviderPort` chain.** `src/market-data/` holds FX, search and
  equity history adapters, but metals price through `shippedQuoteProviders`. The new provider goes
  beside `IbjaMetalProvider` for consistency. Migrating metals into `src/market-data/adapters/`
  is a separate refactor, explicitly out of scope here.
- **D-6. Estimated history is `sourceType: "DERIVED"`.** `PriceProvider.quote()` hardcodes
  `"PROVIDER"`, so the new provider constructs its `Quote` rows directly.
- **D-7. The PDF harvest accumulates truth going forward, it does not backfill.** The IBJA 30-day
  PDF lives at an unguessable server-timestamped path and must be discovered from the homepage
  each run. It supplies real calibration pairs so the estimate self-corrects over time.

## Step-by-step plan

- [x] 1. Correct `IbjaMetalProvider.capabilities()` to stop claiming `maxHistoryYears: 5` —
      Owner: Backend — Files: `src/infra/providers.ts` — Verify: `tests/providers-conformance.spec.ts`
- [x] 2. Add `MetalHistoryProvider`: Yahoo chart on GOLDBEES/SILVERBEES, honouring `request.range`,
      calibrated to IBJA per purity, emitting `DERIVED` per-gram quotes — Owner: Backend —
      Files: `src/infra/providers.ts` — Verify: new `tests/metal-history-backfill.spec.ts`
- [x] 3. Register it in `shippedQuoteProviders` after `IbjaMetalProvider`, so a live IBJA rate
      always outranks an estimate — Owner: Backend — Files: `src/infra/providers.ts` —
      Verify: conformance spec
- [x] 4. Harvest the IBJA 30-day PDF for real calibration pairs — Owner: Backend —
      Files: `src/infra/providers.ts` — Verify: unit test over a captured fixture
- [x] 5. Trigger `BackfillInstrumentHistory` for metal instruments from the first trade date —
      Owner: Backend — Files: `src/app/pricing.usecases.ts` or caller — Verify: integration test
- [x] 6. Surface "estimated" in the chart UI — Owner: Frontend —
      Files: `app/(root)/investments/[instrumentId]/gold-profit-chart.tsx` — Verify: UI spec
- [x] 7. Independent QA — Owner: Testing/QA Agent — Verify: lint, typecheck, test

## Handoffs

### Research -> Planner/Implementer

- Goal: Backfill daily Indian gold/silver per-gram quotes from first purchase to today.
- Completed: Probed IBJA (no free history; API paid, per its own FAQ; homepage carries 4 dates;
  30-day PDF at an unguessable path). Probed Yahoo chart (keyless: `GC=F`, `USDINR=X`,
  `GOLDBEES.NS` from 2009, `SILVERBEES.NS` from 2022). Stooq behind a JS proof-of-work;
  goodreturns/bankbazaar/groww JS-rendered — all unusable. Measured IBJA vs synthetic
  (+12.0–12.9%, unstable) and IBJA vs GOLDBEES (stable to 0.07%).
- Decisions: D-1 through D-3 above.
- Changed files: None.
- Verification: every external claim backed by a curl run on 2026-09-20.
- Open risks: GOLDBEES expense-ratio drift unquantified; no free silver history before 2022-02;
  Yahoo `query1` undocumented and unguaranteed.
- Next action: implement steps 1-7.
- Do not revisit: free IBJA history; the international synthetic; Stooq/goodreturns/bankbazaar/
  groww; whether a new backfill use case is needed (it is not).

## Implementer notes (2026-09-20)

- The IBJA 30-day PDF was downloaded and parsed for real before the parser was
  written. It yields 28 trading days, and its `18-Sep-26` Gold 999 **PM** figure is
  `153727` -> ₹15,372.70/gram, which is exactly the rate the app already displays.
  That independently confirms the live IBJA path was never wrong — only short.
- `HttpClient` gained an optional `getBytes`, following the existing `getDecoded`
  precedent. `get`/`getDecoded` both end in `toString("utf8")`, which corrupts a
  PDF; `extractPdfLines` needs the bytes.
- The backfill route needed a metal branch: everything below it probes a *ticker*
  and fills `price_bars`, so a metal would 422 on a priceable holding and fill the
  wrong table. Metals now take `pricing.backfill` -> `price_quotes`, which is what
  the gold charts actually read.

## QA record

Status: PASS_WITH_RISKS (round 2, 2026-09-20). Round 1 was FAIL; defect repaired below.

### Round 1: FAIL — defect and repair

Independent QA returned FAIL on one criterion: *"A provider failure degrades to 'no history',
never to a fabricated or flat line."*

- **Defect.** `MetalHistoryProvider` resolved the metal family as
  `code.startsWith("SILVER") ? "SILVER" : "GOLD"`, so **platinum fell into the gold branch**.
  IBJA publishes platinum and `DigitalPlatinum.quoteKey()` is `COMMODITY`, so a platinum holding
  would have received a complete daily gram series whose *shape* was GOLDBEES' price movement
  scaled to a real platinum anchor — labelled `DERIVED`, but invented.
- **Repair.** The family is resolved by explicit prefix lookup over `METAL_ETF`; a metal with no
  mapped ETF emits nothing and the provider returns a typed `UNKNOWN_SYMBOL`. Regression test
  added: a platinum request returns zero quotes and never issues a GOLDBEES request.

### Round 1 residual risk, also repaired

QA observed that ordering providers does **not** enforce "a published rate outranks an estimate":
`QuoteRepository` orders by `(asOf desc, ingestedAt desc)` and `buildHistory` takes the last quote
in each month, so on a day holding both, the later *ingest* wins regardless of source quality.
Rather than keep a comment asserting a guarantee the code did not enforce, `MetalHistoryProvider`
now skips any date present in its IBJA calibration pairs, so a published day is never estimated
over. The spec assertion was updated to pin the new guarantee.

Also corrected: the chart note said "a domestic gold ETF" even when rendered for digital silver.

### QA-confirmed findings carried forward

- The `holding-performance-ui.spec.ts` failure is **environmental, not a regression** — independently
  confirmed by QA against the pristine HEAD blob and by reverting this change's single line in that
  file. (QA's nit, accepted: not *every* file is CRLF — `price-history-chart.tsx` is LF — but the
  conclusion stands.) Worth a separate ticket: the suite is not green for anyone on Windows with
  `core.autocrlf=true`.
- `IbjaPdfHistoryProvider.fetchRaw` has no end-to-end test; only `parseIbjaRateSheet` is covered,
  because the fixture HTTP client has no `getBytes`. Follow-up work.

### Round 2: PASS_WITH_RISKS — accepted

Independent QA re-verified the repair and confirmed the platinum case is discriminating, not
tautological: under the old line the fixture *would* have produced a full scaled series and all
three assertions would have failed.

Evidence (re-run independently by QA):
- `npx tsc --noEmit` -> exit 0
- `npm run lint` -> 0 errors, 46 warnings (none in the changed files)
- `node scripts/run-tests.mjs metal-history-backfill` -> ALL PASS (26 assertions)
- `node scripts/run-tests.mjs providers-conformance` -> ALL PASS (124 assertions)
- `node scripts/run-tests.mjs` -> 75/76 spec files

Round-2 findings actioned (comment accuracy, no behaviour change):
- The `shippedQuoteProviders` comment claimed the estimate skips "any day the real sources
  published". It skips the homepage days only; the PDF sheet's 30 days can still overlap. Comment
  corrected to say exactly that, and theresidual risk is recorded below rather than papered over.
- `METAL_ETF` prefix matching is unambiguous only while no key prefixes another; noted at the map.
- An internal comment in `gold-profit-chart.tsx` still said "gold ETF"; corrected.

### Disputed finding, resolved against round 2

Round 2 asserted the `holding-performance-ui.spec.ts` failure was caused by unrelated in-flight UI
work restructuring `page.tsx` ("no such `<Stat label=\"Realised\">` shape remains"). That is
**wrong**, and was checked directly: the shape occurs exactly once in the current file, the raw
match is `False` and the LF-normalised match is `True`. Round 1's diagnosis stands — it is the
CRLF/`core.autocrlf=true` line-ending mismatch against a spec that hardcodes `
`.
Implementer's own runs (to be re-run independently):
- `npx tsc --noEmit` -> exit 0
- `npm run lint` -> 0 errors, 46 warnings (45 pre-existing; 1 new, see risks)
- `node scripts/run-tests.mjs` -> 75/76 spec files pass
- `node scripts/run-tests.mjs metal-history-backfill` -> 23/23 assertions pass

Known, investigated, NOT caused by this work:
- `tests/holding-performance-ui.spec.ts` fails one assertion on this machine.
  `core.autocrlf=true` checks every file out as CRLF, including files nobody has
  modified, while the spec hardcodes `
` in a source-text match. Verified against
  the pristine HEAD blob: the pattern matches HEAD (LF) and cannot match any
  working-tree file (CRLF). Environmental, pre-existing, and left alone.

Residual risks:
- GOLDBEES expense-ratio drift (~0.8%/yr) is uncorrected. Immaterial over this
  owner's ~7-month window; material if the window is ever widened to years.
- No free silver history before 2022-02. Earlier months stay `null` by design.
- Yahoo `query1`/`query2` is undocumented and unguaranteed; a 429/403 degrades to
  "no history" and never to a fabricated line (covered by test).
- One new `react-hooks/exhaustive-deps` warning in `gold-profit-chart.tsx`,
  identical in shape and intent to the existing one in `price-history-chart.tsx`.
