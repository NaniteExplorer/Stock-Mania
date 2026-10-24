# Product requirement — Stock-Mania

Updated: 2026-10-24
Audience: both implementing agents (Claude, Codex) and any human reviewer.

This document says **what the product is for and why**. It holds no schemas, no
components and no task lists; those are in [`ARCHITECTURE.md`](ARCHITECTURE.md),
[`DESIGN.md`](DESIGN.md) and [`TASKS.md`](TASKS.md). If this document and the code
disagree about *intent*, this document wins. If they disagree about *mechanism*,
`ARCHITECTURE.md` wins.

---

## 1. What this is

A **single-user personal finance manager for the Indian market**. One owner, one
household, one set of books. Not a product for sale, not multi-tenant, not advisory.

It answers four questions, in this order of importance:

1. **Where is my money?** Bank accounts, investments, physical assets, debts.
2. **Where is it going?** Expenses, recurring commitments, insurance, major spends.
3. **Where is it coming from?** Income streams, expected versus actual.
4. **How am I doing?** A financial-health rating, a lifetime trajectory, and a
   projection to retirement — each stated with its uncertainty.

Questions 1 and 2 are substantially built. Question 3 is partial. Question 4 does not
exist yet and is the subject of the current plan.

**Status clarification (2026-10-24):** the preceding sentence is the planning baseline,
not a fresh code audit. `TASKS.md` records F/P0–P6 delivery; the rebuild plan records its
own historical completion and QA. Feature descriptions below express intended behaviour.

## 2. The owner

An Indian software professional tracking their own finances. Relevant consequences:

- **Income is above the 90th percentile of the Indian distribution**, which is exactly
  the band where India's published income data stops resolving. Any placement the
  product shows in that band is a model, not a measurement, and must say so.
- They will **underestimate their national rank and overestimate their global rank**,
  because their reference group is other software professionals. Lead with the
  comparison most likely to be accurate, not the most dramatic.
- They are technical, and will notice a number that cannot be sourced. Credibility is
  the product's main asset; one invented figure costs more than ten missing ones.

## 3. Entry modes — the three-way taxonomy

This is settled and is the single most misunderstood thing about the product.

| Mode | What | Scope |
|---|---|---|
| **File-parsed** | Bank account statements | **Banks only.** PDF, CSV, TSV, TXT, XLSX, XLS, OFX, QFX. JSON is *not* supported today despite being asked about |
| **Manual** | Everything owned | Investments, trades, cards, loans, deposits, physical assets, insurance, recurring commitments, major spends, income streams |
| **Auto-fetched** | Prices only | NAVs, quotes, FX. Never transactions, never splits, never dividends — the owner logs those |

Statement parsing stays bank-account-only. The four new domains are **all manual**.

**Planned extension (2026-10-24):** §5.3 describes equity filing data beyond this current
prices-only taxonomy. It does not claim an implemented fundamentals feed or authorise
ingestion: RULES.md §4.3 remains binding, and its prices-only restriction plus §4.4's
two-provider requirement must be reconciled explicitly before fundamentals ingestion
can be implemented. Document reconciliation does not amend either rule.

## 4. The four domains being added

### 4.1 Insurance
Health, term, and any other policy. Annual or monthly premium. The point is not a
coverage score — no authoritative Indian sum-insured threshold exists — but **presence,
premium outgo, and renewal dates**. Cover erosion against medical inflation is shown as
*information*, cited as a consultancy survey, never as an official statistic.

### 4.2 Recurring commitments
OTT, mobile, broadband, courses, degree fees, memberships, anything that renews. This is
a **first-class domain, not an expense category**. A category loses the four things that
matter: cadence, next renewal date, price-change-at-renewal, and cancel-by date — and it
loses the one number the owner actually wants: **total committed outgo per month and per
year, and what is quietly auto-renewing.**

### 4.3 Major spends
Gadgets, vacations, asset acquisition. Where the spend acquires something that still has
value, it links to a physical asset with a depreciation model — labelled a model, with
its rate shown, never presented as an observation.

### 4.4 Income streams
Salary, freelance, bonus, rent received, and anything else. Carries employer, expected
amount and cadence, so that **a missed inflow reads as missing rather than as zero
income**.

## 5. The rating system

A financial-health rating over the whole picture: pillar scores, a composite, tiers,
badges, per-holding position quality, and percentile placement.

**Non-negotiable properties:**

- **Every indicator traces to a named formula and a sourced threshold**, shown with its
  source in the UI. No invented weights, no invented benchmarks.
- **Missing data is never scored as zero.** Three states are modelled and distinguished:
  measured / explicitly-declared-absent / unknown. Without this the product cannot tell
  an uninsured owner from one who has not typed it in, and will accuse one of being the
  other. A pillar with any unknown reports an em-dash; **the composite refuses to compute
  at all** until every pillar is computable, and says which one is missing.
- **Pillars are not fully compensable.** Aggregation is geometric across pillars, so a
  strong portfolio cannot cancel out having no health cover. Plus hard tier ceilings.
- **Per-holding scores describe, they do not prescribe.** *(Amended 2026-10-24 — the
  earlier wording said "position quality only" because "the app has no fundamentals
  feed". That premise is false: NSE publishes every listed company's filed results as
  keyless structured XBRL. The restraint survives, but on evidence rather than on a
  missing input — see §5.3.)* A holding is described against sourced data: its own
  history, its sector peers, and the filing the number came from. It is explicitly
  **not** a buy or sell call, and must never read as advice.

  **Mutual funds are the exception and the original reason still holds** — no
  fundamentals feed exists for a fund, and a NAV is a price. Fund-level scoring stays
  refused.
- **Every score ships with its coverage percentage and a sensitivity range**, recomputed
  under the plausible alternative benchmarks.

### 5.3 Equity fundamentals — describe, never prescribe *(added 2026-10-24)*

**Readiness clarification (2026-10-24):** this is intended scope based on the research
record, not shipped capability. Metric definitions and peer-set construction (B/E in
the financial-health requirement plan) are still unresearched to the required standard;
the ingestion rule conflicts noted in §3 also remain blockers.

Verified available, keyless, from NSE's own filings: quarterly and annual results back
at least seven years across **2,111 symbols**, with balance sheet and cash flow on
audited filings, filer-certified debt and coverage ratios, and promoter holding and
**pledging** with 23 quarters of history and revision flags. Two structural gifts: banks
and NBFCs carry **separate taxonomies** with gross NPA, ROA and capital ratios, so the
app never has to guess whether debt-to-equity applies; and the units and
consolidated-versus-standalone traps are **explicit machine-readable tags**.

So the app can now explain every datum, which is what was asked for. What it still will
not do is rank holdings into an action, and the reasons are now stronger than "we lack
the data":

- **The published edge is close to zero after costs.** Post-publication long-short
  anomaly returns are around **−3 bps a month net**, and **58%** lower after publication
  across 97 predictors; **65% of 452 anomalies fail** once microcaps are controlled — a
  critique that bites harder in India, where surveillance frameworks hit exactly the
  illiquid names a value screen selects.
- **Sell is worse than buy, three independent ways.** Most anomaly alpha sits on the
  **short leg**, which a long-only portfolio cannot capture; the **8.3pp STCG-to-LTCG tax
  gap is certain while the edge is not**, so acting on a sell signal has negative
  expected value where a buy signal is merely unproven; and the best-documented cost
  mitigation in the literature is a **buy/hold spread** — stricter to enter than to keep
  holding.
- **No study tests a fundamental screen net of current Indian tax.** That is the largest
  evidence gap, and it sits exactly where a recommendation would live.

**Refused outright:** the Beneish M-Score (a 1999 US-manufacturer model with roughly a
**17.5% false-positive rate** — it would label the owner's own holdings probable
manipulators) and any Altman-derived distress *probability* (no Indian holdout validation
found).

**Shown instead:** a ratio against its own 5-year median and its sector median; promoter
pledging over time; gross NPA against a peer distribution; and the Piotroski F-Score
**itemised as its nine components, never totalled into an action**. Every number carries
its filing URL, filing date and units tag.

**Ingestion is holdings-scoped and on filing-event cadence, never a market-wide sweep.**
That is both defensible under NSE's anti-scraping clause and, per the evidence above, the
thing that has no edge anyway — the ethical and empirical answers coincide.

### 5.1 Percentile placement — two scales

**India and World.** Each placement is a **band with stated uncertainty, widening above
the 90th percentile**, where Indian data stops resolving. Cross-country comparison uses
the World Bank private-consumption PPP factor, not the nominal exchange rate — nominal
conversion places an Indian salary several deciles too low, which is a false statement
about the owner's material standard of living.

Progression uses **log-ratio-to-median**, not percentile, because percentile saturates at
the top and moves when the population moves. **Every percentile change is decomposed** —
"your percentile fell 2 points: your real income rose 3%, the distribution rose 6%" —
which turns a demoralising artefact into information.

**ELO is rejected.** It is a maximum-likelihood update on pairwise outcomes; with no
opponent and no match result there is nothing for the update rule to consume. An "ELO"
built from income is a percentile in a costume.

### 5.2 Example rungs — dropped
Billionaire net-worth figures are estimates with unpublished error margins, and they are a
**unit error**: net worth is a stock, salary is a flow, and they cannot share an axis.
"Senior developer in India" is not sourceable — aggregators disagree by about 2x and
describe their numbers as predictions. Replaced by **sourced anonymous archetypes**
("median Indian urban household: Rs 6,996 MPCE, HCES 2023-24").

## 6. Projection to retirement

Legitimate, but **a distribution, not a line**. Deterministic compounding implies a
precision that does not exist, and the SIP-suspension lever is precisely a
sequence-of-returns question, which an averaged curve erases.

- **Real rupees as the headline**, nominal as a toggle. At 6% inflation over 30 years,
  purchasing power divides by about 5.7.
- **A count of historical scenarios, never a probability.** Stated probabilities are read
  regressively — "very likely" is typically read as about 70% — with the error worst at
  the extremes.
- **A fan chart with a faded, explicitly open-ended outer band.** A crisp edge is read as
  a hard bound.
- **33x expenses as the independence marker**, the reciprocal of the India-calibrated
  3.0% safe withdrawal rate, cited on screen. Never 25x, which is the reciprocal of the
  US 4% rule. Never income-multiple milestones.
- **Refuses rather than guesses.** Under 12 months of history, thin categorisation
  coverage, an unresolved asset mix, or an unverified required assumption produces a
  refusal naming the cause — never a quietly smaller number.

## 7. Alerts

Factual, rare, and about the owner's own state — never about what the market will do.

**Planned/allowed, not a delivery claim (corrected 2026-10-24):** approaching STCG-to-LTCG boundary (worth 8.3 percentage points of tax rate,
and requiring no view about the future); unused LTCG exemption late in the financial year;
allocation band breach, offering the cash-flow route first; concentration past a set
threshold; emergency fund below target; and **data-source failure**, because silent
staleness is the product's biggest correctness risk.

**Refused, with reasons:** any forecast of which asset will grow; automated allocation
recommendations; a political-event detector (no machine-detectable primitive exists, and
the published evidence finds no durable election effect on the NIFTY); volatility
targeting; and **price-movement push notifications of any kind** — a randomised experiment
with over 9,000 people found push notifications raise trade count by 11% regardless of
content, so the channel is itself the harm.

**Not building the tactical feature is worth about 1.2 percentage points a year** — the
measured investor-behaviour gap — which is more than any tactical rule in the published
literature delivers.

## 8. Gamification

**Planned/allowed, not a delivery claim (corrected 2026-10-24):** streaks on logging and reconciliation; badges for reaching a state that is slow
and real (emergency fund at six months, a loan closed, cover reaching adequacy);
progress-to-next-tier; comparison against the owner's own past.

**Refused:** anything rewarding transaction count or frequency (a randomised experiment
found points for trading produced 39% more trades); leaderboards and peer rankings;
breakable streaks and loss-framed progress; celebration animations on gains; and
**celebrating a tier drop**, ever.

## 9. The house rule

> **An em-dash is an admission, a zero is a claim.**

A number the product cannot compute is shown as an em-dash, keyboard-reachable, carrying
the reason it is unavailable. It is never shown as zero, and never silently replaced by a
default. This rule outranks completeness, visual tidiness, and the desire to fill a tile.

## 10. Out of scope, permanently

Multi-user or multi-tenant operation; any paid API or AI service; AI transaction
categorisation (categories come from owner-maintained keywords); broker connectivity;
credit-card APR, reward-rate or interest-projection features (cards are a record-keeping
surface, entered manually); and `/liabilities` as a route, which is retired.

**Note on regulation:** SEBI's Investment Adviser regulations do not apply to a
single-owner tool — registration triggers on acting or holding out as an adviser, and the
definition requires consideration, business and clients. The restraints above are
justified by evidence, not by law. **If a second user is ever onboarded, free or paid, the
line is crossed**, and the binding rule from that moment is: never state or imply an
expected return.
