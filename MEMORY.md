# Memory — settled decisions

Updated: 2026-10-24

**What this file is for.** Decisions that are already made, with the reason that made
them. Neither agent reopens anything recorded here. If you think an entry is wrong,
bring evidence and amend it with a dated correction — do not silently work around it.

**What this file is not for.** Anything still open. Open items live in
[`TASKS.md`](TASKS.md) under *Blocking decisions*. A decision moves here only once it is
settled.

**Both agents write here.** When you settle something, record it in the same change that
settles it — the other agent cannot read your conversation.

---

## Architecture

**A1. One multi-commodity double-entry ledger.** A grocery purchase and an equity buy are
the same object: a balanced set of postings. *Reason: it is what lets budgeting and
portfolio analytics share a spine.*

**A2. libSQL/SQLite, not Postgres.** *Reason: the balance invariant lives in the domain
classes rather than a deferred trigger. Recorded with its cost in `70-UPGRADE-PLAN.md`.*

**A3. Next.js server actions, not Fastify + tRPC + OpenAPI.** No separate Python
analytics service. No monorepo. *Reason: one owner, one deployment; the v1 infrastructure
(Kafka, Redis, Kubernetes, Inngest) served one person and was removed.*

**A4. Money is `Money` — bigint minor units; no `number` on any money path.** *Reason:
float drift in a financial calculation is undetectable until it is a wrong tax return.*

**A5. Derived, never stored.** Balances and valuations are computed from postings.
*Reason: a stored aggregate is a second source of truth and will drift.*

**A6. Bitemporal prices** (`as_of` vs `ingested_at`, keyed by provider). *Reason: costs
one column now; without it every future backtest has unrecoverable lookahead bias.*

**A7. Corporate actions are replayable ledger transactions**, never in-place lot edits.

**A8. Nothing is hard-deleted.** Corrections are reversals; every mutation is audited.

---

## The mutation model (recorded 2026-10-21; approval scope clarified 2026-10-24)

M1–M5 describe the storage design; implementation remains on TASKS.md P2. D1–D7 in
that board remain owner decisions, including retention, redo scope and bulk-removal
policy. Historical design wording below is not evidence of owner approval or delivery.

**M1. Three data classes, and every table belongs to exactly one.**
**A** — ledger, append-only (transactions, postings, trades, lots, corporate actions,
imports): post / reverse / tombstone / restore.
**B** — reference, mutable (category rules, budgets, instruments, loan terms,
institutions, counterparties, and the four new domains): `UPDATE` in place plus tombstone.
**C** — system, no user verbs at all (price quotes, FX rates, audit events, snapshots,
tax rules, projection cache).

**M2. A class B header that *generates* postings stays B; its postings are A.** Editing a
loan's rate is effective-dated, never a retroactive rewrite. *The straddlers worth a
second look: `gold_leases`, `deposit_contributions`, `instrument_incomes`.*

**M3. Undo is tombstone/restore, never reverse-a-reversal.** Reversing a reversal is
blocked because it makes the current state unreadable — but a reversal is itself a row,
and a row can be tombstoned. Undo of an edit tombstones the reversal *and* the
replacement; the original returns to every balance and the evidence stays behind a
filter. *Reason: this is what lets full CRUD verbs sit over an append-only ledger without
weakening it at all.*

**M4. `restore()` is the only new repository primitive required.** The inverse of
`softDelete`. Nothing else about the ledger changes.

**M5. The batch identity already exists: `audit_events.request_id`.** One row edited,
fifteen removed, a whole import undone — same unit, no new table. *So the entire model's
missing pieces are `restore()` plus an Activity screen.*

**M6. A true multi-step ledger redo stack is rejected.** It needs a command log that does
not exist, and it would be a second source of truth beside the ledger. **Correction
2026-10-24:** a one-step cursor for class A and a bounded class B stack are the
recommendation pending D3, not an approved feature scope.

---

## Product

**DOC-R1 (2026-10-24). Documentation authority and status clarified.** TASKS.md owns
F/P0–P6 execution; 70-UPGRADE-PLAN.md owns architecture rebuild progress and historical
QA. Product prose and mockups do not certify delivery. Alerts and badges are intended
scope until their task acceptance is verified. D1–D7 remain owner decisions. The
Elevation Pass After page scales supersede Institutional Shell scales; Control Bench
retains component geometry and corrected colours. D.1.s still must integrate the
new scales before F.0. These are reconciliation decisions, not new feature approval.

**P1. Three entry modes, and only one is file-parsed.** Banks are parsed from files;
everything owned is manual; prices only are auto-fetched. *JSON is not a supported
statement format today despite being assumed to be.*

**P1a (2026-10-24). Fundamentals are a planned extension, not an existing feed.** P3
and product §5.3 supersede the old claim that equity filings are unavailable. They do
not supersede RULES.md §4.3's prices-only restriction or §4.4's two-provider rule.
Fundamentals ingestion stays blocked until those conflicts are explicitly resolved;
no rule was amended by DOC-R1.

**P2. Recurring commitments are a first-class domain, not an expense category.** *Reason:
a category loses cadence, renewal date, price-change-at-renewal and cancel-by — and loses
the one number the owner wants, total committed outgo.*

**P3. Per-holding scoring describes, never prescribes.** *(Amended 2026-10-24. The
original read "position quality only... no fundamentals feed". **The premise was false** —
NSE publishes filed results as keyless structured XBRL, 2,111 symbols, seven years,
including promoter pledging and bank-specific taxonomies. The conclusion survives, on
evidence instead: post-publication anomaly returns of about −3 bps/month net, 58% decay
across 97 predictors, 65% of 452 anomalies failing once microcaps are controlled, and
sell being worse than buy three ways — short-leg alpha a long-only portfolio cannot
capture, a certain 8.3pp tax gap against an uncertain edge, and the literature's best
cost mitigation being a buy/hold spread.)* Describe a holding against its own history,
its sector peers and the filing the number came from. Never rank into an action.
**Mutual funds keep the original refusal** — no fundamentals exist for a fund, and a NAV
is a price.

**P3a. Never ship the Beneish M-Score** (~17.5% false-positive rate on a 1999
US-manufacturer model) **or an Altman-derived distress probability** (no Indian holdout
validation). Show the Piotroski F-Score only as its nine itemised components, never as a
total.

**P4. ELO is rejected.** It is a maximum-likelihood update on pairwise outcomes; with no
opponent and no match result there is nothing for the update rule to consume. An "ELO"
from income is a percentile in a costume. **Percentile for placement, log-ratio-to-median
for progression.**

**P5. Percentile runs on two scales: India and World.** PPP-converted via the World Bank
private-consumption factor — nominal conversion places an Indian salary several deciles
too low, which is a false statement about the owner's standard of living.

**P6. Above roughly the 90th Indian percentile the product quotes a model, not an
observation** — and that is exactly the band the owner occupies. Render a single "top 10%"
band with stated uncertainty and refuse to resolve further.

**P7. Celebrity rungs are dropped.** Billionaire figures are estimates with unpublished
error margins, and pairing net worth with salary is a unit error — a stock against a flow.
"Senior developer in India" is not sourceable. Replaced by sourced anonymous archetypes.

**P8. `/liabilities` is retired. Cards are record-keeping only** — manual values, no APR,
reward-rate or interest-projection features. Saved views are in scope for v2.

---

## Scoring methodology

**S1. No Indian scored instrument exists to copy.** Nothing from SEBI, RBI, IRDAI or NCFE
provides a balance-sheet rubric. The skeleton is international convention with Indian
parameter values substituted and cited.

**S2. FinHealth Score is the right architecture and a registered trademark.** Imitate the
structure (four pillars, equal weight, three tiers, all-or-nothing completeness); never
the name or the item wording. CFPB's scale is free of copyright but is a 10-item
attitudinal survey — usable *beside* the computed score, never computed from ledger data.

**S3. Weighting is equal, and the UI says why.** In an additive composite, weights are
trade-off ratios, not importances — so an "importance" weighting would be technically
wrong as well as unsourced.

**S4. Aggregation is geometric across pillars, arithmetic within**, plus non-compensatory
tier ceilings. *Reason: arithmetic is fully compensable and would let a strong portfolio
cancel out having no health cover.*

**S5. Missing data is never zero.** Measured / declared-absent / unknown are three states,
never collapsed. *Reason: without this the product cannot tell an uninsured owner from one
who has not typed it in, and will accuse one of being the other.*

**S6. The composite refuses entirely until every pillar is computable** — and that orders
the build: insurance and commitments first, scoring second.

---

## Numbers refused, and why

Each of these was looked for and found not to exist, or found to be something other than
what it is usually claimed to be. **Do not reintroduce them.**

- **FOIR attributed to RBI** — no RBI document defines or caps it. Lender underwriting
  practice only, published thresholds ranging 40–100%.
- **"FOIR including subscriptions"** — no lender definition includes them. A committed-outgo
  ratio that does must carry a different, app-owned name.
- **50/30/20 as a standard** — a 2005 trade book heuristic whose "needs" bucket is
  needs-vs-wants, not fixed-vs-variable.
- **"90% underestimate their subscriptions"** — vendor market research, not peer-reviewed.
- **FTC Click-to-Cancel as current law** — vacated by the Eighth Circuit, 8 July 2025.
- **Any FCA position on subscription traps** — none found.
- **A national net-worth-by-age comparison band** — no published AIDIS table breaks net
  worth by age, and AIDIS values are as of 30 June 2018.
- **A medical-inflation rate attributed to IRDAI** — IRDAI told Parliament it has conducted
  no such study. The 12–14% figures are consultancy and insurer surveys.
- **An absolute rupee health sum-insured threshold** — no authoritative Indian figure
  exists. Score presence only.
- **Any SEBI position on gamification** — none found. Do not imply regulator backing the
  product does not have.
- **A stated US or Indian top-1% income cutoff presented as official** — neither exists.
  US Census resolves only to the top 5%.
- **The Fidelity "1x salary by 30, 10x by 67" rule** — a marketing convention with no
  research basis, assuming US Social Security and the most favourable equity series in the
  world.
- **The US 4% rule and a 25x milestone** — India-specific research puts the safe
  withdrawal rate at 3.0–3.5%. Use 33x.

---

## Regulation

**R1. SEBI's Investment Adviser regulations do not apply to a single-owner tool.**
Registration triggers on *acting as* or *holding out as* an adviser, and the definition
requires consideration, business and clients. A tracker built for oneself has none,
**regardless of how prescriptive its output is.** *An earlier claim that registration
might constrain the feature was wrong and was corrected on 2026-10-21.*

**R2. The line is crossed the moment a second user is onboarded** — free or paid — or the
app is published or described as giving recommendations. From that moment the binding rule
is: **never state or imply an expected return.** Cheap to design for now, expensive to
retrofit.

**R3. AMFI Circular 109/2023-24 is both the prohibition and the template.** Clause 8:
"no future returns can be shown even on illustration basis." Clause 9 permits calculators
letting the user pick a return from **2% to 13%** — so an editable-assumptions design *is*
the compliant design. Whether it binds a non-distributing personal tool is unresolved;
posture is **voluntary compliance**, which costs little.

---

## Evidence that settled a design argument

**E1. Not building tactical alerts is worth about 1.2 percentage points a year** — the
measured investor-behaviour gap, stable across a decade. Larger than any tactical rule in
the published literature delivers.

**E2. The notification channel is itself the harm.** A randomised experiment with over
9,000 people found **push notifications raise trade count by 11% regardless of content**,
with larger effects on those with lower financial literacy. So the constraint is about
channel and frequency, not content.

**E3. Indian tax arithmetic ends the tactical debate.** On a 12% gross return,
buy-and-hold nets about 11.0% CAGR; a rule realising gains inside 12 months nets **9.50%**.
**An Indian tactical rule needs roughly 2 percentage points of annual outperformance just
to draw level with doing nothing.**

**E4. The STCG-to-LTCG boundary is worth 8.3 percentage points of tax rate** (20.8% to
12.5%) and requires no view about the future. The single highest-value alert in the
product.

**E5. Threshold-band rebalancing is the one place the app beats the literature's
assumption.** Published research objects that threshold rules need daily monitoring and
are "not practical for investors who manage their own portfolios" — which is exactly what
the app dissolves, since it already ingests daily NAVs. Bands must be **wider than 5/25**,
because in India tax is the dominant transaction cost. Prefer **cash-flow rebalancing** —
point the next SIP at the underweight sleeve, realising no gain at all.

**E6. A one-year shift in the measurement start moves the measured NIFTY CAGR from 7.21%
to 12.14%** — roughly a 3x difference in terminal corpus over 30 years. *No single return
assumption is a fact, and this belongs on the projection's opening screen.*

**E7. Stated probabilities are read regressively**, pulled toward 50%, with the error
worst at the extremes. Hence a **count of historical scenarios**, never a probability.

**E8. Political-event detection is infeasible and the effect may not exist.** No
machine-detectable primitive; the keyword's base rate is weekly against a real base rate of
about once a decade; and the published work finds no significant election effect on the
NIFTY.

**E9. Points for trading produced 39% more trades** in a randomised experiment — which is
why no badge rewards transaction count or frequency.

**E10. NPS annuitisation dropped to 20% for non-government subscribers** on 16 Dec 2025
(from 40%). *A projection treating an NPS corpus as fully spendable overstates retirement
income by up to 20%.*

---

## Defects found and recorded

**X1. `debtToIncome` reports 0% rather than refusing.** The use case passes
`monthlyDebtPayments: Money.zero()` with a comment saying "zero here means not measured,
and the metric returns null rather than a misleading 0%" — but the domain keys its null on
*income* being zero, not on payments being unmeasured. **A user with income and loans is
shown 0% debt-to-income.** A live house-rule violation, independent of the redesign.
Fixed by task 0.1.

**X2. The owner's reported balance bug is not a parsing failure.** An account whose first
imported statement starts mid-life has no opening balance posted, and the arithmetic is
exact: the shortfall equals the statement's implied opening balance minus the ledger
balance the day before. The real cause is a period that was never imported. Full analysis
in `_architecture/requirements/pdf-geometry-reader-drops-rows.md`. Surfaced by task 0.4.

**X3. The SBI geometry reader's column mapping is still wrong.** An earlier fix stopped it
*winning* against the text path; it did not repair the mapping. Task 0.3.
