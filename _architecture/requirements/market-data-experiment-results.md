# Market-data stack spike: measured results (E1–E7)

Status: READY
Owner: Experiment Agent (lane: **Experiment only**, per AGENTS.md "Requirement modes" option 3)
Updated: 2026-09-13

## Requirement

Decide, with measurements rather than documentation, whether the stack recommended in
[`market-data-sources-research.md`](market-data-sources-research.md) — Yahoo `v8/finance/chart`
primary, NSE/BSE bhavcopy fallback, Frankfurter FX, ISIN-anchored `quoteKey` gate — actually
delivers the user's four outcomes: **add any IN/US stock by search**, **refuse the unpriceable**,
**live XIRR and P&L in INR**, and **full-inception history charts**.

## Acceptance criteria

- [x] Every experiment states a falsifiable threshold **before** the run, the exact reproducible
      command, and real measured numbers.
- [x] A KEEP / REVISE / DISCARD verdict per experiment.
- [x] The six `src/infra` defects reported by the Research Agent are each confirmed or refuted
      with a reproducible probe.
- [x] Results that contradict the research recommendation are reported unmassaged.
- [x] No production file changed. `git status` before and after: only `_architecture/requirements/`
      untracked.

## Context map

| Need | Authoritative file/section | Why it is needed |
|---|---|---|
| Hypotheses H1–H12, findings F1–F15, defects D-1..D-6 | `_architecture/requirements/market-data-sources-research.md` | The input this spike tests |
| Yahoo parser, rate-limit budget, currency guard | `src/infra/providers.ts` L66-94 (`FetchHttpClient`), L812-900 (`YahooQuoteProvider`) | Read only; measured against, not edited |
| Instrument master ingestion | `src/infra/instrument-catalog.ts` L11-15, L165-193 | D-6 verification |
| XIRR algorithm | `src/domain/portfolio.ts` L90-190 (`xirr`) | Transcribed to float JS in the scratchpad for E5; original untouched |

**Spike artifacts** (all standalone `.mjs`, plain `node`, no repo deps, nothing added to
`package.json`):
`C:\Users\DEBASI~1\AppData\Local\Temp\claude\d--WorkStation-Projects-Stock-Mania\9b5d9c82-c7bc-4dd6-a25d-0031fcfad517\scratchpad\`
— `lib.mjs`, `e1-search-quote.mjs`, `e1b-followup.mjs`, `e2-history.mjs`, `e2b-splitwindow.mjs`,
`e2c.mjs`, `e3-gate.mjs`, `e3b-bse.mjs`, `e3c.mjs`, `e4-fx.mjs`, `e5-xirr.mjs`,
`e6-ratelimit.mjs`, `e7-defects.mjs`, `e7b.mjs`, plus captured output `e1.json`, `e2.out`,
`e2b.out`, `e2c.out`, `e3.json`, `e3b.json`, `e3c.json`, `e4.out`, `e5.out`, `e6.out`, `e7.out`.
All runs 2026-09-13 from a single Indian residential IP, Node v24.18.0, Windows 11.

---

## Headline verdict

**KEEP the recommended stack, with four mandatory design changes.** Every outcome the user asked
for is reachable on free, keyless sources. But four measured facts contradict or materially
refine the research document, and an implementer who does not design around them will ship
wrong numbers:

1. **Yahoo's `indicators.quote.close` is already split-adjusted.** The research doc (F1) and this
   spike's own brief both assumed raw `close` shows the split discontinuity and `adjclose` does
   not. **False.** Measured at five split dates: neither series gaps. `adjclose` differs from
   `close` only by *dividends*. Consequence: **the historical series is retroactively rewritten
   after every future split**, so cost basis must never be derived from it, and stored bars must
   be re-fetched or re-scaled when a new split appears.
2. **A stored `quoteKey` can die.** `TATAMOTORS.NS` → **HTTP 404**. The ticker no longer exists;
   the demerger produced `TMPV.NS` and `TMCV.NS`. A gate that validates only at ingest is not
   enough — it needs a re-validation loop and a degrade path.
3. **Yahoo's 429 is User-Agent-triggered, not rate-triggered.** 210 requests in 43 s with a
   browser UA: zero 429. A single request with `curl/8.0.1` or `python-requests/2.31.0`: 429 on
   3/3 rounds. The community "~360 req/hour" figure (F6, A7, H6) is **not reproducible here** and
   almost certainly describes bot-UA detection, not a quota.
4. **Yahoo's Indian history contains corrupt prints.** Verified single-day spikes of +337% /
   −90% that revert the next day, and a two-week window of doubled RELIANCE prices in 1997.
   These pass every schema check. An outlier filter is not optional.

---

## E1 — Search → quote identifier agreement

**Hypothesis.** Yahoo `v1/finance/search` returns symbols that feed straight into
`v8/finance/chart`, the top result matches user intent, and garbage returns nothing.
**Thresholds set before the run:** priceable fraction of all search hits ≥ 95%; top-result intent
match ≥ 80%; garbage strings → 0 results, 3/3.

**Command.** `node e1-search-quote.mjs > e1.json` (26 queries × up to 8 hits = 108 chart probes),
then `node e1b-followup.mjs`.

**Measured.**

| Metric | Result | Threshold | Verdict |
|---|---|---|---|
| Search hits that are priceable (≥1 bar returned) | **107 / 108 = 99.1%** | ≥95% | PASS |
| Garbage strings returning zero quotes | **3 / 3** (`zzzqqxwv`, `asdkjhasdkjh`, `!!!@@@###`) | 3/3 | PASS |
| Top result matches user intent | **17 / 23 = 74%** | ≥80% | **FAIL** |

The one unpriceable hit was `POLY-U2624.BO`, `quoteType: "FUTURE"` — HTTP 200 with zero bars.

**The six intent failures, verbatim:**

| Query | Top result | Why it is wrong |
|---|---|---|
| `HDFC Bank` | `HDB` / NYSE / **USD** | ADR outranks the NSE home listing `HDFCBANK.NS` |
| `infy` | `INFY` / NYSE / **USD** | ADR outranks `INFY.NS` |
| `SBI` | `SBI` / NYSE / **USD** | Unrelated US ticker outranks `SBIN.NS` |
| `tata motors` | `TMPV.NS` | Post-demerger; `TATAMOTORS.NS` no longer exists (see E2) |
| `brk.b` | `BRKC` (ETF), then **6 OPTION contracts** | `BRK-B` is **absent from the result set entirely** |
| `zomato` | *(zero results)* | Renamed to `ETERNAL.NS`; Yahoo keeps no alias |
| `micrsoft` | *(zero results)* | **No fuzzy/typo tolerance whatsoever** |

Contrast: `appl` → `AAPL` ranked first. So typo tolerance exists for *tickers* but **not for
company names** — `micrsoft` and `zomato` both return `{"quotes":[]}`, HTTP 200.

Filtering `quoteType ∈ {EQUITY, ETF}` removes the OPTION/FUTURE noise but does **not** fix ADR
ranking (`HDB`, `INFY`, `SBI` are all EQUITY) and does not recover `BRK-B` for `brk.b`. The
`v1/finance/lookup?type=equity,etf` variant returns the same ordering.

**Verdict: REVISE.** Yahoo search is a usable *candidate generator* and its results are
effectively 100% priceable, but it is **not safe as a ranker**. Design requirements:
- Filter `quoteType` to `EQUITY`/`ETF` at minimum (kills OPTION/FUTURE rows, one of which was the
  single unpriceable hit).
- Re-rank on the **local ISIN catalogue** (Upstox/NSE/SEC masters), which is where the
  "`zomato` → `ETERNAL.NS`" alias, the typo tolerance and the "prefer home listing over ADR"
  rule must live. Yahoo alone will show an Indian user a USD ADR for `HDFC Bank`.
- Normalise `.` → `-` **on the query**, not only on the resolved symbol: `brk.b` returns nothing
  useful, `brk-b` returns `BRK-B|EQUITY|NYSE` first.
- Never auto-select the top hit. The user must confirm an exchange-and-currency-labelled row.

## E2 — History depth and corporate-action correctness

**Hypothesis.** `period1=0&period2=now` yields full daily history; `range=max` degrades to
monthly; `adjclose` is continuous across known splits while raw `close` gaps.
**Thresholds:** ≥7000 daily rows for RELIANCE.NS and ≥11000 for AAPL; `range=max` demonstrably
coarser; every single-day move >15% in `adjclose` explained by a recorded event.

**Command.** `node e2-history.mjs`, `node e2b-splitwindow.mjs`, `node e2c.mjs`.

**Measured — depth (and the `range=max` trap):**

| Symbol | HTTP | `period1=0` rows | First | `range=max` rows | `range=max` first |
|---|---|---|---|---|---|
| RELIANCE.NS | 200 | **7716** | 1996-01-01 | **370** | 1995-12-31 |
| TMPV.NS (Tata Motors PV) | 200 | **9019** | 1991-01-02 | 429 | 1991-01-31 |
| INFY.NS | 200 | 7716 | 1996-01-01 | 370 | 1995-12-31 |
| MRF.NS | 200 | 6021 | 2002-07-01 | 292 | 2002-06-30 |
| IRCTC.NS | 200 | 1717 | 2019-10-14 | 362 | 2019-10-13 |
| NIFTYBEES.NS | 200 | 4375 | 2009-01-02 | 214 | 2008-12-31 |
| AAPL | 200 | **11529** | 1980-12-12 | **169** | 1984-12-01 |
| NVDA | 200 | 6952 | 1999-01-22 | 333 | 1999-02-01 |
| TSLA | 200 | 4076 | 2010-06-29 | 196 | 2010-07-01 |
| VOO | 200 | 4026 | 2010-09-09 | 193 | 2010-10-01 |
| USDINR=X | 200 | 5946 | 2003-12-01 | 275 | 2003-12-01 |
| RELIANCE.BO | 200 | **41** | 2026-07-17 | 288 | 2026-07-17 |
| **TATAMOTORS.NS** | **404** | — | — | — | — |

`range=max` confirmed catastrophic — AAPL loses 11360 of 11529 rows and its first date moves
forward four years. **D3 (never `range=max`) holds, emphatically.** `meta.firstTradeDate` matched
the first returned bar on 12/12 symbols, so it is a reliable inception marker.

**Measured — corporate actions. The research doc's model is wrong.**

Windows around five known splits (`e2b.out`). RELIANCE.NS 2:1 on 2017-09-07:

```
2017-09-06 close= 376.11 adj= 361.74
2017-09-07 close= 374.01 adj= 359.72     <- split date, no gap in EITHER series
```

AAPL 4:1 on 2020-08-31: `close 124.81 → 129.04`. NVDA 10:1 on 2024-06-10:
`close 120.89 → 121.79`. IRCTC 5:1 on 2021-10-28: `close 826.03 → 913.50`.
**In no case does raw `close` show the split discontinuity.** Yahoo back-adjusts the OHLC block
itself; `adjclose` layers dividends on top (RELIANCE 2017-09-07: 374.01 vs 359.72 ≈ 3.8%
cumulative dividend drag). The "`close[0]=6.31` vs `adjclose[0]=3.95`" in research F1 is the
dividend factor, not a split factor.

Jump counts confirm it: for every symbol, `rawJumps == adjJumps` exactly (RELIANCE 9/9,
INFY 8/8, AAPL 18/18, NVDA 46/46, TSLA 25/25). The two series move identically.

**Consequences the implementer must design around:**

- **The stored history is not immutable.** After a split, Yahoo rewrites every prior bar. A
  `priceBars` row written today for RELIANCE will silently disagree with Yahoo after the next
  split. Either store the raw NSE bhavcopy price plus an explicit adjustment factor, or
  re-backfill on every newly observed `events.splits` entry.
- **Cost basis must come from the user's ledger, never from the series.** See E5.
- **`events.splits` is the only split signal, and it does not explain the gaps that remain.**
  Unexplained >15% single-day moves after excluding event dates: RELIANCE 8, INFY 8, TMPV 13,
  AAPL 18, NVDA 46, TSLA 25. Most are genuine volatility (NVDA 2000-03-07 +42.4%). But some are
  not:

**Three confirmed data-corruption modes (`e2c.out`, `e2b.out`):**

| Symbol | Date(s) | Observed | Diagnosis |
|---|---|---|---|
| RELIANCE.NS | 2005-07-28 | close **218.31** between neighbours 49.90 and 50.22 | Single corrupt print (~4.4×) |
| RELIANCE.NS | 1997-10-27 → 1997-11-04 | level jumps 14.14 → 27.02, holds ~25 for 7 sessions, drops to 13.04 | Split adjustment applied to a **window** instead of a boundary |
| NIFTYBEES.NS | 2019-12-19, 2019-12-20 | close **13.02, 13.03** between 129.25 and 129.93 | Two corrupt prints (÷10); **no split event recorded** |

**Demergers are not adjusted at all.** `TMPV.NS` 2025-10-14: `close 660.75 → 395.45` (−40.2%),
**no entry in `events.splits` or `events.dividends`**. RELIANCE.NS around the 2023-07-20 Jio
Financial demerger shows −3.1% on 2023-07-21 — neither a clean adjusted seam nor the full JFS
value. **Research assumption A3 is CONFIRMED AS A FAILURE MODE: Yahoo's adjusted series does not
handle Indian demergers.** Any long-range chart or return figure spanning a demerger is wrong,
and there is no free source that fixes this automatically.

**Verdict: KEEP `period1`/`period2` history; REVISE the corporate-action model.**
Required: mandatory outlier detection (flag any |move| > 25% not matched to a split/dividend
event and to a same-day bhavcopy cross-check), an explicit demerger register maintained
manually, and a re-backfill trigger on newly observed splits.

## E3 — The "unpriceable cannot be added" gate

**Hypothesis.** A catalogue row is indexed only if a `quoteKey` resolved at ingest with matching
currency. **Threshold:** ≥95% of a random NSE-master sample resolves; below that the gate hides
legitimate holdings and must be redesigned.

**Command.** `node e3-gate.mjs` (Upstox `NSE.json.gz` → 220-row deterministic stride sample →
`chart?period1=now-20d`), `node e3b-bse.mjs`, `node e3c.mjs`.

**Measured — NSE:**

- Upstox NSE master: 200, total rows **69 471**, of which `segment=NSE_EQ` + `instrument_type=EQ`
  + non-null ISIN = **9708**.
- Sample **220**. Resolved to a `.NS` chart with ≥1 bar and `meta.currency === "INR"`: **220**.
- **Resolution rate 100.0%. HTTP codes: `{"200": 220}`. Zero failures, zero 429s.**

Threshold ≥95% → **PASS with room to spare.** H7 is confirmed and exceeded. **The gate does not
hide legitimate NSE holdings.**

**Measured — BSE, and a correction to research F3:**

- Upstox BSE master: 200, 12 878 `BSE_EQ` rows — but `instrument_type` is the **BSE group code**
  (`X, F, XT, B, G, A, M, T, TS, P, Z, MT, IF, ZP, E, R, MS`), and `F` (6532) + `G` (1127) are
  **debt and G-secs, not equity**. Equity rows after excluding them: **5219**.
  *An implementer filtering on `instrument_type === "EQ"` gets zero BSE rows.* A first pass of
  this experiment did exactly that and produced a false 25% resolution rate against bond tickers
  like `805HDFCB29.BO`, `759NHPCL37.BO`, `GS22OCT38.BO`.
- BSE equity ISINs absent from the NSE master (the genuinely BSE-only tier): **2510**.
- Sample of 50 BSE-only symbols: **48 priceable (96%)**, **44 with >250 bars**,
  35 with ≥1500 bars (e.g. `GUJINJEC.BO` 4331 rows from 2009-03-12, `RAJKSYN.BO` 4099 rows).

**Research F3 ("Yahoo's BSE series is truncated, `.BO` is unusable") is REFUTED as a general
claim.** The truncation is **symbol-specific and hits exactly the high-profile dual listings**:

```
RELIANCE.BO=41@2026-07-17   INFY.BO=41@2026-07-17   HDFCBANK.BO=41@2026-07-17
ITC.BO=41@2026-07-17        SBIN.BO=41@2026-07-17   MRF.BO=41@2026-07-17
TCS.BO=6141@2002-01-14      WIPRO.BO=9002@1991-01-25
```

Six symbols all truncated to the identical start date 2026-07-17 — a Yahoo backend re-key event,
not a BSE data policy. **D4 (canonicalise Indian equities to `.NS`) still holds, but for a
different reason:** not because `.BO` history is bad, but because *dual-listed* `.BO` history is
arbitrarily unreliable. BSE-only scrips are a **viable tier at 96%**, not a degraded one.

**The gate's real failure mode is not coverage, it is decay.** `TATAMOTORS.NS` → 404 proves a
`quoteKey` validated at ingest can stop resolving. Research recommendation 6 (mark `quoteStale`,
degrade, never delete) is the correct response and must be built, not deferred.

**Verdict: KEEP the gate.** REVISE the BSE ingest to filter on BSE group codes rather than
`"EQ"`, index the 2510 BSE-only ISINs as a full tier, and implement re-validation + `quoteStale`
from day one.

## E4 — FX (Frankfurter USD/INR)

**Hypothesis.** Frankfurter serves a daily USD/INR series deep enough for multi-year XIRR, with
a defined answer for non-publication dates. **Threshold:** series from ≤2001 to today, no
unexplained gap >4 calendar days, and a deterministic rule for a missing transaction date.

**Command.** `node e4-fx.mjs`.

**Measured.**

- `GET https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR` → 200
  `{"amount":1.0,"base":"USD","date":"2026-09-11","rates":{"INR":95.56}}`
- `GET https://api.frankfurter.dev/v1/1999-01-01..?base=USD&symbols=INR` → 200, 189 127 bytes,
  **6824 points**, first **2000-01-13**, last **2026-09-11**. (Requesting 1999 silently clamps to
  first available — no error.)
- **Max gap 5 calendar days. 36 gaps >4 days, all of them Easter and Christmas closures**
  (`2000-04-20→2000-04-25`, `2000-12-22→2000-12-27`, `2008-12-24→2008-12-29`, …). No unexplained
  gap. **Threshold met.**
- **Missing-date handling is solved by the API itself.** A single-date request for a
  non-publication date returns 200 and **tells you which date it used**:
  `/v1/2025-12-25` → `{"date":"2025-12-24","rates":{"INR":89.74}}`;
  `/v1/2020-03-15` → `{"date":"2020-03-13",...}`; `/v1/2026-09-13` → `{"date":"2026-09-11",...}`.
  Rule for the implementer: **last published rate on or before the transaction date, and persist
  the `date` the API returned** so the valuation is auditable and reproducible.
- Yahoo `USDINR=X`: 200, 5946 rows from 2003-12-01. Same-day comparison 2025-09-11:
  Frankfurter **88.43** vs Yahoo **88.2676** — **0.18% apart**. Over a ₹5 lakh USD position that
  is ~₹900 of phantom P&L from a source switch alone.

**Verdict: KEEP.** Frankfurter is the FX primary (research D6 confirmed). Two hard rules:
INR series starts **2000-01-13** — any USD transaction dated earlier has no ECB rate and must be
rejected or manually rated; and **never mix Frankfurter and Yahoo rates in one portfolio's
history** (0.18% seam).

## E5 — End-to-end XIRR and P&L smoke

**Hypothesis.** The data shape emerging from these sources is sufficient to drive the existing
domain functions. **Threshold:** a 7-lot INR+USD portfolio produces a finite, plausible XIRR and
an INR unrealised P&L with no missing input.

**Command.** `node e5-xirr.mjs`. The `xirr` in that script is a float transcription of the
bracket-then-bisect algorithm at `src/domain/portfolio.ts` L122; **the original was not imported,
modified or run.**

**Measured.** Real Yahoo bars + real Frankfurter rates, 7 lots, 2019–2023 buys:

```
costINR = 532362   valueINR = 1765545   unrealisedINR = 1233184  (+231.6%)
XIRR = 26.134%
flows: [["2019-04-15",-30634],["2020-06-10",-57268],["2021-03-05",-23290],
        ["2022-08-22",-76380],["2019-11-12",-93902],["2021-02-18",-16138],
        ["2023-01-09",-234750],["2026-09-13",1765545]]
```

Every FX lookup hit an exact publication date (`fxFallbackDays: 0` on all three USD lots). The
XIRR bracketed and converged. **Mechanically, the pipeline works.**

**But the numbers are wrong, and that is the finding.** The script priced the AAPL lot at
`buyPx 65.49` on 2019-11-12 and the NVDA lot at `14.83` on 2021-02-18. Those are **today's
split-adjusted values of those days' prices**; AAPL actually traded near $262 and NVDA near
$148. Because Yahoo back-adjusts `close` (E2), a naive "look up the historical close × the
quantity the user entered" produces a cost basis understated by the cumulative split factor —
**4× for AAPL, 40× for NVDA, 2× for RELIANCE, 5× for IRCTC.**

**The rule this forces, and it is the single most important output of this spike:**

> Cost basis comes from the user's recorded transaction (price × quantity as traded), **never**
> from a market-data series. When charting a cost line against an adjusted price series, the
> *ledger quantity and price must be scaled by the cumulative split factor for every split after
> the trade date* before the two can be plotted on the same axis. `src/app/pricing.usecases.ts`
> `BackfillInstrumentHistory` and anything that joins `priceBars` to a holding must honour this.

**Verdict: KEEP the pipeline, REVISE the join.** The sources are sufficient; the naive join is
not.

## E6 — Rate limits and durability

**Hypothesis (H6).** Yahoo `chart` sustains a measurable throughput before the first 429, around
the community-reported ~360/hour. **Threshold:** record the number at which sustained 429s begin.
Method: considerate ramp, halt at 5 consecutive non-200s.

**Command.** `node e6-ratelimit.mjs`, then `node e7b.mjs` for the UA cross-check.

**Measured — throughput:**

| Phase | Concurrency | Gap | Requests | Elapsed | Equivalent rate | Codes |
|---|---|---|---|---|---|---|
| 1 | 1 | 200 ms | 30 | 20.3 s | 5 315/hr | `{"200":30}` |
| 2 | 2 | 100 ms | 40 | 9.2 s | 15 678/hr | `{"200":40}` |
| 3 | 4 | 0 | 60 | 5.2 s | 41 245/hr | `{"200":60}` |
| 4 | 8 | 0 | 80 | 8.5 s | 33 751/hr | `{"200":80}` |

**210 requests in ~43 seconds. Zero 429s. The ramp never halted.** Cumulative across this whole
session (E1 134 + E1b 20 + E2 26 + E2b/c 10 + E3 220 + E3b 60 + E3c 58 + E5 7 + E6 210 + E7 ~30)
≈ **775 Yahoo requests inside one hour from one IP with zero 429s.** The ~360/hour ceiling
(research F6, A7) **is not reproducible.**

**Measured — what actually produces a 429. Deterministic, 3/3 rounds:**

```
round 0 curl=429 py=429 (none)=200 repo=200 browser=200 node=200 bare-mozilla=200
round 1 curl=429 py=429 (none)=200 repo=200 browser=200 node=200 bare-mozilla=200
round 2 curl=429 py=429 (none)=200 repo=200 browser=200 node=200 bare-mozilla=200
```

A cold single request with `User-Agent: curl/8.0.1` or `python-requests/2.31.0` returns
**`429 Edge: Too Many Requests`** (23-byte plaintext body, not JSON) while the *same URL* in the
same second with the repo's own UA, a bare `Mozilla/5.0`, `node`, or **no UA header at all**
returns 200. **Yahoo's 429 on this path is a User-Agent blocklist, not a quota.** That is almost
certainly what the `yfinance`/`yahoo-finance2` issue threads are actually reporting — those
libraries default to Python/Node client UAs.

**Backfill budget for 50 instruments × 20 years.** Measured at concurrency 4 with no gap:
60 requests in 5.2 s, and full-history payloads run 800 KB–1 MB each (RELIANCE.NS `period1=0` is
**844 325 bytes**). So 50 full backfills ≈ **50 requests, ~45 MB, under 15 seconds of wall time**.
This is a non-problem. The binding constraints are payload size and parse time, not rate.

**Verdict: REVISE research D-2 and the recommended budget.**
- `YahooQuoteProvider.rateLimit()` at 20 req/60 s is **not** "above the ceiling" — no ceiling was
  observable. It is a reasonable politeness budget and should be kept as one, not lowered to 6/min
  on the strength of a community figure this spike could not reproduce.
- The real durability rule is **UA hygiene**: always send a browser-shaped UA, never a client-library
  UA, and treat a 23-byte `Edge: Too Many Requests` body as a *UA/edge* signal distinct from a real
  quota 429. `FetchHttpClient`'s current default UA passes.
- Research D8 (self-host history, fetch deltas) remains correct — but for **payload and
  resilience** reasons, not to dodge a rate limit.

## E7 — Deployment-egress risk (research H1/A1) — **UNRESOLVED**

**Hypothesis.** The endpoints behave identically from a cloud egress IP.
**This spike cannot test it.** There is no deployment to probe from here; every measurement above
came from one Indian residential IP. Reporting this as resolved would be dishonest.

**What was tested instead — header sensitivity and geo signals** (`node e7-defects.mjs`):

- **Header dependence is minimal.** Yahoo `chart` returned 200 with the repo's UA, with a bare
  `Mozilla/5.0`, with `node`, and **with no `User-Agent` header at all**. No cookie, no crumb, no
  `Referer`, no `Origin` required. The only header value that fails is a client-library UA (E6).
- **No geo-conditional signal in the response.** Both `query1` and `query2` returned
  `server: ATS`, `cache-control: public, max-age=10, stale-while-revalidate=20`, `age: 1–2`,
  **no `set-cookie`**, no region header, no `x-yahoo-request-id`. The response is an edge-cached
  public object with no per-client state — which is mildly reassuring (nothing IP-personalised is
  being computed) but is **not** evidence about cloud-IP reputation.

**Residual risk, stated plainly.** Yahoo, Akamai (nseindia) and the Upstox CDN may all treat
Vercel/AWS egress ranges differently — those ranges are shared, heavily used by scrapers, and
already known to be rate-limited harder. **Nothing in this spike constrains that.**

**The cheap test that would settle it**, for whoever has deploy access — one throwaway route
handler, deleted after the run:

```
GET /api/_probe  →  fetch, with the repo's own FetchHttpClient, and log status + row count for:
  1. query2.finance.yahoo.com/v8/finance/chart/RELIANCE.NS?period1=0&period2=<now>&interval=1d
  2. query2.finance.yahoo.com/v1/finance/search?q=relia&quotesCount=5&newsCount=0
  3. nsearchives.nseindia.com/content/equities/EQUITY_L.csv
  4. assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz
  5. api.frankfurter.dev/v1/latest?base=USD&symbols=INR
Hit it 10 times, 30 s apart. PASS = 200 on all five, 10/10, and >7000 rows on (1).
```

Total cost: one deploy, five minutes. **Until it is run, the primary stack is unvalidated in the
environment it will actually run in**, and research H1 remains the correct first action.

**Verdict: UNRESOLVED — not KEEP, not DISCARD.** The stack is validated from a residential IP
only.

---

## The six `src/infra` defects: confirmed or refuted

Probes in `e7-defects.mjs` / `e7.out`, run 2026-09-13.

| # | Research claim | Measured | Status |
|---|---|---|---|
| **D-1** | `FetchHttpClient`'s default UA `Mozilla/5.0 (compatible; StockMania/1.0)` gets **403** from sec.gov, breaking `SEC_COMPANY_TICKERS_URL` | `company_tickers_exchange.json` with that exact UA → **200, 522 968 bytes**, body `{"fields":["cik","name","ticker","exchange"],"data":[[1045810,"NVIDIA CORP","NVDA","Nasdaq"],…}`. `company_tickers.json` with the same UA → **200, 797 931 bytes**. A contact-declaring UA → also 200, byte-identical length. | **REFUTED.** No fix needed. SEC's UA enforcement is intermittent/rate-dependent; the declared-contact UA remains good SEC-policy practice but is not a defect today. |
| **D-2** | `YahooQuoteProvider.rateLimit()` = 20 req/60 s (1200/hr) exceeds Yahoo's ~360/hr ceiling | Code confirmed at `src/infra/providers.ts` L831: `{ requests: 20, perMillis: 60_000, burst: 4 }`. But **775 requests in one hour, zero 429s**; the ceiling is not reproducible (E6). The actual 429 trigger is the client-library UA. | **REFUTED as stated.** The config is not a defect. The genuine (unreported) risk is UA-shape, and the current default UA is safe. |
| **D-3** | `NseQuoteProvider` targets a host that 403s both its priming request and its API call | `https://www.nseindia.com/` → **200, 169 936 bytes** of HTML (research said 403 — behaviour has changed). `https://www.nseindia.com/api/quote-equity?symbol=RELIANCE` → **403**, body `<HTML><HEAD> <TITLE>Access Denied</TITLE> …You don't have permission to access "http://www.nseindia.com/api/quote-…"`. | **CONFIRMED on the API path, REFUTED on the reasoning.** The root is reachable, so cookie priming is *possible*; the `/api/*` path is what is blocked. The provider is still non-functional. `nsearchives.nseindia.com/content/equities/EQUITY_L.csv` → **200, 181 324 bytes** — the archive host is unaffected. |
| **D-4** | `ZerodhaQuoteProvider` requires a paid Kite Connect subscription, contradicting the file's keyless docstring | `api.kite.trade/quote/ltp?i=NSE:RELIANCE` → **400** `{"status":"error","message":"Invalid \`api_key\` or \`access_token\`.","error_type":"InputException"}`. The *instruments* dump `api.kite.trade/instruments` → **200, 8 970 977 bytes**, keyless. | **CONFIRMED.** Quotes are key-walled; the instrument master is not. |
| **D-5** | `EcbFxProvider` reads `eurofxref-hist-90d.xml` — EUR-based, 90 days, cannot serve historical USD/INR | → **200, 70 606 bytes**, root `<gesmes:Envelope …>`, EUR-based, 90-day window. Alive but structurally unable to serve a 2019 USD/INR rate; Frankfurter supplies 6824 points from 2000-01-13 (E4). | **CONFIRMED.** |
| **D-6** | `src/infra/instrument-catalog.ts` ingests the Upstox **NSE** master only; the BSE master is missing | `grep` over that file: L11-12 `UPSTOX_NSE_MASTER_URL = ".../exchange/NSE.json.gz"`, L15 `SEC_COMPANY_TICKERS_URL`. **No BSE URL anywhere in the file.** Measured impact: **2510 BSE-only equity ISINs** have no identity source, and **96% of a sample of them are priceable on Yahoo** (E3). | **CONFIRMED, and larger than reported.** These are addable instruments the user currently cannot find. |

Also re-confirmed as eliminated, unchanged from research: Stooq (`stooq.com/q/d/l/?s=aapl.us&i=d`
→ 200 but 796 bytes of `<noscript>` JS-verification HTML, not CSV); `exchangerate.host`
(→ 200 `{"success":false,"error":{"code":101,"type":"missing_access_key"}}`); Yahoo `v7/finance/quote`
(→ **401** `{"code":"Unauthorized","description":"User is unable to access this feature"}`).

---

## Traps an implementer must design around

1. **`range=max` returns monthly data with a 200.** AAPL: 169 rows instead of 11 529. Always
   `period1`/`period2`. (Research D3 — confirmed.)
2. **Yahoo's `close` is already split-adjusted and is rewritten retroactively.** Stored bars go
   stale after a split. `adjclose` adds only dividends.
3. **Never derive cost basis from a price series.** 40× error on NVDA in the E5 smoke test.
4. **Demergers are silently unadjusted.** `TMPV.NS` −40.2% on 2025-10-14 with no event record.
5. **A `quoteKey` can 404 later.** `TATAMOTORS.NS` is gone. Re-validate and degrade; never delete
   a user's holding.
6. **Corrupt prints exist and pass schema validation.** RELIANCE 2005-07-28 (+337%),
   NIFTYBEES 2019-12-19/20 (÷10). Outlier filter mandatory.
7. **Yahoo search returns OPTION and FUTURE rows** — one was the only unpriceable hit in 108.
   Filter `quoteType`.
8. **Yahoo search ranks US ADRs above Indian home listings** (`HDB` over `HDFCBANK.NS`). Re-rank
   locally or an Indian user buys USD exposure by accident.
9. **Yahoo search has zero fuzzy tolerance for company names.** `micrsoft` and `zomato` both
   return `{"quotes":[]}` with HTTP 200. Renamed tickers (Zomato→Eternal) have no alias.
10. **`brk.b` returns no `BRK-B`.** Normalise `.`→`-` on the query, not just the symbol.
11. **The Upstox BSE master's `instrument_type` is a BSE group code, not `"EQ"`.** Filtering on
    `"EQ"` yields zero rows; `F` and `G` (7659 rows) are debt instruments that resolve to nothing.
12. **`.BO` truncation is symbol-specific**, hitting dual-listed blue chips (RELIANCE, INFY,
    HDFCBANK, ITC, SBIN, MRF — all 41 rows from 2026-07-17) while BSE-only scrips have deep
    history. Canonicalise to `.NS` when an NSE listing exists.
13. **Frankfurter's INR series starts 2000-01-13**, and a pre-2000 range request clamps silently
    rather than erroring.
14. **Frankfurter and Yahoo FX differ by ~0.18%.** Pick one for the life of a portfolio.
15. **Yahoo 429s on client-library User-Agents regardless of rate.** A 23-byte
    `Edge: Too Many Requests` body means "wrong UA", not "slow down".
16. **Full-history payloads are ~850 KB each.** 50 instruments ≈ 45 MB per full backfill — the
    real cost is bandwidth and parse, not request count.

## Decisions and constraints

- **X1** — KEEP Yahoo `v8/finance/chart` as the primary for quote and history. 100% resolution on
  a 220-row NSE sample, full inception depth on 12/12 symbols, no rate ceiling observable.
- **X2** — KEEP Frankfurter as FX primary, persisting the `date` the API reports per lookup.
- **X3** — REVISE the search design: Yahoo search is a candidate generator, the **local ISIN
  catalogue is the ranker**. Aliases, typo tolerance and home-listing preference live locally.
- **X4** — REVISE the history model: treat Yahoo bars as **adjusted and mutable**. Re-backfill on
  new splits; keep cost basis in the ledger; scale ledger quantities by cumulative split factor
  for chart overlay.
- **X5** — KEEP the `quoteKey` gate, ADD mandatory re-validation and a `quoteStale` degrade path.
- **X6** — REVISE research D4's rationale and ADD the BSE master (research D-6): 2510 BSE-only
  ISINs at 96% priceable is a full tier, not a degraded one.
- **X7** — DISCARD research D-1 and D-2 as defects (both refuted); keep D-3, D-4, D-5, D-6.
- **X8** — Deployment egress is **UNRESOLVED**. The 5-endpoint probe route in E7 must run before
  any implementation is accepted.

## Step-by-step plan

- [x] 1. E1 search→quote agreement — Owner: Experiment Agent — Files: scratchpad — Verify: `node e1-search-quote.mjs`
- [x] 2. E2 history depth + corporate actions — Owner: Experiment Agent — Verify: `node e2-history.mjs; node e2b-splitwindow.mjs; node e2c.mjs`
- [x] 3. E3 gate resolution rate — Owner: Experiment Agent — Verify: `node e3-gate.mjs; node e3c.mjs`
- [x] 4. E4 FX depth and gaps — Owner: Experiment Agent — Verify: `node e4-fx.mjs`
- [x] 5. E5 end-to-end XIRR smoke — Owner: Experiment Agent — Verify: `node e5-xirr.mjs`
- [x] 6. E6 rate-limit ramp — Owner: Experiment Agent — Verify: `node e6-ratelimit.mjs; node e7b.mjs`
- [x] 7. E7 header/geo signals + six defects — Owner: Experiment Agent — Verify: `node e7-defects.mjs`
- [ ] 8. **Deployment-egress probe (E7 residual, research H1)** — Owner: DevOps Expert — Files: one throwaway route handler — Verify: 200 on 5 endpoints, 10/10, >7000 rows on the Yahoo chart call
- [ ] 9. Plan provider + catalogue changes per X1–X8 — Owner: Planner/Implementer — Files: `src/infra/providers.ts`, `src/infra/instrument-catalog.ts`, `src/app/pricing.usecases.ts`, `src/infra/db/schema.ts`
- [ ] 10. Independent QA — Owner: Testing/QA Agent

## QA record

Status: NOT_RUN
Evidence:
- Experiment lane only. **No production file changed.** `git status --short` before and after the
  spike shows only `?? _architecture/requirements/` on branch `redesign/v2`. Nothing staged,
  nothing committed.
- No dependency added to `package.json`; every script is a standalone `.mjs` in the scratchpad run
  with `node`.
- `src/domain/portfolio.ts` `xirr` was **read only**; a float transcription was used in `e5-xirr.mjs`.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` were **not run** — no repository
  code was touched, so they would test nothing this lane changed.
Residual risks:
- **Deployment egress (research A1/H1) is unmeasured.** Highest-severity open item.
- E5's XIRR uses a float transcription, not the production `Money`-precise `xirr`. It proves data
  sufficiency, not numeric equivalence with the domain implementation.
- E3's NSE figure is a 220-row stride sample of 9708 (2.3%); 100/220 with zero failures makes a
  true rate below 95% unlikely but not impossible.
- E6 measured a 43-second burst plus ~775 requests over one hour. A multi-hour or multi-day quota
  was not probed, deliberately, to avoid hammering a free service.
- Demerger handling has **no free automated fix**. A manual register is a permanent maintenance cost.
- Yahoo remains an undocumented endpoint that can change without notice; every finding here has a
  shelf life.

---

## Baton: Experiment Agent -> Coordinator

- **Goal:** Decide with measurements whether the Yahoo-primary / bhavcopy-fallback /
  Frankfurter-FX stack delivers add-by-search, refuse-unpriceable, live INR XIRR/P&L, and
  full-inception charts.
- **Completed:** Seven experiments, ~800 live HTTP probes on 2026-09-13, all from one Indian
  residential IP. Search→quote agreement 99.1% priceable but only 74% intent-correct. Full
  history confirmed at `period1=0` (RELIANCE.NS 7716 rows from 1996, AAPL 11 529 from 1980);
  `range=max` confirmed to silently return ~170–430 monthly rows. NSE catalogue gate resolves
  **220/220 = 100%**. BSE-only tier resolves 48/50 = 96%. Frankfurter USD/INR: 6824 points from
  2000-01-13, max gap 5 days, all explained. End-to-end XIRR ran: 26.134% on a 7-lot synthetic
  portfolio. 775 Yahoo requests in one hour, **zero 429s**.
- **Decisions:** X1–X8 above. The four that reshape the design: (a) Yahoo `close` is **already
  split-adjusted and retroactively rewritten**, so cost basis must come from the ledger and stored
  bars must be re-backfilled on new splits; (b) demergers are **not adjusted at all** (`TMPV.NS`
  −40.2%, no event) and need a manual register; (c) a stored `quoteKey` can **404 later**
  (`TATAMOTORS.NS`), so the gate needs re-validation plus a `quoteStale` degrade path; (d) Yahoo's
  429 is a **User-Agent blocklist**, not a quota — `curl`/`python-requests` UAs fail cold 3/3
  while the repo's own UA and even a header-less request succeed.
- **Inputs:** `_architecture/requirements/market-data-sources-research.md` (F1-F15, D-1..D-6,
  H1-H12). Read but not changed: `src/infra/providers.ts`, `src/infra/instrument-catalog.ts`,
  `src/domain/portfolio.ts`.
- **Changed files:** `_architecture/requirements/market-data-experiment-results.md` (new, this
  file). **No production file touched. Nothing staged or committed.**
- **Contract/output:** This document — per-experiment hypothesis/method/command/measurement/verdict,
  the 16-item trap list, and the confirmed/refuted status of all six defects.
- **Verification:** 14 scratchpad scripts with captured output at
  `C:\Users\DEBASI~1\AppData\Local\Temp\claude\d--WorkStation-Projects-Stock-Mania\9b5d9c82-c7bc-4dd6-a25d-0031fcfad517\scratchpad\`.
  Repository build/lint/test not run — this lane changed no repository code.
- **Open risks:** **Deployment egress unmeasured (research A1/H1) — the one unresolved blocker.**
  Demergers have no free automated fix. Yahoo is undocumented and can change without notice.
  E6 probed a burst and one hour, not a multi-day quota.
- **Next action:** Have the **DevOps Expert** deploy the 5-endpoint probe route described in E7 and
  report 10 runs. If it passes, hand this document plus the research document to the
  **Planner/Implementer** for a plan against X1–X8 and defects D-3, D-4, D-5, D-6. If it fails,
  escalate — the primary stack must be re-planned on the bhavcopy archive first.
- **Do not revisit:** Stooq, `nseindia.com/api/*`, Yahoo `v7`/`v6` quote, `exchangerate.host`,
  Polygon/Massive, Alpha Vantage, Zerodha Kite quotes — all re-probed and eliminated.
  Also settled: `range=max` is unusable; Yahoo `close` is split-adjusted (do not re-derive splits
  from it); research defects **D-1 and D-2 are refuted** and need no fix.
