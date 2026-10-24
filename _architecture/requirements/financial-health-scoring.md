# Financial health scoring, lifecycle tracking, and the rating dashboard

Status: READY
Owner: Coordinator
Updated: 2026-10-24

## Requirement

### DOC-R1 — document reconciliation (2026-10-24)

Status: QA. Owner: Codex coordinator.
Chosen path: Direct implementation. Primary mode: Implementation (documentation only).
The owner authorised reconciliation and independent QA; this does not authorise P0 or production work.

Acceptance criteria:
- [x] Progress authority is scoped between the rebuild plan and the current task board.
- [x] Equity fundamentals wording follows PRODUCT-REQUIREMENT.md §5.3 without claiming ingestion is implemented.
- [x] Planned alerts/badges are not described as verified shipped features.
- [x] D1–D7 remain owner decisions; recommended mutation designs are labelled pending where applicable.
- [x] Elevation source precedence and the outstanding D.1.s gate are explicit; no new design choices are invented.
- [ ] Independent QA approves the scoped changes and records checks and residual risks.

Context map: PRODUCT-REQUIREMENT.md §§5,7,8 (intent); TASKS.md (execution and owner gates);
MEMORY.md (settled decisions); ARCHITECTURE.md §10 (mutation contract); DESIGN.md and
_design/README.md (visual authority); CONVERSATION.md (D.1.s handoff);
_architecture/00-INDEX.md and 70-UPGRADE-PLAN.md (rebuild progress).

Step-by-step plan:
- [x] 1. Read the named documents and inspect git status; preserve all existing staged changes.
- [x] 2. Documentation implementer amends only the named Markdown files, adds DOC-R1 to TASKS.md,
  corrects stale assertions with dated supersession notes, and records decisions in MEMORY.md.
- [x] 3. Verify scoped diff, local links and targeted consistency searches; document skipped code checks.
- [ ] 4. Independent QA reviews the actual changes against these criteria, records approval or defects.
- [ ] 5. Coordinator records final status and releases the claim in CONVERSATION.md.

Handoff — Coordinator -> Documentation implementer:
Use the existing document authority to reconcile wording. Do not decide D1–D7, change
binding rules, edit mockup source, certify legal/financial research, or claim production
features passed verification. Existing staged changes belong to the owner and stay staged.

QA record: NOT_RUN (independent review pending).
Implementer evidence: scoped `git diff --check -- <nine owned Markdown paths>` passed
(CRLF conversion warnings only); PowerShell local Markdown link check passed, 23/23
targets exist. Reviewed the scoped diff and targeted `rg` results for authority,
fundamentals, D3/D5 and status wording. No runtime tests, lint, typecheck or build run:
only Markdown changed; no production or mockup code changed. A whole-working-tree
`git diff --check` found an extra blank line at CONVERSATION.md EOF from the coordinator's
claim append; that log is outside the implementer's ownership and is handed back for repair.

## Baton: Documentation implementer -> Testing/QA Agent (DOC-R1)
- Goal: independently verify the six DOC-R1 acceptance criteria above.
- Completed: nine scoped Markdown files reconciled; board task added; old phase tables
  labelled historical rationale and current TASKS ownership made explicit.
- Decisions: no D1–D7 decision approved, no binding rule changed, no delivery inferred.
- Inputs: the DOC-R1 plan; actual unstaged diff of the nine owned paths; CONVERSATION.md
  D.1.s handoff; RULES.md §§4,5,7 for precedence and preservation checks.
- Changed files: TASKS.md, MEMORY.md, PRODUCT-REQUIREMENT.md, ARCHITECTURE.md, DESIGN.md,
  _design/README.md, _architecture/00-INDEX.md, _architecture/70-UPGRADE-PLAN.md,
  _architecture/requirements/financial-health-scoring.md.
- Contract/output: current execution is TASKS-owned; descriptive fundamentals remain
  gated by B/E research and RULES §4.3/§4.4; elevation D.1.s remains pending.
- Verification: scoped whitespace check PASS; 23 local link targets PASS; no staging
  or commit commands used, and pre-existing index entries remain in place.
- Open risks: unresolved owner/design/research gates remain explicit; historical
  legal/financial claims were not independently researched or recertified; coordinator
  should repair its CONVERSATION.md EOF whitespace before final whole-tree check.
- Next action: independent QA inspects the diff and records PASS/PASS_WITH_RISKS/FAIL.
- Do not revisit: production implementation, mockup source, D1–D7 policy choices or
  framework APIs; they are outside DOC-R1.


## Original product requirement (2026-10-21; wording corrected 2026-10-24)

Extend Stock-Mania from a tracker into an end-to-end financial manager by adding four
manually-entered domains — **insurance policies and their premiums**, **major one-off
spends** (gadgets, vacations, asset acquisition), **recurring commitments**
(OTT and other subscriptions, mobile and broadband recharges, courses, degree fees,
memberships, and anything else that renews), and **income streams** (salary,
freelance, bonus, and every other intake) — and then layering a **financial-health
rating** over the whole picture: tiers, pillar scores, badges, per-holding position
quality, and a net-worth-against-age chart with milestones.

## Execution path

Chosen by the user on 2026-10-21: **research then implementation**, i.e. research ->
mockups -> written implementation plan. Primary mode for this document: Research.
Production code requires a separate go-ahead after the user reviews the mockups.

## Decisions and constraints

- **Score basis: published ratios plus Indian benchmarks.** Every indicator traces to a
  named formula and a sourced threshold (RBI, SEBI, IRDAI, NCFE, or a stated planning
  convention), shown with its source in the UI. No invented weights.
- **Per-holding context describes, never prescribes (corrected 2026-10-24).** The
  earlier "no fundamentals feed" premise is superseded by the stock-fundamentals
  findings below and PRODUCT-REQUIREMENT.md §5.3. Position metrics remain useful;
  equity filing data may add own-history and peer context, never a buy/sell ranking.
  No fundamentals ingestion is claimed implemented. Fund-level fundamentals scoring
  stays refused. Per-metric definitions and peer construction (research B/E below)
  remain unfinished; ingestion also requires explicit resolution of RULES.md §4.3
  (prices only) and §4.4 (two providers). Those affected tasks remain blocked.
- **Recurring commitments are a first-class domain, not a category.** A subscription
  has a cadence, a next renewal date, a price that changes at renewal, and a
  cancel-by date. Modelling it as a mere expense category loses all four, and loses
  the one number the user actually wants: total committed outgo per month and per
  year, and what is quietly auto-renewing.
- **All four new domains are manually entered.** Statement parsing stays bank-account
  only. See [[product-emphasis-banking-not-cards]] in the session memory.
- **Refusing to score is a valid outcome.** The house rule — an em-dash is an
  admission, a zero is a claim — applies to the score itself. Missing insurance data
  must read as unknown, not as a low score.
- No paid APIs or AI services; keyless free sources only.

## Open questions for research

- [ ] Which public scoring frameworks are free to implement versus trademarked.
- [ ] Indian benchmark values and their sources: emergency fund months, term cover
      income multiple, health sum insured and medical inflation, household savings
      rate, FOIR, retirement corpus convention.
- [ ] Composite-index construction: normalisation, weighting, and whether pillars
      should be compensatory.
- [ ] Scoring under incomplete data: the standard practice for reporting coverage
      alongside a score.
- [ ] Which gamification mechanics are evidenced as helpful and which are documented
      as behaviour-distorting.
- [ ] Whether the user's birth year is knowable from existing data or must be captured.

## Step-by-step plan

- [ ] 1. Repo inventory of existing coverage for insurance, recurring commitments,
      major spends, income, and
      already-computed metrics — Owner: Research — Files: src/infra/db/schema.ts,
      src/domain/, src/app/*.usecases.ts — Verify: every claim carries file:line.
- [ ] 2. Scoring-methodology research — Owner: Research — Verify: every threshold
      carries a primary-source URL and a date.
- [ ] 3. Mockups for the four new tracking surfaces — Owner: Design — Verify: matches
      the Control Bench component library and the v2 token set.
- [ ] 4. Mockup for the rating dashboard — Owner: Design — Verify: no score is shown
      that the inventory in step 1 cannot compute.
- [ ] 5. Implementation plan — Owner: Planner — written only after the user reviews
      the mockups.

## QA record

Status: NOT_RUN

## Scope addition 2026-10-21: alerting and projection

The user asked for a recommendation algorithm reacting to US and Indian market falls,
crude oil, and political events, able to predict which assets will grow; and for a
projection of investments to a chosen retirement age, including the effect of
suspending the SIP after X years.

Coordinator's position, put to research for challenge rather than confirmation:

- **Forecasting which assets will grow is not implementable credibly** and is the exact
  failure the credibility rule exists to prevent. Research must either support this or
  name an approach dismissed too fast.
- **Defensible instead:** alerts on observable state (drawdown from peak, allocation
  drift past a band, concentration, an approaching STCG-to-LTCG boundary, emergency
  fund below target), rules the user authored in advance firing against the existing
  `rebalanceAmount`, and historical percentile context that locates the present without
  claiming to know the future.
- **Projection is legitimate** but must be a distribution, not a line. Deterministic
  compounding implies a precision that does not exist, and the SIP-suspension lever is
  precisely a sequence-of-returns question, which an averaged curve erases.
- **Two binding external constraints to establish:** whether SEBI treats
  allocation suggestions as investment advice requiring registration, and what SEBI or
  AMFI rules govern the return assumptions a projection may display.
- **Data constraint:** every signal needs a keyless free source at daily resolution.
  US indices, crude, USD/INR, the 10-year yield, gold, CPI, FII/DII flows and India VIX
  are each to be confirmed or marked unavailable. Political events are expected to be
  the weakest item and may be refused outright.

Open until research reports. No surface is designed for any signal whose data source is
unconfirmed.

## Research findings 2026-10-21 (steps 1 and 2)

### Repo inventory — what the four new domains can stand on

| Thing | Verdict | Evidence |
|---|---|---|
| Insurance policy entity | ABSENT | only `Expenses:Insurance` (`src/domain/accounts.ts:767`) and 4 keywords (`src/domain/banking.ts:228`) |
| Subscription / recurring-commitment entity | ABSENT | only a category (`src/domain/accounts.ts:774`) and 6 keywords |
| General recurrence engine | ABSENT | cadence exists only inside credit products: `loan_terms` (`src/infra/db/schema.ts:1693`), `deposit_terms` (`:1532`), gold-lease payout (`:1082`) |
| Forward-looking due/renewal date | ABSENT | no `next_due`, `renewal` or `cancel_by` anywhere; only loans have a derivable schedule |
| Expense to asset-acquisition link | ABSENT, and blocked | a posting may carry a `categoryId` or an `instrumentId`, never both — CHECK `postings_no_category_on_commodity`, invariant L12 |
| Acquisition cost and depreciation | PARTIAL, unpersisted | `Vehicle.purchase` and `Vehicle.depreciatedValueOn()` (`src/domain/assets.ts:1045`, `:1066`); no `physical_assets` table at all |
| Income streams | PARTIAL | income accounts exist; no stream entity, no expected-vs-actual, no employer. Freelance, bonus and rent-received have accounts but no keyword rule |
| Merchant identity | FULLY MODELLED | `counterparties.normalisedName`, unique per user (`src/infra/db/schema.ts:1967`) — the stable key recurrence detection needs |
| Committed outgo total | ABSENT but one case | only "Monthly commitment" on the loans page (`app/(root)/loans/page.tsx:54`) |
| Date of birth / age | ABSENT | `user` table is Better-Auth shaped, 7 columns, no DOB (`src/infra/db/schema.ts:95-107`). Must be newly captured for the net-worth-vs-age chart |

Already computable and reusable: `personalMetrics` (`src/domain/reports.ts:286`) giving savings rate,
burn rate, runway, debt-to-income, credit utilisation; `allocation()` with drift and
`rebalanceAmount` (`src/domain/portfolio.ts:660`); `xirr` (`:122`); `maxDrawdown` (`:464`);
Sharpe/Sortino/beta/alpha/VaR; `payoffPlan` and `comparePayoffStrategies` (`src/domain/loans.ts:508`, `:608`);
and `net_worth_snapshots` (`src/infra/db/schema.ts:1809`), which already stores assets,
liabilities, net worth, investments, income and expense per month — the whole spine of the
lifetime chart.

Missing and needed: CAGR, HHI concentration, emergency fund as a distinct metric, goals of
any kind, a stored target allocation (drift is computable but has no persisted target),
and fund expense ratios.

### Defect found: `debtToIncome` reports 0% rather than refusing

`src/app/reports.usecases.ts:352` passes `monthlyDebtPayments: Money.zero()` with the comment
"zero here means not measured, and the metric returns null rather than a misleading 0%".
It does not. `src/domain/reports.ts:308` keys its null on income being zero, not on payments
being unmeasured, so a user with income and loans is shown 0% debt-to-income — the exact
misleading zero the comment says is avoided. This is a live violation of the house rule and is
independent of the redesign. Fix: make `monthlyDebtPayments` nullable and feed it from
`equatedInstalment()`.

### Scoring methodology — decisions taken

- No Indian scored instrument exists. NCFE's survey frame is knowledge/behaviour/attitude,
  not a balance-sheet rubric. Nothing from SEBI, RBI or IRDAI provides thresholds. The skeleton
  comes from international convention with Indian parameter values substituted and cited.
- CFPB Financial Well-Being Scale: free of copyright, but a 10-item attitudinal survey.
  Usable as an optional self-assessment beside the computed score; computing a "CFPB score"
  from ledger data would be meaningless. FinHealth Score(R) is the right architecture
  (4 pillars, equal-weight average, 3 tiers, all-or-nothing on completeness) but is a
  registered trademark — imitate the structure, never the name or the item wording.
- Normalisation: distance-to-target, `min(1, actual / benchmark)`, capped at 1. Min-max and
  z-score are undefined for a single household with no reference distribution.
- Weighting: equal, and say why. Per the OECD/JRC Handbook and Munda & Nardo, weights in an
  additive composite are trade-off ratios, not importances — so an "importance" weighting would
  be technically wrong as well as unsourced.
- Aggregation: geometric across pillars, arithmetic within. Arithmetic is fully compensable
  and would let a strong portfolio cancel out having no health cover. Plus non-compensatory
  tier ceilings: no health cover caps at the middle tier; FOIR over 50% bars the top tier.
- Three tiers, score always shown beside the label, distance-to-next-tier stated, and
  hysteresis on demotion so a tier does not flicker on noise. Never celebrate a tier drop.
- Missing data is never scored as zero. Three states must be modelled and distinguished:
  measured / explicitly-declared-absent / unknown. Without that the product cannot tell an
  uninsured user from one who has not typed it in, and will accuse one of being the other.
  A pillar with any unknown reports an em-dash; the composite is refused entirely until every
  pillar is computable, and says so as an onboarding prompt.
- Report data coverage and a sensitivity range with every score — recompute under the
  plausible alternative benchmarks (3 vs 6 months, 10x vs 15x, 3% vs 4% SWR) and show the range.

### Sequencing consequence

The Protect pillar needs an insurance entity, which does not exist. Under the all-or-nothing
completeness rule, the composite score cannot ship before the insurance model does. That
orders the build: insurance and recurring commitments first, scoring second.

### Gamification — settled by evidence

Build: streaks on logging and reconciliation; badges awarded for reaching a state that is slow
and real (emergency fund at 6 months, a loan closed, cover reaching adequacy); progress-to-next-tier;
comparison against the user's own past.

Refuse: anything rewarding transaction count or frequency (OSC/BIT 2024 randomised experiment —
points for trading produced 39% more trades); leaderboards and peer rankings (same study found
top-traded lists drive herding, and a leaderboard ranks income rather than behaviour); breakable
streaks and loss-framed progress; celebration animations on gains. Note: no SEBI publication on
gamification was found — the product must not imply regulator backing it does not have.

### Numbers refused

- FOIR attributed to RBI — no RBI document defines or caps it. It is lender underwriting
  practice, published only by lenders selling the loan. Published thresholds range 40%-100%
  depending on secured/unsecured and on whether the denominator is gross or net income, so there
  is no single number to show.
- "FOIR including subscriptions" — no lender definition includes them. A committed-outgo ratio
  that does must carry a different, app-owned name.
- 50/30/20 as a standard — a 2005 trade book heuristic; its "needs" bucket is needs-vs-wants,
  not fixed-vs-variable. Two category errors if scored against.
- "90% underestimate their subscriptions" — vendor market research (West Monroe, C+R), not
  peer-reviewed. The credible source is NBER w31547, which measures inattention via card-replacement
  natural experiments; its revenue figures are structural-model estimates, which must travel with it.
- FTC Click-to-Cancel as current law — vacated by the Eighth Circuit on 8 July 2025.
- Any FCA position on subscription traps — none found; do not attribute one.
- A national net-worth-by-age comparison band — no published AIDIS table breaks net worth by age,
  and AIDIS values are as of 30 June 2018. Building one means processing unit-level microdata from
  microdata.gov.in, which is a project, not a lookup. Until then the lifetime chart shows the user's
  own trajectory only.
- A medical-inflation rate attributed to IRDAI — IRDAI told Parliament it has conducted no such
  study. The 12-14% figures are consultancy and insurer surveys.
- Scoring health cover against an absolute rupee sum insured — no authoritative Indian figure
  exists. Score presence only; show erosion against cited medical inflation as information.
- Solvency ratio alongside debt-to-asset — arithmetic complements; scoring both double-weights
  one fact.

### Verification debt

Three primary PDFs refused automated fetch and must be opened by hand before any line sourced from
them becomes product copy: the OECD/JRC Handbook (aggregation chapter), the CFPB user guide (the
copyright statement), and the FinHealth Score toolkit. The 1996 Greninger et al. Delphi study is the
true provenance of most "standard" ratio thresholds and has not been read — its threshold table is
what the UI should cite instead of blogs.

## Tier and percentile placement — research findings 2026-10-21

### The construction

ELO is confirmed as the wrong mechanism: it is a maximum-likelihood update on pairwise
outcomes, and with no opponent and no match result there is nothing for the update rule to
consume. An "ELO" built from income is a monotone rescaling of income — a percentile in a
costume. **But percentile alone is also wrong for progression**, because it saturates at the
top (₹30L and ₹3Cr are a couple of percentile points apart) and it moves when the population
moves. Adopt both:

- **Percentile for placement** — where do I sit, stated as a dated stamp.
- **Log-ratio-to-median for progression** — how many doublings from the middle, which is
  drift-robust and keeps resolving at the top.

### The hardest constraint: India's top-end income data is thin

PLFS publishes no percentile cutoffs above roughly the 90th and under-reports top incomes like
every household survey. CBDT slab data covers **filers**, not the population, so slab shares are
not percentiles. WID's India top series is a reconstruction under DINA guidelines — the best
estimate available, not a measurement.

**Above roughly the 90th percentile of Indian income the product is quoting a model, not an
observation — and that is precisely the band this user occupies.** Consequence: render a single
"top 10%" band with a stated uncertainty range and refuse to resolve further. Every placement is
a band, not a point, widening above the 90th.

### Three ladders, never summed

1. **Financial security (default).** Months of runway = liquid assets / trailing-12-month
   expenditure. First-party, measured, current to this month, no licence and no lag. It is the
   only ladder the product can stand behind unconditionally, and the only defensible candidate
   for a single headline number or a score meter. The *bands* on it (3 months = adequate) are
   convention and must be visually distinct from the measured number.
2. **Income percentile.** PLFS for the body, WID above the 90th flagged as modelled, CBDT as a
   cross-check only. US: Census Table H-1, which **resolves only to the top 5%** — no official US
   top-1% income cutoff exists. Global: World Inequality Report 2026.
3. **Wealth percentile.** WID India wealth series, labelled modelled. US: Fed SCF 2025, which
   carries **five imputed records per family** and a complex sample design — ingesting it naively
   produces wrong percentiles and wrong standard errors. RBI Flow of Funds is a macro aggregate
   and **cannot place an individual**. UBS Global Wealth Report is a commercial estimate, context
   only, never a boundary.

A fused income+wealth score inverts for the two commonest real cases (high earner with no assets;
asset-holder with no income) and mixes a stock with a flow. No credible institution publishes one.
If the interaction must be expressed, use a 2-D cell — "income decile 9, wealth decile 4".

### PPP is a correctness requirement, not a refinement

Cross-country comparison must use the World Bank private-consumption PPP factor
`PA.NUS.PRVT.PP` (CC BY-4.0, CSV/XML/Excel). Nominal exchange-rate conversion places an Indian
salary several deciles too low against a US distribution — a false statement about the user's
material standard of living. PPP factors are themselves extrapolated between ICP rounds, so
cross-country placement is shown at **decile** resolution only.

### Progression without a drifting goalpost

No statistical agency plots rank as a time series, because the denominator moves under it. The
copyable pattern: real (CPI-deflated) levels as the trend line, percentile as a dated stamp.
**Every percentile move must be decomposed** — "your percentile fell 2 points: your real income
rose 3%, the distribution rose 6%" — which converts a demoralising artefact into information.

Inflation: MoSPI CPI changed base from 2012=100 to **2024=100 with new-series data from
January 2026**; MoSPI states direct comparison across the break is not feasible. A naive deflator
chain across Dec 2025 → Jan 2026 is wrong — splice explicitly or mark the break. Use the Urban
series for this user, state which was used, and show real by default with nominal as a toggle.

### Example rungs — recommend dropping

Billionaire figures are not measurements: public stakes at close, private holdings by
comparables, **peer-estimated debt**, a conventional 5% liquidity discount, and unverifiable
assets silently set to zero — biased downward by an unknown amount. Neither Bloomberg nor Forbes
publishes an error margin, and Bloomberg's per-person assumptions are paywalled. Worse, it is a
**unit error**: net worth is a stock, salary is a flow, and they cannot share an axis.

"Senior developer in India" is not sourceable. Aggregator figures disagree by ~2x, are
self-reported with no sampling frame, and Glassdoor describes its numbers as ML predictions.
PLFS carries NCO occupation codes in microdata, but published reports do not tabulate at that
granularity and recent microdata requires a login.

Replace celebrity rungs with **sourced anonymous archetypes** — "median Indian urban household:
₹6,996 MPCE (HCES 2023-24)". If illustrative rungs are kept at all, they must be off-axis
annotations in a different typographic register with no numeric value, distinguishable in a
screenshot with no caption.

### Two framings to adopt

- **Guess-first (OECD "Compare your income").** Ask the user where they think they sit, then
  reveal. This reframes the number from a score awarded to a belief corrected.
- **"How many people" rather than a bare percentile (IFS "Where do you fit in?").** Also: adopt an
  existing official income definition rather than inventing one, and expose the household-size and
  sharing assumptions as user-set inputs so the assumption is theirs, not hidden.

Evidence note: people are systematically wrong about their rank, and the error direction is
predicted by their reference group (Cruces et al. 2013). A software professional's peers are other
software professionals, so the likely prior is **underestimating national rank and overestimating
global rank**. Lead with the comparison most likely to be accurate, not the most dramatic.

### The global-1% premise was false

World Inequality Report 2026: global **top 10% threshold ≈ $65,500/yr** — genuinely surprising, and
a mid-career Indian professional can clear it. Global **top 1% ≈ $250,300/yr**, which is *higher*
than most people guess. Copy built around "you're already in the global 1%" would usually be false.
Open item: the PPP basis of those two thresholds is not stated on the web page, and that page
carries visible typos — confirm in the PDF before showing either.

### Saving mechanics with evidence behind them

- **Goal labelling is the best-evidenced and cheapest mechanic** — Malawi labelled savings boxes
  +~30%; Uganda 93% opt-in with 37% still using a year after the programme ended. Notably, multiple
  accounts did **not** beat a single account, so resist an elaborate multi-goal system.
- **Commitment devices work and then fade** — Ashraf/Karlan/Yin: +81pp at 12 months, decayed to
  ~33% and not significant at ~2.5 years. Commitment must be periodically re-offered, not set once.
- **Save More Tomorrow's famous 3.5%→11.6% is a selected-sample figure**, not a treatment effect;
  the US Department of Labor's CLEAR review rates the causal evidence "low quality", and at one site
  the all-employee average moved only 5.5%→5.8%. Usable as a design pattern, not as settled evidence.

### Harm evidence, now India-specific

SEBI's FY22–FY24 study: **93% of over 10 million individual F&O traders lost money, averaging
~₹2,00,000 each**, ~₹1.81 trillion in aggregate, with 43% of FY24 participants under 30 and most
earning below ₹5,00,000/year. Barber et al. on Robinhood: **−4.7% average 20-day abnormal returns**
on the top stocks bought each day, with outages disproportionately reducing high-attention trading.
IOSCO published final reports on digital engagement practices on 19 May 2025; ESMA has a discussion
paper on nudging and gamification; Massachusetts cited gamification against Robinhood in Dec 2020.

None of this binds a personal-finance measurement feature directly — but the mechanics regulators
object to are exactly the ones requested, and the direction of travel is unambiguous.

### Additional refusals (beyond those already listed above)

- Anything called ELO, or a rating derived from simulated matchups.
- A stated US or Indian top-1% **income** cutoff presented as official — neither exists.
- A percentile-over-time progress line.
- Nominal-by-default trajectories, or a deflator chain across the CPI base break.
- A point estimate with no uncertainty band.

### Open items requiring a primary source before implementation

- **WID.world data licence** — the terms-of-use URL 404s and the data page states no licence. Must
  be resolved before shipping any WID-derived number.
- PPP basis of the WIR 2026 thresholds; Forbes methodology (403); CBDT latest AY (403);
  CPI 2024=100 official splice guidance; PLFS CY2025 wage tables; World Bank PPP latest India value.
- Yamamura (2021) full PDF — the richer-than-assumed vs poorer-than-assumed breakdown is the crux of
  the demoralisation question and is not in the abstract.

## Retirement projection — research findings 2026-10-21

**Verdict: honest as a scenario comparator, not as a prediction engine.** The defensible product
says "under assumption set A you reach X in today's money; suspending the SIP in year 10 moves it
to Y; here is the spread and here is what changes the answer most." The indefensible product —
the one every Indian SIP calculator ships — is a single rupee figure at age 60.

### The binding Indian constraint, and it is specific

**AMFI Best Practices Circular 109/2023-24, 1 November 2023**, issued at SEBI's direction
(SEBI letter IMD/SEC4/OW/P/2023/9448/1, 3 March 2023) under the Sixth Schedule Advertisement Code.
Primary text read directly. Clause 8: *"For avoidance of doubt, it is clarified that no future
returns can be shown even on illustration basis."* Clause 9 is the carve-out we live in: AMCs may
use goal-planning and SIP/STP/SWP calculators *"which permit investors to select the return from a
range of returns starting from 2% to 13%"*, so long as they do not depict any particular scheme.

So the circular is simultaneously the prohibition and the permitted template, and **an
editable-assumptions design is the compliant design**. Other operative clauses: Cl. 5 requires the
CAGR used **and its basis** to be disclosed; Cl. 6 caps illustrations at the prescribed rates;
Cl. 10 requires **disclaimer font parity — not fine print**. Prescribed CAGRs are the *mean of
10-year rolling returns 01/06/2013–30/05/2023*: Nifty 12.93%, Sensex 12.64%, 10-year G-Sec 7.20%,
INR gold 9.34%. The 13% ceiling exists because 12.93% is the highest of them.

**Scope is unresolved:** these bind AMCs, their distributors and their advertising. Whether they
bind a non-distributing personal tool holding the user's own transactions is a legal question that
was not settled and must not be assumed either way. Recommended posture is **voluntary
compliance** — it costs little and answers the question if ever asked.

**Two regulators have already run this experiment and lost.** The EU's PRIIPs performance
scenarios derived forward outcomes from trailing performance; the FCA stated on 24 January 2018
that they *"may appear too optimistic and so have the potential to mislead consumers"* and granted
forbearance for firms to contradict the regulator's own mandated figure. The EU's remedy —
Delegated Regulation (EU) 2021/2268 — replaced the method with **bootstrapped historical
simulation**. The UK went further and deleted prescribed performance scenarios entirely (PS25/20,
8 December 2025). AMFI's prescribed rates carry **the same procyclicality flaw**: they are means
measured over a bull window. Use them for compliance cover; never present them as a forecast.

### The number that should open the feature

Shifting the measurement start by one year changes the measured NIFTY 50 price CAGR to Sep-2026
from **7.21%** (start 31-Dec-2007) to **12.14%** (start 31-Dec-2008) — a 4.9 percentage-point swing
over an 18-year window, roughly a 3x difference in terminal corpus on a 30-year SIP. Any single
default return constant is an artefact of the window chosen, and this demonstration belongs on an
onboarding screen rather than in a footnote.

Context: NIFTY 50 as of 30-Sep-2026 closed 22,620.45, **1-year price return −8.09%, YTD −13.43%**.
Since-inception TRI (Nov-1995) is **12.12%**. Debt is also in drawdown: NIFTY All Duration G-Sec
1-year **+2.10%**, since-inception (Sep-2001) **7.03%**.

### Method

**Stationary block bootstrap as the primary engine** (block length 3–5 years, equity and debt
**jointly resampled by year** so empirical correlation is preserved without inventing a correlation
matrix). Deterministic AMFI illustration as a labelled secondary view. **Monte Carlo not as the
headline** — the decisive criticism is not fat tails but that the success figure is an artefact of
the assumption set: Finke, Pfau & Blanchett (JFP, June 2013) moved the 4% rule from ~94% success to
**43%** by recalibrating the bond yield alone.

Non-stationarity is the unfixable one — India's 1995–2026 window spans liberalisation, a
demographic dividend and a structural fall in inflation. No method repairs that, and the product
should say so rather than bury it.

### The SIP-suspension lever is a sequence-of-returns question

It must **not** be implemented as recomputing a closed-form future value with contributions
truncated — averaging is precisely the operation that deletes the answer. Re-run the full path set
with the suspension applied so each path experiences it at its own return sequence, overlay the two
fans, and highlight **the gap between the lower bands**, not just the medians: suspension hurts bad
paths far more than the median, and that asymmetry is the finding. Offer "suspend N years then
resume" as well as permanent stop. Report the cost **in years**, not only rupees.

### Real, not nominal — firm

FCA COBS 13 Annex 2 requires pension projections **in real terms** *and* an explanation of **why**
inflation was taken into account. ASIC amended its calculator relief in 2019 to require inflation
adjustment. At 6% over 30 years purchasing power divides by ~5.7 — a nominal "₹5 crore at 60" is
about ₹88 lakh today. The UK wrote its rule at ~2% inflation; at Indian rates a nominal headline is
misleading within the plain meaning of "fair, clear and not misleading". Medical inflation must be
modelled as a **separate, faster-inflating expense stream**, because one CPI deflator understates a
retiree's personal inflation.

### Display

Fan chart of real-terms corpus against age, **outer band faded and explicitly open-ended** — the
Bank of England's own 1998 finding was that readers treat a crisp edge as a hard bound. BoE Staff
Working Paper 1196 (17 July 2026) found fan charts outperformed dot plots, box plots, speedometers
and ranges, and that the public systematically underestimates uncertainty until shown one.

**No numeric probability of success.** Budescu et al. (Psychological Science 2009; Nature Climate
Change 2014, 25 samples / 24 countries / 17 languages) show stated probabilities are read
**regressively, pulled toward 50%** — "very likely" (>90%) is typically read as ~70% — with errors
worst at the extremes, and negatively-worded phrasing worse still. Show a **count of historical
scenarios** instead: "in N of 100 historical Indian market stretches the corpus reached your
target." That is a historical frequency, which we can stand behind, not a forward probability,
which we cannot. This is exactly the Bengen SAFEMAX vs Trinity Study distinction — the Trinity
framing is where "probability of success" entered planning, and it was always a frequency misread
as a probability.

### Indian inputs and defaults

| Input | Default | Range | Basis |
|---|---|---|---|
| Equity nominal | 12.0% | 8–12.93% | NIFTY TRI since inception 12.12% [OFF]; AMFI 12.93% [REG] |
| Debt nominal | 7.0% | 6–7.8% | NIFTY All Duration G-Sec since 2001 [OFF]; AMFI 7.20% [REG] |
| General inflation | 6.0% | 4–7% | RBI target 4% ±2% [REG]; default at the top of the band because understating inflation is the asymmetric error |
| Medical inflation | 11.5% | 9.9–12.9% | WTW 12.9% / Aon 11.5% — **vendor surveys**, labelled as such |
| EPF | 8.25% | — | EPFO CBT 239th meeting, 2 Mar 2026; *recommended*, requires MoF notification, revisable |
| PPF | 7.1% | — | DEA quarterly review, 30 Sep 2026; **resets quarterly** |
| NPS annuitisation at 60 | 20% non-govt / 40% govt | — | PFRDA Exits Regulations, amended **16 Dec 2025** |
| Plan-to age | 92 | 85–100 | SRS 2020-24 |
| SWR | 3.0% | 2.6–3.5% | Saraogi 2022; Raju & Saraogi 2024 |

**Inflation anchor [REG]:** under s.45ZA of the RBI Act 1934, the Central Government notified on
**25 March 2026** that the CPI-Combined target remains **4% ± 2pp for 1 Apr 2026 – 31 Mar 2031**.
Note MOSPI rebased CPI from 2012=100 to **2024=100** (Jan-2026 reading 2.75% provisional), so any
long-run CPI average is a spliced series and must be labelled one.

**India-specific SWR research does exist** — the honest answer is not "no study". Saraogi (2022,
SSRN 4216077) concludes ~3.0%, ≤2.6% risk-conservative; Raju & Saraogi (2024, SSRN 4697720), using
Monte Carlo plus bootstrapping, conclude 3.0–3.5% with failure risk rising sharply above 3.75%.
Both SSRN pages returned 403, so the PDFs must be pulled before a 3% default ships. International
context: Pfau (2010) found 4% safe in only **4 of 17** developed markets, and a fixed 50/50
allocation failed at some point in **all 17**.

**Life expectancy [OFF]:** SRS Abridged Life Tables 2020-24 (ORGI, published May 2026) — life
expectancy at birth 70.6; **remaining life at 60 is 18.6 years**. Three cautions that belong in the
product: that is a **mean**, so planning to it is a ~50% chance of outliving the plan; these are
period not cohort tables, so they understate the longevity of someone retiring today; and the
window contains COVID-era mortality.

**NPS changed materially on 16 Dec 2025** and this is the most important single input finding:
non-government subscribers now need **only 20% annuitised** (was 40%), may stay in the system to
**age 85** (was 75), and a corpus ≤ ₹8 lakh is 100% withdrawable with no annuity. A projection that
treats an NPS corpus as fully spendable overstates retirement income by up to 20% (non-govt) or 40%
(govt).

### Milestones — expense multiples, never income multiples

The "1x salary by 30 … 10x by 67" rule is a **Fidelity marketing convention** with no research or
regulatory basis, no named author and no primary white paper. It assumes US Social Security covers
the rest, 1.5% real wage growth, and US data from 1926 — the most favourable equity series in the
world, which is Pfau's survivorship point. Fidelity's own sensitivities span 8x–12x on retirement
age alone, and Vanguard declines to give multiples at all.

Use instead: corpus ÷ **the user's own** annual expenses; **33x** as the India-calibrated
independence marker (the reciprocal of 3.0%, cited on screen — never 25x, which is the reciprocal
of the US 4% rule); corpus against a real **essential**-expense floor; the age at which the corpus
crosses 33x; and plan-to age 92 marked on the axis with its citation.

### Refusal gate

Refuse to project, naming the cause, when: transaction history is under 12 months; expense
categorisation coverage is below threshold; asset mix is unresolved for a material share of
holdings; the horizon exceeds the usable Indian return history by a wide margin; or a required
assumption is vendor-sourced or unverified and unacknowledged. **Never silently substitute a
default for missing user data** — missing data produces a refusal with a named cause, not a
quietly smaller number.

### Must not show

A single rupee corpus figure in any prominence; a numeric probability of success; nominal rupees as
the headline; any return assumption above 13%; the US 4% rule or a 25x milestone; income-multiple
milestones; a suspension result computed on an averaged curve; percentile bands quoted beyond three
significant figures; a fan chart with a crisp outer edge; medical inflation presented as an official
statistic (and not the "14%" figure, which is WTW's Asia-Pacific number, not India's 12.9%); an NPS
corpus as fully spendable; EPF/PPF rates as guaranteed for the horizon.

### Verification debt

The 3.0% SWR (SSRN 403), the ~7.44% current 10-year G-Sec yield (RBI DBIE fetch failed), NPS scheme
returns (JS-rendered), the 10/15/20-year NIFTY CAGRs (NSE does not publish them; circulating figures
are vendor-computed), any long-run CPI average spanning the 2024 rebasing, the exact AMFI clause-7
disclaimer wording (truncated in extraction), and the live FCA COBS 13 Annex 2 rate table.

## Market signals and alerting — research findings 2026-10-21

The Coordinator's position was put to this research for challenge, not confirmation. The verdict:
**right in substance, wrong at both edges.**

### Right, and more settled than it was argued

Four independent lines, all negative, on the three best-studied transparent rules:

- **Trend-following (Faber 2007).** Faber's own 2018 revisit records the system **underperforming
  stocks in six of the eight years after** its 2008-09 triumph. Zakamulin's critique finds an ~80%
  failure rate out of sample 1930–2012, and across 300 weighting-function shapes finds **no
  statistically significant outperformance in the second half of the sample**. What replicates is
  the volatility reduction, not the return improvement.
- **Volatility targeting (Moreira & Muir 2017).** Cederburg, O'Doherty, Wang & Yan (2020) across
  103 strategies: volatility-managed portfolios "do not systematically outperform" out of sample,
  and the positive alphas come from strategies not implementable in real time. A 2026 replication
  puts the post-2003 SPX Sharpe gain at **0.017** before costs. Dead on arrival.
- **CAPE.** AQR (Asness, Ilmanen, Maloney 2017): CAPE timing was "scarcely better" than
  buy-and-hold over 1900–2015 and **no better at all over 1958–2015**. Asness's own framing —
  valuation is "a disastrous market timing tool" while still being the reason to lower long-run
  expectations — is the whole lesson. CAPE belongs in an expectations panel, never in a trigger.

**The Indian tax arithmetic ends the debate before regulation is reached.** Post-23 July 2024:
STCG on listed equity **20% + 4% cess = 20.8%**; LTCG **12.5%** with a **₹1,25,000 per-FY
exemption**. On a 12% gross return, buy-and-hold nets ~11.0% CAGR; a rule realising gains annually
inside 12 months nets **9.50%**. That is ~1.5pp of pure tax drag, plus ~0.5pp for two round trips
of STT, brokerage and impact. **An Indian tactical rule must generate roughly 2 percentage points
of annual gross outperformance just to draw level with doing nothing** — against a documented edge
that is volatility reduction, not return. (The arithmetic is the researcher's own and should be
re-checked.)

**The behaviour gap.** Morningstar *Mind the Gap 2026* (6 Aug 2026, primary): the average dollar in
US funds earned **8.7%/yr over the decade to 31 Dec 2025 against a 9.9% fund return — a 1.2pp gap,
~12% of the return**, explained by the timing and magnitude of purchases and sales. The gap is
stable across a decade of editions. **Not building the feature is worth about 1.2 percentage
points a year — larger and more reliable than any tactical rule in the literature delivers.**

No India investor-return-gap figure could be found (Morningstar India publishes the methodology but
not a retrievable figure; AMFI publishes none). What India does have is SEBI PR 37/2024
(23 Sep 2024): **93% of individual F&O traders lost money FY22–FY24**, aggregate losses over
₹1.8 lakh crore, and **more than 75% of loss-makers kept trading anyway**.

### Correction: SEBI does not constrain a single-user tool

The Coordinator flagged SEBI registration as a possible constraint. On the consolidated SEBI
(Investment Advisers) Regulations 2013 as amended to 25 November 2025, that is **wrong, and should
not be repeated to the user**. Registration under Reg 3(1) triggers on *acting as* or *holding out
as* an investment adviser, and Reg 2(1)(m) requires **consideration, business and clients**. A
single-owner tracker has none, and does no holding out — it is outside the regulations entirely,
**regardless of how prescriptive its output is**.

The line is crossed the moment any one of these happens: a second user is onboarded (free or paid —
commentary reads "for consideration" loosely); the app is published or marketed as advising; or the
owner describes it publicly as giving recommendations. Note Reg 4(a) shelters general market
commentary **naming no specific security** — it would cover a macro panel but **not** holdings-level
output. SEBI's 29 Aug 2024 finfluencer amendments additionally bar express or implied claims of
returns or performance; enforcement is live. Practical rule for any multi-user version: **never
state or imply an expected return.** Cheap to avoid now, expensive to retrofit.

**The restraint is justified by the evidence above, not by regulation.** Presenting it as a legal
constraint would be false and would let the user discount the real argument along with it.

### Too conservative: band rebalancing and tax-lot alerts are prescriptive, and should be

Framing the honest feature as "observable state" undersells it.

**Threshold-band rebalancing (the 5/25 rule — rebalance at 5pp absolute drift or 25% of target
weight relative, whichever binds first).** Vanguard's *Rational Rebalancing* finds smaller
thresholds mean lower tracking error and higher cost, and states the practical objection plainly:
pure threshold rules require **daily monitoring and are "not practical for investors who manage
their own portfolios"**. Their answer is a hybrid — check on a calendar, trade only past a
threshold. **That objection is precisely what this app dissolves**, since it already ingests daily
NAVs. This is the one place the app supplies something the literature says retail investors cannot
do for themselves, resting on published research rather than a forecast. Let it be prescriptive:
the rule is the user's own, applied to facts.

Two India-specific modifications the US research does not cover:
1. **Bands must be wider than 5/25**, which is calibrated to US transaction costs. In India **tax
   is the dominant transaction cost**.
2. **Prefer cash-flow rebalancing** — direct the next SIP to the underweight sleeve, and alert for a
   sell-side rebalance only when the band is breached *and* contributions cannot close it within N
   months. A contribution rebalance realises no gain and is strictly better in India.

**The STCG-to-LTCG boundary alert is the highest-value item in the whole report.** Holding past
12 months is worth **8.3 percentage points of tax rate** (20.8% → 12.5%) on the realised gain —
larger and far more certain than any tactical rule claims, and it requires no view about the future.
The ₹1,25,000 LTCG exemption is use-it-or-lose-it per FY; not using it is a quantifiable loss.

### Not conservative enough: the channel is itself the harm

"User-authored firing rules" is a loophole in the Coordinator's own argument. A rule written in
advance — "if the S&P drops 10%, move to debt" — is market timing with the user's name on it.
Pre-commitment genuinely beats panicking in the moment, but it does not make the rule profitable and
it does not escape 20.8% STCG.

More importantly, **the delivery mechanism is a treatment, not a neutral pipe.** FCA,
*Digital engagement practices: a trading apps experiment* (Research Note, June 2024), a randomised
experiment with **over 9,000 consumers**: **push notifications increased trade count by 11%**
(prize draws 12%), with larger effects on those with lower financial literacy, women, and
18–34-year-olds. Barber, Huang, Odean & Schwarz (*Journal of Finance* 2022): intense Robinhood
buying forecast **−4.7% average 20-day abnormal returns**, identified off Robinhood outages
disproportionately reducing high-attention trading. Arnold, Pelster & Subrahmanyam (2020): push
messages increase risk-taking.

So the missing constraint was never about content — it is about **channel and frequency**. Push is
reserved for a handful of factual, non-market actions a year. Everything market-coupled lives
behind a tap.

**No SEBI statement on gamification or notification-driven trading could be found** — do not
represent SEBI as having a position. FCA (2022), ASIC and SEC (Gensler 2021) have all commented.

### Political events — confirmed, drop it

"Government falls" has **no machine-detectable primitive**. There is no feed field; it would be
regex-matching prose, firing on debates, opposition demands, state governments, anniversaries and
unrelated resignations. The real event's base rate is roughly once a decade; the keyword's is
weekly. And by the time an official source publishes, the market has repriced.

The effect may not exist to catch: Balaji, Kusuma & Kumar (2018) find elections "do not have a
significant impact on the CNX NIFTY" in any period; an SDM IFC 2024 paper across five general
elections finds short-term volatility but a long-term trajectory set by broader economic conditions.
Broker blogs claiming durable effects contradict each other on the same years.

Building it would generate frequent wrong alerts on the one topic where the user is most likely to
act emotionally.

### Data sources — verified live 2026-10-21

Working keylessly: **AMFI `NAVAll.txt`** (1.5MB, no headers — the most robust Indian source in the
list, but now **8 columns**, so old 6-column parsers break); **Frankfurter**
`api.frankfurter.dev/v2/rates?providers=fbil` for USD/INR, which serves the actual FBIL reference
rate with history to 2018 and **beats going to RBI directly**; Yahoo chart for US indices, VIX,
Brent/WTI, India VIX (history to 2008); **EIA .xls** for Brent; FRED CSV (keyless — only
`api.stlouisfed.org` needs a key) as the robust backstop; NSE `fiidiiTradeReact` for FII/DII
(**current trading day only — must be snapshotted daily into our own series**); NSE `allIndices`
for India VIX levels.

**No keyless source exists for the India 10-year G-Sec yield** — CCIL, DBIE and FBIL are all SPAs or
postback HTML, NSE's debt block returns empty fields, and Yahoo has no symbol. **Recommend dropping
that signal.** India CPI likewise has no keyless source and is monthly regardless. `exchangerate.host`
is now keyed. RBI and FBIL publish **no documented keyless machine-readable feed** — the assumption
that RBI would be the clean authoritative source does not hold.

**Terms of use, and this is a standing fragility.** NSE's terms state verbatim that users are
"prohibited to conduct any systematic or automated data collection activities (including scraping,
data mining, data extraction and data harvesting)". Yahoo's `robots.txt` on the chart host is
`Disallow: /`, and the endpoint is undocumented and unsupported. The repo's existing NSE and Yahoo
adapters are **tolerated, not permitted**. For one user polling daily the realistic risk is
throttling, not enforcement — but every signal must degrade gracefully when a source dies, and none
may be load-bearing. The genuinely clean sources are **AMFI, FRED, EIA and Frankfurter**.

### Alert catalogue

**Tier 1 — push-worthy, factual, rare.** STCG-to-LTCG boundary approaching (state both tax rates,
suggest nothing); LTCG exemption unused late in the FY; allocation band breach, offering the
cash-flow route first; concentration past a user-set threshold; emergency fund below target;
**data-source failure**, since silent staleness is the app's biggest correctness risk given the
fragility above.

**Tier 2 — in-app only, never pushed.** Drawdown from peak with its historical percentile **and the
dispersion of what followed**; a macro board of levels and percentiles with **no interpretation
text**; FII/DII flows; the tax-lot ledger; realised gains against the ₹1.25L exemption.

A percentile shown next to an action, or without dispersion, reads as "rare, therefore a buying
opportunity" — the same error as a single average forward return. Context belongs on a page the
user navigates to; a notification is for when they are not already thinking. (No empirical study of
this specific presentation was found — that reasoning is not evidence.)

**Tier 3 — only if insisted on.** A user-authored macro rule, in-app only, no suggested action,
with a mandatory 48-hour cooling-off and **a logged outcome** — record what the user did and what
happened over the following 12 months, and show them their own hit rate after two years. If this
gets built, the app should at least measure whether it works for this user.

### Must not build

Any forecast of which asset will grow; any automated allocation recommendation including "trim
equity, add debt"; a political-event detector; **price-movement push notifications of any kind**;
volatility targeting or any continuously-rebalancing rule; streaks, scores, leaderboards, badges or
"you beat the Nifty" celebrations; any expected-return or performance claim, express or implied;
and signals built on the India 10-year G-Sec or timely CPI, for which no keyless source exists.

### Confidence

High: the SEBI IA Regulations text, Mind the Gap 2026, the SEBI F&O release, the FCA DEP
experiment, and the endpoint verification (all live-fetched or extracted from primary PDFs).
Medium: Zakamulin, Cederburg, Moreira-Muir, AQR and Faber 2018 — read through abstracts and
reputable secondary summaries, not in full; Indian tax rates consistent across many sources but
**not checked against the bare Finance Act**, which must happen before any tax computation ships.
Low: the 5/25 rule's attribution to Swedroe's original wording; the ASIC report's title and date.

## Deliverable: the six-document set (owner request, 2026-10-21)

The plan lane does not end with a plan. It ends with six documents that let a
second agent — Codex — work on this repository without reading chat history and
without colliding with Claude's work. Written only after the implementation plan
is accepted, and written as one set in one pass so they cannot drift.

| Document | Holds | Must never hold |
|---|---|---|
| `PRODUCT-REQUIREMENT.md` | What the user gets and why; the four domains; entry modes; refusals and the reasons behind them | Schemas, components, task lists |
| `ARCHITECTURE.md` (update in place) | Layer boundaries, the ledger model, the A/B/C data classes, contracts between modules | Product rationale, UI decisions |
| `RULES.md` | The invariants both agents are bound by: money precision, no floats, append-only, no AI categorisation, no expected-return claims, git discipline, who owns which files | Anything debatable — a rule in here is not up for interpretation |
| `DESIGN.md` | Token set, component contracts, state coverage, accessibility floors, the artifact links in `artifacts.md` as the visual source of truth | Implementation detail, business logic |
| `TASKS.md` | Numbered tasks, each with owner, file scope, inputs, acceptance check, and dependency | Prose discussion; a task with no acceptance check is not a task |
| `MEMORY.md` | Decisions already settled and their reasons, so neither agent reopens them | Anything still open — open items live in the plan doc |

### Agent routing

Owner's split, taken as given: **Claude on UI and logic; Codex on wiring and
mechanical breadth.** Concretely:

- **Claude** — domain logic in `src/domain/`, financial calculations, tax rules,
  the scoring composite, the projection engine, React components and App Router
  UI, accessibility, state coverage, and anything where a wrong answer is a
  wrong number rather than a crash.
- **Codex** — schema and migrations, repository and adapter plumbing, server
  actions and route handlers that only marshal, import/export glue, test
  scaffolding, mechanical refactors across many files, and build/CI.
- **Either, never both at once** — a file has exactly one owner per task.

### Anti-collision rules (go into `RULES.md` verbatim)

1. **File ownership is exclusive per task.** If two tasks need the same file,
   they run sequentially, never in parallel. `TASKS.md` records the dependency.
2. **Contracts are written before either side builds.** Types, schemas and
   function signatures land first, in a task of their own, owned by one agent.
   The other agent codes against them and does not change them — a needed change
   is a new task, not an edit.
3. **Neither agent edits the other's completed work** without a task that names
   the file and says why.
4. **Decisions go to `MEMORY.md`, not chat.** An agent that settles something
   records it there in the same change.
5. **Never stage or commit.** Standing rule; applies to both agents equally.
6. **No document is rewritten to suit one agent's style.** Update in place,
   amend with dated corrections.

---

# Implementation plan (written 2026-10-21, after research and mockups)

**Authority correction (2026-10-24):** the phase tables below preserve the original
planning rationale, not a second live board. TASKS.md owns current task IDs, owners,
dependencies and acceptance checks for F/P0–P6. Its D1–D7 remain pending owner decisions;
recommendations here (including redo and filtered removal) are conditional on them.
DOC-R1 is documentation-only authorisation and does not start these phases.

Status of this section: READY. Production code still requires the owner's go-ahead
per the chosen lane; this section is what that go-ahead would release.

## Sequencing, and the one constraint that fixes it

The Protect pillar needs an insurance entity, which does not exist. Under the
all-or-nothing completeness rule the composite score cannot ship before the
insurance model does. That single fact orders the whole build:

```
P0  Correctness debt        (defects that are wrong today, independent of all this)
P1  The four new domains    (insurance, commitments, major spends, income streams)
P2  The mutation model      (edit / undo / redo / remove, across everything)
P3  Scoring and tiers       (needs P1 complete; refuses to compute until it is)
P4  Lifetime chart          (needs DOB; snapshots already exist)
P5  Projection              (needs P1 income + P3 expense baseline)
P6  Alerts                  (needs P3 targets; smallest surface of the lot)
```

P0 ships alone and first. P1 and P2 may run in parallel — different tables, different
screens — provided the contract task (Task 2.0) lands before either starts.

## Phase P0 — correctness debt

| # | Task | Owner | Files | Acceptance |
|---|---|---|---|---|
| 0.1 | `monthlyDebtPayments` becomes nullable; `debtToIncome` returns null when payments are unmeasured, not when income is zero | **Claude** | `src/domain/reports.ts`, `src/app/reports.usecases.ts` | A user with income and loans sees an em-dash, never 0%. Test asserts null for unmeasured and a real ratio when fed from `equatedInstalment()` |
| 0.2 | Feed real debt payments from `equatedInstalment()` so the metric computes | **Claude** | `src/app/reports.usecases.ts` | Ratio matches a hand-computed EMI sum in a fixture |
| 0.3 | SBI geometry column mapping repaired (it is still wrong; the earlier fix only stopped it *winning*) | **Codex** | `src/infra/pdf-statements.ts` | `npm run check:statement` exits 0 on the two SBI files |
| 0.4 | Opening-balance gap surfaced on the account page, not only at import | **Claude** | `app/(root)/accounts/[accountId]/`, `src/domain/banking.ts` | An account whose first imported statement starts mid-life shows the named gap and the rupee difference |

**0.4 is the owner's reported balance bug.** The balance is not wrong because parsing is
wrong; it is wrong because Nov 2023 to Dec 2025 was never imported, and nothing posts an
opening balance for a period that does not start at the account's own beginning. Already
analysed in `pdf-geometry-reader-drops-rows.md`; the arithmetic there is exact
(Rs 90,488.03 minus Rs 178.72 = Rs 90,309.31, the whole shortfall).

## Phase P1 — the four new domains

All manually entered. Statement parsing stays bank-account only.

| # | Task | Owner | Files | Acceptance |
|---|---|---|---|---|
| 1.0 | **Contract task.** Schema and types for `insurance_policies`, `recurring_commitments`, `physical_assets`, `income_streams`, plus a shared `recurrence` value type | **Codex** | `src/infra/db/schema.ts`, `src/core/recurrence.ts`, migration | Types compile; migration up and down both run; no other P1 task starts before this merges |
| 1.1 | Recurrence engine: cadence, next-due, cancel-by, price-change-at-renewal | **Claude** | `src/domain/recurrence.ts` | Unit tests cover monthly/quarterly/annual, leap years, month-end rollover, and a mid-term price change |
| 1.2 | Insurance domain: policy, premium schedule, cover adequacy as *presence only* | **Claude** | `src/domain/insurance.ts` | No rupee sum-insured threshold anywhere; erosion against medical inflation shown as information, cited as a consultancy survey |
| 1.3 | Recurring commitments: committed outgo per month and per year, auto-renew flag | **Claude** | `src/domain/commitments.ts` | Totals reconcile to the sum of active commitments; a cancelled commitment leaves the total on its end date, not immediately |
| 1.4 | Physical assets: persist `Vehicle.purchase` / `depreciatedValueOn`, generalise beyond vehicles | **Claude** | `src/domain/assets.ts`, repository | Depreciation labelled a model, not an observation, with its rate shown |
| 1.5 | Income streams: employer, expected vs actual, variable components | **Claude** | `src/domain/income.ts` | A missed expected inflow is visible as missing, not as zero income |
| 1.6 | Repositories and server actions for all four | **Codex** | `src/infra/db/repositories/`, `app/(root)/*/actions.ts` | Each round-trips; authorization scoped to the owning user; no business logic in the action |
| 1.7 | Four entry surfaces and list views | **Claude** | `app/(root)/insurance/`, `/commitments/`, `/belongings/`, `/income/` | Matches Control Bench; loading, empty, error and unknown states all present |
| 1.8 | Expense to asset-acquisition link | **Codex** | schema, `src/domain/transactions.ts` | Does **not** violate L12 (no category on a commodity posting) — the link is a side table, not a second column on the posting |

## Phase P2 — the mutation model

Per the Mutation Model artifact and `ui-redesign-v2-research.md`.

| # | Task | Owner | Files | Acceptance |
|---|---|---|---|---|
| 2.0 | **Contract task.** The A/B/C data-class table becomes a typed registry: every table declares its class and its legal verbs | **Codex** | `src/domain/mutation-classes.ts` | Exhaustive over all 47 tables; a new table without a class fails to compile |
| 2.1 | `restore()` — the inverse of `softDelete`, the one new repository primitive | **Codex** | `src/domain/transactions.ts`, repositories | Round-trips a tombstone; a restored row re-enters every balance; reconciled rows refuse (L10) |
| 2.2 | Batch identity on `audit_events.request_id` as the undo unit | **Codex** | `src/app/ledger.usecases.ts` | One edit, fifteen removals and a whole import all undo as one unit |
| 2.3 | Undo tombstones the reversal *and* the replacement | **Claude** | `src/app/ledger.usecases.ts` | Original returns to every balance; evidence stays behind a filter; reverse-a-reversal still blocked |
| 2.4 | Redo as a one-step cursor for class A, bounded stack (20) for class B | **Claude** | `src/app/ledger.usecases.ts` | Invalidated the moment a newer mutation touches an entity in the undone batch; disabled **with a reason**, never hidden |
| 2.5 | Bulk mutation resolved server-side at confirm time | **Codex** | `app/(root)/transactions/actions.ts` | Replaces the comma-joined id string for filter-scoped operations. Atomicity per Decision D1 |
| 2.6 | "Remove all" confirm: filter chips, preview, typed phrase carrying the count | **Claude** | `components/` | Refused outright on an unfiltered table; a memorised phrase cannot be typed blind at a different scope |
| 2.7 | Activity screen — undo history grouped by `request_id` | **Claude** | `app/(root)/activity/` | Every mutation in the retention window is listed, attributable, and undoable where still legal |
| 2.8 | Keyboard model across every table | **Claude** | `components/` | Arrow keys / Space / Ctrl+A / E / Del / Ctrl+Z / Ctrl+Y, with the text-input guard |

**Decision D1 (owner's call, pending):** a filter-scoped bulk mutation is designed
**atomic** — "Nothing was removed", blocking rows named, *Retry without them* as a new
batch. This contradicts today's deliberately non-atomic `bulkDeleteTransactionsAction`.
Highest-stakes open decision in this plan.

**Decision D2 (owner's call, pending):** tombstone retention 30 days. After that, undo of
a removal is impossible.

## Phase P3 — scoring and tiers

| # | Task | Owner | Files | Acceptance |
|---|---|---|---|---|
| 3.0 | **Contract task.** Indicator registry: id, formula, benchmark, source URL, date, pillar | **Codex** | `src/domain/scoring/indicators.ts` | Every indicator carries a primary-source citation; one without a source does not compile |
| 3.1 | Three-state measurement model: measured / declared-absent / unknown | **Claude** | `src/domain/scoring/` | A pillar with any unknown reports an em-dash; the composite refuses entirely and names the missing pillar |
| 3.2 | Normalisation `min(1, actual / benchmark)`; geometric across pillars, arithmetic within | **Claude** | `src/domain/scoring/composite.ts` | Property test: a zero pillar cannot be compensated by a strong one |
| 3.3 | Tier ceilings, non-compensatory: no health cover caps at the middle tier | **Claude** | `src/domain/scoring/tiers.ts` | Ceiling applies before the tier label is derived, not after |
| 3.4 | Hysteresis on demotion | **Claude** | same | A score oscillating across a boundary does not flicker the tier; a drop is never celebrated |
| 3.5 | Coverage percentage and sensitivity range with every score | **Claude** | same | Recomputed under 3-vs-6 months, 10x-vs-15x, 3%-vs-4% SWR; the range is shown, not only the point |
| 3.6 | Missing metrics: CAGR, HHI concentration, emergency fund, stored target allocation | **Claude** | `src/domain/portfolio.ts`, `reports.ts` | Each matches a hand-computed fixture |
| 3.7 | Descriptive per-holding context — position metrics plus equity filings per product §5.3 (corrected 2026-10-24) | **Claude** | `src/domain/scoring/position.ts` | Source URL/date/units; no action ranking or fund-level fundamentals score; B/E research and RULES §4.3/§4.4 gates unresolved; live acceptance is in TASKS.md |
| 3.8 | Percentile placement on two scales, India and World | **Claude** | `src/domain/scoring/percentile.ts` | Every placement is a **band** with stated uncertainty, widening above the 90th; PPP-converted via World Bank `PA.NUS.PRVT.PP`; refuses to resolve past "top 10%" for India |
| 3.9 | Log-ratio-to-median for progression; decomposition on every percentile move | **Claude** | same | "Your percentile fell 2 points: your real income rose 3%, the distribution rose 6%" |
| 3.10 | Scoring dashboard | **Claude** | `app/(root)/standing/` | No score shown that P1 cannot compute; guess-first framing before reveal |
| 3.11 | Badges: emergency fund at 6 months, a loan closed, cover reaching adequacy | **Claude** | `src/domain/scoring/badges.ts` | No badge rewards transaction count or frequency; no leaderboards |

## Phase P4 — lifetime net worth

| # | Task | Owner | Files | Acceptance |
|---|---|---|---|---|
| 4.1 | Capture date of birth (the `user` table has none) | **Codex** | schema, migration, `app/(root)/settings/` | Optional; the chart degrades to a calendar-year axis without it rather than refusing |
| 4.2 | Net-worth-against-age chart from `net_worth_snapshots` | **Claude** | `app/(root)/dashboard/` | Real rupees by default, nominal as a toggle; the CPI base break at Jan-2026 spliced explicitly or marked |
| 4.3 | Milestones as expense multiples, never income multiples | **Claude** | `src/domain/milestones.ts` | 33x (India-calibrated, reciprocal of 3.0% SWR) cited on screen. Never 25x. No income-multiple milestones |

## Phase P5 — projection

| # | Task | Owner | Files | Acceptance |
|---|---|---|---|---|
| 5.0 | **Contract task.** Assumption set as a typed, user-editable object with per-input source and label | **Codex** | `src/domain/projection/assumptions.ts` | Every default carries its basis; vendor-sourced inputs flagged as such |
| 5.1 | Stationary block bootstrap, 3-5 year blocks, equity and debt jointly resampled by year | **Claude** | `src/domain/projection/bootstrap.ts` | Empirical correlation preserved without an invented correlation matrix |
| 5.2 | SIP suspension re-runs the full path set, never a closed-form truncation | **Claude** | same | The gap between **lower bands** is highlighted, not the medians; cost reported in years as well as rupees |
| 5.3 | Fan chart, outer band faded and explicitly open-ended | **Claude** | `app/(root)/projection/` | No crisp outer edge; real terms as the headline |
| 5.4 | Scenario **count**, never a probability | **Claude** | same | "In N of 100 historical Indian market stretches..." — a historical frequency, not a forward probability |
| 5.5 | Refusal gate | **Claude** | `src/domain/projection/` | Refuses, naming the cause, when history is under 12 months, categorisation coverage is low, asset mix is unresolved, or a required assumption is unverified. **Never silently substitutes a default** |
| 5.6 | NPS annuitisation 20% non-govt / 40% govt | **Claude** | same | A full NPS corpus is never treated as spendable |

## Phase P6 — alerts

| # | Task | Owner | Files | Acceptance |
|---|---|---|---|---|
| 6.1 | Tier 1 alerts only: STCG-to-LTCG boundary, unused LTCG exemption late in the FY, allocation band breach, concentration, emergency fund below target, **data-source failure** | **Claude** | `src/domain/alerts.ts` | Each states facts and suggests nothing; the boundary alert states both tax rates |
| 6.2 | Threshold-band rebalancing, bands **wider than 5/25** (calibrated for Indian tax, not US transaction costs) | **Claude** | `src/domain/portfolio.ts` | Offers the cash-flow route first — next SIP to the underweight sleeve, realising no gain |
| 6.3 | Tier 2 in-app board: drawdown percentile **with dispersion**, macro levels with no interpretation text, FII/DII flows | **Claude** | `app/(root)/signals/` | No percentile appears next to an action or without dispersion |
| 6.4 | Source health monitor | **Codex** | `src/infra/market-data/` | Silent staleness is the biggest correctness risk; every source degrades gracefully and none is load-bearing |

**Not built, by decision:** any forecast of which asset will grow; automated allocation
recommendations; a political-event detector; **price-movement push notifications of any
kind**; volatility targeting; leaderboards; any expected-return claim; and signals built on
the India 10-year G-Sec or timely CPI, for which no keyless source exists.

## Verification debt carried into implementation

To be discharged before the dependent code ships, not after: the OECD/JRC Handbook
aggregation chapter, the CFPB user guide copyright statement, and the FinHealth toolkit
(all three refused automated fetch); Greninger et al. 1996, the true provenance of most
"standard" ratio thresholds; the two SSRN papers behind the 3.0% SWR default; Indian tax
rates against the bare Finance Act before **any** tax computation ships; and the WID.world
data licence, whose terms-of-use URL 404s, before any WID-derived number is displayed.

## QA record

Status: NOT_RUN — no production code written under this plan.

## Stock fundamentals — research findings 2026-10-23

Lane: **Research only.** No production code, no mockups, nothing staged. This section
extends the record above; where it contradicts something already written here, it says so.

The owner asked for fundamentals-driven analysis and buy/sell recommendations. The settled
rule above — *"Per-asset scoring is position quality only… The app has transactions and
prices but no fundamentals feed"* — refuses that on a **factual premise about data
availability**. This research tested that premise. **The premise is false.** What follows
separates that finding from the quite different question of what a fundamentals score can
honestly claim, where the existing restraint turns out to be *better* supported than the
reason originally given for it.

### Headline

1. **A keyless, free, primary-source feed of Indian equity fundamentals exists, and the
   repo already touches the host that serves it.** NSE publishes every listed company's
   filed financial results as **structured XBRL**, indexed by a JSON API, with a balance
   sheet and cash-flow statement in the Q4/annual filings, plus promoter holding and
   pledged shares. Verified live 2026-10-23. The "no fundamentals feed" clause is dead and
   must be rewritten.
2. **This does not license buy/sell calls.** The evidence against a transparent
   fundamental screen beating buy-and-hold *after Indian tax* is, if anything, stronger
   than the evidence already recorded against trend-following and CAPE timing. The
   repo's ~2pp hurdle arithmetic survives contact with the fundamental-screen literature,
   and the literature's own net-of-cost numbers fall **below** that hurdle.
3. **The defensible product is description, not prescription** — and it is now a much
   richer description than "position quality", because there is real sourced data to
   describe against. That is the middle the brief suspected exists.

---

### A. Data availability — the decisive question

#### A.1 Correction to recorded fact F8

`market-data-sources-research.md` F8 records: *"`nseindia.com/api/*` is hard-blocked"*
(403 Akamai, cold and primed). **That is no longer true from this egress IP.** Probed
2026-10-23 with a desktop Chrome `User-Agent`, no cookie priming, no browser:

| Endpoint | Result |
|---|---|
| `GET www.nseindia.com/api/corporates-financial-results?index=equities&period=Quarterly` | **200**, 2 910 904 bytes JSON |
| `…&period=Annual` | **200**, 21 534 bytes |
| `…&period=Quarterly&from_date=01-01-2019&to_date=31-03-2019` | **200**, 1 776 007 bytes |
| `…&period=Half-Yearly` | **200**, `[]` (empty — not a supported period) |
| `GET www.nseindia.com/api/corporate-share-holdings-master?index=equities&symbol=RELIANCE` | **200**, 43 007 bytes |
| `GET www.nseindia.com/api/corporate-pledgedata?index=equities&symbol=RELIANCE` | **200**, 659 bytes |
| `GET www.nseindia.com/api/corporate-shareholding?index=equities&symbol=RELIANCE` | 404 (wrong path) |
| `GET api.bseindia.com/BseIndiaAPI/api/StockReachGraph/w?scripcode=500325…` | **403** (BSE's JSON API stays blocked) |

**Verified fact.** **Inference, flagged:** F8's 403 was probably egress-IP- or
header-specific, not a permanent block. Treat `/api/*` availability as **environment-
dependent and unstable** — F8 was true where it was measured. Any adapter must degrade
gracefully, exactly as the standing rule above requires. The archive host
`nsearchives.nseindia.com`, which serves the XBRL payloads, is the one F8 already found
"wide open", so **the bulk data does not depend on the fragile `/api/*` index** — only
discovery does.

#### A.2 What the financial-results feed actually contains

The index JSON (`period=Quarterly`, default window, fetched 2026-10-23) is an array of
**3 816 rows covering 2 111 distinct NSE symbols**, filing dates `01-Feb-2025` →
`31-Oct-2025`. **3 798 of 3 816 rows (99.5%) carry a working XBRL URL**; the remainder
carry the literal string `-`.

Per-row fields of product value:

- `symbol`, `isin`, `companyName` — ISIN is the repo's existing identity key (F9/F10).
- `consolidated`: `"Consolidated"` | `"Non-Consolidated"` — **the consolidated-vs-standalone
  trap is solved at the source**, not guessed. Both variants are filed as separate rows.
- `audited`: `"Audited"` | `"Un-Audited"`.
- `bank`: `"N"` | `"B"` | `"F"` — **the exchange's own bank / NBFC / non-financial
  discriminator.** This matters more than it looks; see A.4.
- `relatingTo`, `fromDate`, `toDate`, `financialYear`, `period`, `cumulative`.
- `filingDate`, `broadCastDate`, `exchdisstime` — **native as-of and vintage stamps**,
  which section E needs.
- `xbrl` — URL on `nsearchives.nseindia.com/corporate/xbrl/`.

**History:** the `from_date`/`to_date` parameters work and returned **1.78 MB for
Q1 2019**, so the series goes back **at least seven years**. I did not binary-search the
true start date — *unverified*.

#### A.3 The XBRL payloads — three taxonomies, and that is the good news

Fetched and tag-inventoried three filings directly:

**(a) Quarterly, non-financial** (`INDAS_121277_1705282_30072026051753.xml`, 19 935 bytes,
VST Tillers Q3 consolidated). P&L only: `RevenueFromOperations`, `OtherIncome`, `Income`,
`Expenses`, `CostOfMaterialsConsumed`, `EmployeeBenefitExpense`, `FinanceCosts`,
`DepreciationDepletionAndAmortisationExpense`, `ProfitBeforeExceptionalItemsAndTax`,
`ExceptionalItemsBeforeTax`, `ProfitBeforeTax`, `TaxExpense`, `CurrentTax`, `DeferredTax`,
`ProfitLossForPeriod`, `ProfitOrLossAttributableToOwnersOfParent`,
`ProfitOrLossAttributableToNonControllingInterests`, basic/diluted EPS split by
continuing vs discontinued operations, `FaceValueOfEquityShareCapital`.
**No balance sheet.** So margins and growth are computable quarterly; ROE and D/E are not.

**(b) Q4 / audited, non-financial** (`INDAS_121019_1393846_07032025060347.xml`, 89 122
bytes, HEXT). **Carries `Assets`, `Equity`, `BorrowingsCurrent`, and
`CashFlowsFromUsedInOperatingActivities`.** In this default window there are **217 audited
rows across 142 symbols**, all `relatingTo` Fourth or Third Quarter.
**This is the annual-fundamentals route, and it has real coverage.**

**(c) Dedicated annual filing** (`INDAS_121084_1400896_25032025122849.xml`, 63 288 bytes,
Schaeffler India). Richest of the three:
- Balance sheet — `Assets`, `Liabilities`, `EquityAndLiabilities`, `Equity`,
  `EquityAttributableToOwnersOfParent`, `EquityShareCapital`,
  `ReserveExcludingRevaluationReserves`, `BorrowingsCurrent`, `BorrowingsNoncurrent`.
- Full cash-flow statement — `CashFlowsFromUsedInOperatingActivities`,
  `…InvestingActivities`, `…FinancingActivities`, `CashAndCashEquivalentsCashFlowStatement`,
  plus `WhetherCashFlowStatementIsApplicableOnCompany`.
- **Ratios the filer computed and certified**: `DebtEquityRatio`,
  `DebtServiceCoverageRatio`, `InterestServiceCoverageRatio`.
- **Units and basis as explicit tags**: `LevelOfRoundingUsedInFinancialStatements`
  (observed value `Millions`) and `NatureOfReportStandaloneConsolidated` (observed
  `Consolidated`). The two classic silent-corruption traps — units and basis — are
  **machine-readable**, not inferred.

**Caveat, important.** The `period=Annual` index is **sparse**: 29 rows in the default
window, and a 01-Apr-2025→31-10-2025 query returned only **11 rows across 4 symbols**.
Annual balance-sheet data therefore comes mainly from route (b), the **Q4 audited
quarterly** filings, not from `period=Annual`. *Inference:* this is consistent with LODR
Reg 33 requiring the balance sheet with annual audited results filed as the Q4
submission — but I did **not** read Reg 33 to confirm, and that should be checked before
an ingester is specified.

#### A.4 Banks and NBFCs are solved structurally, which is unusual

The XBRL **filename prefix encodes the taxonomy**: `INDAS_…`, `BANKING_…`,
`NBFC_INDAS_…`. Combined with the index's `bank` flag (`N`/`B`/`F`), **the app never has
to guess whether D/E or EV/EBITDA applies to a company.** The brief's warning about "a
naive screener that applies them produces confident nonsense" is avoidable here by
construction, not by a maintained sector blocklist.

Tag-diffed a banking filing (`BANKING_120934_1386521_17022025121715.xml`, Utkarsh SFB,
50 366 bytes) against the non-financial one. Bank-only tags include: `InterestEarned`,
`InterestExpended`, `InterestOrDiscountOnAdvancesOrBills`,
`InterestOnBalancesWithReserveBankOfIndiaAndOtherInterBankFunds`, `RevenueOnInvestments`,
`OperatingProfitBeforeProvisionAndContingencies`, `ProvisionsOtherThanTaxAndContingencies`,
`ExpenditureExcludingProvisionsAndContingencies`, **`GrossNonPerformingAssets`,
`NonPerformingAssets`, `PercentageOfGrossNpa`, `PercentageOfNpa`, `ReturnOnAssets`,
`CET`, `AdditionalTier`**, `PercentageOfShareHeldByGovernmentOfIndia`, `SegmentAssets`,
`NetSegmentAssets`, `NetSegmentLiabilities`.

That is **the correct bank metric set — NPAs, capital tiers, RoA, NII components —
supplied by the exchange in the bank's own taxonomy.** A bank page can be a genuinely
different page populated from genuinely different fields.

#### A.5 Promoter holding and pledging — the India-specific signals

`corporate-pledgedata?symbol=RELIANCE` → **200**, one record, `shp: "30-Sep-2026"`,
`broadcastDt: "23-Oct-2026 16:30:23"`:

```
percPromoterHolding: "51.25"   percSharesPledged: "1.41"
numSharesPledged: "190533426"  totPromoterHolding: "6935285964"
totPublicHolding: "6597252758" totIssuedShares: "13532538722"
nbfcPromoShare: "0"            sharesCollateral: "0"
```

Note the **whitespace-padded numeric strings** (`"    51.25"`, `"     0.00"`) — a parser
trap worth recording now.

`corporate-share-holdings-master?symbol=RELIANCE` → **200**, **23 quarterly records,
30-SEP-2021 → 30-SEP-2026**, each with `pr_and_prgrp`, `public_val`, `employeeTrusts`,
`underlyingDrs`, revision-tracking fields (`revisedData`, `revisedDate`, `revisedRemark`,
`revisionDate`) and a **per-quarter `xbrl` URL with `xbrlFileSize`**. So **five years of
quarterly promoter-holding history with explicit revision flags** is available. The
revision fields matter: a restated shareholding pattern is exactly the kind of
silent change a vintage-labelled dashboard must surface.

I did **not** fetch and parse a shareholding XBRL file — *unverified*, and the detailed
promoter-wise breakdown is presumably inside it.

#### A.6 Other sources, briefly

- **Yahoo `quoteSummary` — still closed.**
  `query2.finance.yahoo.com/v10/finance/quoteSummary/RELIANCE.NS?modules=defaultKeyStatistics,financialData`
  → **401**, 89 bytes. **Confirms round-2 B6 unchanged.** No analyst estimates, no target
  prices, no trailing ratios from Yahoo.
- **`screener.in` — reachable, and its robots.txt is permissive for company pages.**
  `/company/RELIANCE/consolidated/` → **200**, 234 500 bytes. `robots.txt` (fetched
  2026-10-23) disallows only `/user/*`, query-parameter variants (`?q=`, `?sort=`,
  `?limit=`, `?page=`, `/screens/*?order=`, `?include_old=`), `/company/source/quarter/*`,
  and the OAuth login paths. **Company pages are not disallowed.** However: **I could not
  locate a terms-of-use page at all** — `/terms/`, `/terms-of-use/`, `/about/terms/` and
  `/legal/` all returned **404**. So robots.txt is the only machine-readable policy I can
  quote, and **the absence of discoverable terms is not permission.** *Recommendation:*
  do not build on screener.in. It is a derived secondary source whose numbers you cannot
  audit, when the **primary filings are available and unambiguous**. Use it at most to
  spot-check an XBRL parser.
- **`stockanalysis.com`** → **200**; `robots.txt` disallows only `/e/`, `/p/` and three
  named SEO bots. **US-centric**; its NSE pages exist but are derived. Same recommendation.
- **AMFI / MFAPI** — unchanged and healthy (`api.mfapi.in/mf/118834` → **200**, 134 014
  bytes). **Note the asymmetry the brief should hear: for mutual funds there is no
  fundamentals feed.** NAV is a price. Portfolio disclosures, expense ratios and
  factsheets are per-AMC PDFs/XLS with no common schema. **Fund-level fundamental scoring
  stays refused, and for the original reason.**
- **NSE `ind_close_all_<DDMMYYYY>.csv`** → **200**, 17 786 bytes — the index-level P/E,
  P/B and dividend-yield series already noted in round-2 B4. This is the **sector/market
  comparison baseline** section E needs.

#### A.7 Terms of use — honestly

- **NSE.** The repo already records the verbatim clause: users are *"prohibited to conduct
  any systematic or automated data collection activities (including scraping, data mining,
  data extraction and data harvesting)"*. **I could not re-verify it this session** —
  `www.nseindia.com/terms-conditions` returned **404** on 2026-10-23. The clause stands as
  previously recorded; the URL has moved. **This is a flagged verification gap.**
- The standing judgement — NSE and Yahoo adapters are **"tolerated, not permitted"** — now
  extends to the fundamentals feed, and **the stake is higher**, because fundamentals
  ingestion is inherently bulk (thousands of XBRL files) in a way daily price polling is
  not. **Recommendation:** ingest **only the instruments the owner actually holds or is
  actively researching**, on filing-event cadence (four times a year per holding), never a
  market-wide sweep. That is both defensible under the clause and sufficient for a
  single-user portfolio tool. A market-wide screener over all 2 111 symbols is the thing
  the clause most clearly prohibits, and it is also the thing section D says has no edge —
  **the ethical and the empirical answer coincide.**
- **Clean sources remain** AMFI, FRED, EIA, Frankfurter (recorded above). **No fundamentals
  source is in that clean tier.**

#### A.8 Verdict on the premise

> *"The app has transactions and prices but no fundamentals feed."*

**False as of 2026-10-23 for Indian listed equities.** Available keyless, from the
exchange's own archive, in machine-readable XBRL, with explicit units, explicit
standalone/consolidated basis, bank/NBFC/non-financial taxonomy separation, filing
timestamps, ~2 111 symbols, five years of promoter and pledge history, and history back to
at least 2019.

**True, and unchanged, for mutual funds.**

**The rule must be rewritten, but not simply reversed.** The data premise is gone; the
*conclusion* needs re-deriving from section C and D evidence instead — and it largely
survives, on better grounds.

---

### D. The honest boundary on "which to buy, which to sell"

Taken before C because it is the decision the owner actually asked for.

#### D.1 The hurdle, tested against the fundamental-screen literature as instructed

The record above establishes: STCG on listed equity **20.8%**, LTCG **12.5%** with a
**₹1,25,000** per-FY exemption, and that **an Indian tactical rule needs roughly
2 percentage points of annual gross outperformance to draw level with doing nothing.**
The brief asked whether that arithmetic holds for fundamental screens, whose turnover
differs sharply from momentum. It does, with one real adjustment and one decisive
counter-finding.

**The adjustment, in the screen's favour.** Novy-Marx & Velikov, *A Taxonomy of Anomalies
and Their Trading Costs* (NBER w20721; *Review of Financial Studies* 2016,
https://www.nber.org/system/files/working_papers/w20721/w20721.pdf) group 23 anomalies by
turnover and find **most strategies with one-sided monthly turnover below 50% retain
significant net spreads, while few above it do**; size, value and profitability have the
greatest capacity. Piotroski-style screens rebalance **annually**, putting them in the
low-turnover tier. So the ~2pp hurdle is **too harsh** for a fundamental screen: annual
rebalancing does not realise gains twice a year. *Inference, not from the source:* a
once-yearly screen held just past the 12-month line pays **12.5% LTCG, not 20.8% STCG**,
so its tax hurdle is roughly **0.8–1.2pp**, not 2pp — and the ₹1.25L exemption absorbs a
meaningful share of a single-user portfolio's annual realised gain. **This arithmetic is
mine and should be re-checked.**

**The counter-finding, and it is decisive.** Lowering the hurdle does not help if the edge
is lower still. Chen & Velikov, extending the same cost framework to 120 anomalies
post-publication, report the average equal-weighted long-short quintile portfolio earns
**−3 basis points per month net of costs**, and **4–13 bps/month even with cost-mitigating
construction** (reported via the search of the Novy-Marx/Velikov literature; **I did not
retrieve the Chen & Velikov paper itself — treat as secondary, medium confidence**).
**13 bps/month ≈ 1.6%/yr gross of tax, at the top of their range, for a long-short
portfolio.** Against a ~1pp tax-and-cost hurdle that is not a margin worth acting on — and
see D.2, because a long-only investor does not get even that.

#### D.2 Sell differs from buy, and the asymmetry runs against the owner

The brief asked specifically whether the evidence treats sell differently. **It does, in
three independent ways, all pointing the same direction.**

**(i) Most of the alpha is on the short leg, which this app cannot use.** Stambaugh, Yu &
Yuan, *The Short of It: Investor Sentiment and Anomalies*, *Journal of Financial
Economics* 104(2), 288–302 (2012) (https://www.nber.org/papers/w16898) examine 11
anomalies and find each is more profitable following high sentiment **and that the short
leg of each strategy is the more profitable leg**, because short-sale impediments let
overpricing persist while underpricing is arbitraged away. *Inference, explicitly mine and
not stated in the source:* a long-only Indian retail portfolio **captures only the weaker
leg**. The headline long-short spreads in every paper below therefore **overstate what
this app's owner could obtain**, before tax. A later paper argues spurious-regression bias
may account for the sentiment result, so the *sentiment* conditioning is contested — the
**leg asymmetry itself is the robust part**.

**(ii) The tax asymmetry is large and certain, unlike the edge.** Already recorded above:
holding past 12 months is worth **8.3 percentage points of tax rate** on the realised
gain. **A sell triggered by a fundamental score is a certain, quantified cost incurred to
chase an uncertain, contested, net-of-cost-near-zero benefit.** The expected value of
acting on a *sell* signal is **negative over a wide range of plausible edges**; the
expected value of acting on a *buy* signal with new money is merely **unproven**. These
are not the same claim, and the product should not treat them as one.

**(iii) Novy-Marx & Velikov's own best mitigation is literally "sell less".** Their most
effective cost-mitigation technique is the **buy/hold spread — stricter conditions to
enter a position than to keep holding it**. The best-evidenced implementation detail in
the cost literature is an **asymmetry between the buy rule and the sell rule in the
direction of not selling.**

**Conclusion for the product.** *If* a fundamental signal is ever surfaced, it may inform
**where new contributions go** — which realises no gain, pays no tax, and is the
cash-flow-rebalancing principle already adopted above. It must **not** generate sell
prompts. This is a sharper, better-grounded version of the rebalancing decision already
recorded, and consistent with it.

#### D.3 Indian evidence specifically

**No study was found that tests a fundamental screen against buy-and-hold net of Indian
transaction costs and the post-July-2024 tax regime.** The Indian F-Score studies in C.1
report **gross** returns. **This is the single largest evidence gap in this report**, and
it is the gap that matters most, because the tax regime is recent enough that no published
backtest can have incorporated it. **Anyone claiming an Indian fundamental screen beats
buy-and-hold after tax is extrapolating, not citing.**

#### D.4 The map the brief asked for

| Claim | Status |
|---|---|
| "ROE 8.2%, below its own 5-yr median of 14.1% and below the sector median of 13.4%" | **Defensible.** Arithmetic on filed, sourced, as-of-stamped data. No forecast. Now *possible* (section A). |
| "Promoter pledging rose from 1.4% to 18% over four quarters" | **Defensible.** Primary-source fact with a date. |
| "Gross NPA 4.1%, up 80bps YoY; here is the peer distribution" | **Defensible** for banks, using the bank taxonomy. |
| "F-Score 8 of 9 — here are the 9 components and which passed" | **Defensible as description** if the components are itemised, the sector caveats shown, and **no return claim attached**. Becomes indefensible the moment it is framed as a ranking to act on. |
| "Score 82 → BUY" / "Score 31 → SELL" | **Not defensible.** A forecast of returns, with no net-of-Indian-tax evidence behind it, and section D.2(ii) makes the sell side actively value-destroying. |
| "Trim this holding, its fundamentals have deteriorated" | **Not defensible, and the worst of the set** — it is a sell prompt, the leg the evidence least supports and tax most penalises. |

The honest boundary: **the app may describe a company against its own history and its
sector, in units the owner can audit back to a filing. It may not rank, grade for action,
or prompt a trade.**

---

### C. Composite scores — what replicates

#### C.1 Piotroski F-Score

**Original.** Piotroski (2000) — nine binary accounting signals applied within high
book-to-market stocks. Widely replicated in-sample; the construction is public and free of
IP encumbrance.

**Out of sample.** Mixed, and weaker than its reputation.
- A CFA UK review (https://www.cfauk.org/pi-listing/man-machine-the-evolution-of-fundamental-scoring-models-and-ml-implications)
  describes out-of-sample performance as **mixed**: it cites Piotroski & So (2012)
  supportively, notes the score **fails to produce statistically significant alpha in some
  tests**, yet also reports F-Score and Mohanram's G-Score as **among the few scoring
  models showing significant out-of-sample alpha**. That internal tension is the honest
  summary of the field.
- A Quant-Investing backtest on growth stocks 1999–2010 reports a positive, statistically
  significant high-minus-low F-Score spread **with wide year-to-year variation**
  (https://www.quant-investing.com/media/tztosoes/backtest_utility_of_piotroski_f-score_for_predicting_growth-stock_returns_14.pdf).
  Practitioner work, not peer-reviewed.
- Practitioner replications claiming it **no longer works** on the original universe
  (Portfolio123 / Seeking Alpha) are **blog analyses, not peer-reviewed**, and one cites a
  ~9.5% average annual loss over ten years on the original criteria. **Reported, not
  relied on.**
- **I did not find a peer-reviewed out-of-sample replication isolating post-2000 F-Score
  returns.** Schwartz & Hanauer (2024), "Formula Investing", appeared only as a citation
  and was **not retrieved**.

**Indian tests — they exist, and they disagree.**
- **Tripathy & Pani (2017)**, "Effect of F Score on Stock Performance: Evidence from Indian
  Equity Market" (https://www.researchgate.net/publication/312397957): **500 companies,
  2010–2015**, concluding high-B/M firms with high F-Scores shift the distribution of
  contemporaneous and future performance in investors' favour. **Positive.**
- **Singh & Kaur (2015)**, BSE non-financial firms **1996–2010**: F-Score investing gives
  greater returns at controlled risk. **Positive.** *Accessed via secondary citation only.*
- A **contrary** Indian panel study found higher F-Scores **not associated** with higher
  future yields. **Abstract-level snippet only; sample period and method unverified.**
- Base-rate note: **only 11 BSE-500 companies scored a full 9** in one study — the
  top bucket is tiny, so a single-user portfolio will rarely contain one.

**Verdict.** The F-Score is **a sound, free, transparent description of accounting
quality** whose **return-predictive claim does not reliably replicate**, and whose Indian
evidence is split, gross-of-cost, and ends before the current tax regime.
**Use the nine components as an itemised explanation; do not use the total as a signal.**

#### C.2 Post-publication decay — the general law

**McLean & Pontiff**, *Does Academic Research Destroy Stock Return Predictability?*,
*Journal of Finance* 71(1), 5–32, Feb 2016
(https://onlinelibrary.wiley.com/doi/abs/10.1111/jofi.12365). **97 predictor variables.**
Returns are **~26% lower out-of-sample and ~58% lower post-publication**; underlying
monthly averages **0.58% in-sample → 0.40% out-of-sample → 0.26% post-publication**. The
26% is treated as an upper bound on data-mining effects, leaving ~32pp attributed to
publication-informed trading. *Caveat:* later work sometimes cites ~50% rather than 58% —
check which baseline a source uses.

Independent confirmations: an arXiv study finds post-publication Sharpe falls **~43%**
(https://arxiv.org/pdf/2105.01380); a *Quantitative Finance* paper finds decay of about
**one half** on CRSP data with **publication date the main predictor of decay**
(https://www.tandfonline.com/doi/pdf/10.1080/14697688.2022.2098810).

**Piotroski (2000) has been public for 26 years.** Whatever edge it had, the best-evidenced
general law in the field says **roughly half is gone**, and section D.1 says the remainder
is inside the cost-and-tax band.

#### C.3 The replication crisis — the factor zoo

**Hou, Xue & Zhang**, *Replicating Anomalies*, *Review of Financial Studies* 2020
(https://global-q.org/uploads/1/2/2/6/122679606/houxuezhang2020rfs.pdf; NBER w23394):
**65% of 452 anomalies fail |t| ≥ 1.96** once microcaps are controlled with NYSE
breakpoints and value-weighted returns. **Microcaps are 3.2% of market cap but 60.7% of
listed stocks** — original studies overweight them. Their slides report **52% fail
irrespective of microcaps** once multiple testing is adjusted.

**Contested, and say so:** critics argue this restates that anomalies concentrate in small
stocks (Fama & French 2008); **Jensen, Kelly & Pedersen report much higher replication
rates** under different consistent methods. *The 82% figure circulating in secondary
summaries is not Hou et al.'s headline — do not quote it.*

**Relevance to India, inference:** the microcap critique is **sharper** here. Indian
small-caps carry wider spreads and lower depth than US microcaps, and NSE's **ASM/GSM**
surveillance frameworks can impose trade-for-trade settlement and 100% margin on exactly
the illiquid names a value-and-quality screen selects. **A screen's top decile and the
surveillance list overlap.** *I did not find a study quantifying this overlap — unverified,
and it would be a genuinely useful thing to measure.*

#### C.4 Altman Z-score

**Emerging-market variant Z''**: `Z'' = 3.25 + 6.56·X1 + 3.26·X2 + 6.72·X3 + 1.05·X4`;
safe > 2.6, grey 1.1–2.6, distress < 1.1 (https://en.wikipedia.org/wiki/Altman_Z-score).

**Indian evidence is weak.** A longitudinal study of **30 NSE small-caps** reports **76.9%
accuracy** — but **measured on the sample used to fit it, so not an out-of-sample
validation** (https://www.researchgate.net/publication/398926973). A study of Indian
public-sector banks found the original 1968 five-ratio model **unable to predict distress**
— consistent with the general rule that **Z-scores do not apply to financial firms**. A
single-company Bharti Airtel study found the score contradicted other indicators and
called for re-estimating coefficients for service firms
(https://e-journal.unair.ac.id/SABR/article/view/63958).

**I found no Indian validation with a holdout sample, a matched control group, and reported
Type I/II error rates.** Most available studies are small, single-sector, and in lower-tier
venues. **Verdict: not fit to display as a distress probability.** `X1`/`X4` need working
capital and market-vs-book-liability data that the XBRL above does not directly carry
(**unverified** whether it can be derived).

#### C.5 Beneish M-Score

Built on **74 SEC-identified manipulators vs 2 332 controls**. Holdout performance as
reported by secondary sources: **catches ~76% of manipulators but flags ~17.5% of
non-manipulators** (https://stablebread.com/beneish-m-score/). **I could not confirm these
against Beneish (1999) itself** (https://www.calctopia.com/papers/beneish1999.pdf).

**With a low base rate of manipulation, a 17.5% false-positive rate means the overwhelming
majority of flagged companies are innocent.** Documented limits: **strong sales growth
inflates the score without manipulation**, so growth firms are a major false-positive
source; calibrated on **US manufacturers**; **financial institutions excluded**; built for
earnings **overstatement** only; coefficients date to 1999.

**Verdict: must not be shown.** Labelling a company the owner holds as a probable earnings
manipulator, on a 1999 US-manufacturer model with that false-positive rate, is the clearest
"confident nonsense" case in this report.

#### C.6 Not reached

**Mohanram G-Score** (appears only inside the CFA UK citation above), **Novy-Marx gross
profitability**, and **index-provider quality-factor methodologies** (MSCI, S&P) were
**not researched**. Flagged rather than thinned, per the brief.

---

### B and E — not completed

**Stated plainly, as the brief requires.** Budget went to A, D and C in the priority order
given. **Section B** (per-metric definitions, Indian reporting conventions, and the precise
failure modes of each ratio) and **Section E** (peer-set construction, within-sector
percentiles, vintage labelling, not-applicable rendering) were **not researched to the
primary-source standard this report uses**, and nothing is asserted about them here beyond
what section A established as structurally available:

- the **bank / NBFC / non-financial taxonomy split** (A.4) is the backbone section B would
  need, and it already exists in the data;
- **`LevelOfRoundingUsedInFinancialStatements`** and
  **`NatureOfReportStandaloneConsolidated`** (A.3) are the units and basis traps, solved;
- **`filingDate` / `broadCastDate`** and the shareholding **revision** fields (A.2, A.5)
  are the vintage and as-of labelling primitives section E would need;
- **`ind_close_all`** index P/E and P/B (A.6) is the market-level comparison baseline;
- **ASM/GSM** is named in C.3 but **not researched** — no endpoint was probed for it.

**B and E should be a second research task**, and B in particular is the one the owner's
"explain each datum" request most directly depends on.

---

### Recommendation

1. **Amend the "no fundamentals feed" clause.** Its factual premise is false (A.8).
   Replace it with the reasoning from C and D, which is stronger: *fundamentals are
   available and will be shown and explained; they are not converted into a buy/sell
   verdict because the published edge does not survive replication, publication decay, and
   Indian tax — and because the sell side is affirmatively value-destroying.*
2. **Build the explanatory layer, not the verdict layer.** Per-metric description against
   the company's own history and its sector, every number traceable to a filing URL, a
   filing date and a units tag. This satisfies "explain each datum" and the "nerdy
   dashboard" in full.
3. **Itemise composites, never total them into an action.** Show the nine F-Score
   components and which passed. **Do not** display Beneish M (C.5) or an Altman distress
   probability (C.4).
4. **No sell prompts, ever** (D.2). Fundamental context may inform **where new
   contributions go**; it may not prompt a disposal.
5. **Holdings-scoped ingestion only** (A.7) — filing-event cadence, never a market-wide
   sweep. Defensible under NSE's clause and sufficient for one user.
6. **Treat `/api/*` as unstable** (A.1) and the archive host as the durable path.
7. **Commission B and E as a follow-up research task.**

### Confidence

**High** — all endpoint probes in A (run live 2026-10-23, status codes and payload sizes
recorded, XBRL files fetched and tag-inventoried); the McLean & Pontiff citation and
figures; the Hou/Xue/Zhang 65% figure; the Novy-Marx & Velikov turnover threshold and
buy/hold-spread finding; the Stambaugh/Yu/Yuan short-leg result.

**Medium** — Chen & Velikov's −3bps/month and 4–13bps/month (secondary, paper not
retrieved); the Indian F-Score studies (abstracts and secondary summaries, originals not
read); Beneish holdout rates (secondary, not confirmed against the 1999 paper); the Altman
Indian studies (low-tier venues).

**Low / unverified** — the LODR Reg 33 explanation for why Q4 filings carry the balance
sheet; the true start date of the financial-results history; whether Altman X1/X4 are
derivable from these XBRL fields; the ASM/GSM–screen overlap; the shareholding XBRL's
internal structure; **my own tax-hurdle re-derivation in D.1**, which is arithmetic, not a
citation, and should be re-checked.

**Could not verify** — the NSE terms-of-use clause (page now 404s; the repo's earlier
verbatim quote stands unconfirmed this session); any screener.in terms of use (no such
page found); Schwartz & Hanauer (2024); Mohanram G-Score, Novy-Marx gross profitability,
and index-provider quality methodologies (C.6).
