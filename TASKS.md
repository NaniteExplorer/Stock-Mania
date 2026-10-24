# Tasks

Updated: 2026-10-24
Status: READY — awaiting the owner's go-ahead to start P0.

The operational board. Every task has **one owner, one file scope, one acceptance
check, and its dependencies**. A task without an acceptance check is not a task and
must not be started ([`RULES.md`](RULES.md) §7.6).

Full reasoning for each phase is in
[`_architecture/requirements/financial-health-scoring.md`](_architecture/requirements/financial-health-scoring.md).
This file is the checklist; that file is the argument.

**Authority clarification (2026-10-24):** this board owns execution status, owners and
dependencies for Phase F and P0–P6. `_architecture/70-UPGRADE-PLAN.md` retains the
architecture rebuild's progress and historical QA evidence; it does not track these new
phases. No completion is inferred from product prose or a mockup.

## Documentation reconciliation

| # | Task | Owner | Files | Depends | Acceptance | Done |
|---|---|---|---|---|---|---|
| DOC-R1 | Reconcile documented authority, status, fundamentals scope and pending decisions | Codex; independent QA | `TASKS.md`, `MEMORY.md`, `PRODUCT-REQUIREMENT.md`, `ARCHITECTURE.md`, `DESIGN.md`, `_design/README.md`, `_architecture/00-INDEX.md`, `_architecture/70-UPGRADE-PLAN.md`, `_architecture/requirements/financial-health-scoring.md` | Owner authorised documentation only, 2026-10-24 | DOC-R1 acceptance criteria in the requirement plan pass independent QA; D1–D7 remain pending | [ ] |

---

## The ownership boundary

Ownership is decided by **the kind of acceptance check**, not by a target percentage:

> **Codex owns anything with a mechanical acceptance check** — it compiles, it
> round-trips, the migration reverses, the fixture matches, the test passes.
> **Claude owns anything whose acceptance check is "is this number right, and can we
> defend it."**

*Reason: a fixed ratio quietly pushes some task to the wrong agent, and the cost is paid
as a plausible-looking wrong number rather than a failed build. The boundary gives Codex
the majority naturally while keeping Claude on the four places where a silent error
survives every green check — tax arithmetic, the scoring composite, the projection
engine, and the percentile bands.*

**UI is split in two.** A screen is specified once (Claude: layout, states, tokens,
copy, keyboard behaviour, what each figure means and when it is an em-dash) and then
built against that spec (Codex). A `*.s` task is a spec; the matching `*.b` is the build.
**A build task must not start until its spec is written**, and the build's acceptance
check is conformance to the spec, which is mechanical.

---

## How to use this board

1. Find the first unticked task whose dependencies are all ticked.
2. Confirm you are its owner. If you are not, **leave it** — pick the first unticked
   task that is yours.
3. Read only the files in its scope, plus the documents it names.
4. Do the work. Run the acceptance check. Record the result in the task row.
5. Record anything you settled in [`MEMORY.md`](MEMORY.md) in the same change.
6. Do not stage. Do not commit.

**A contract task (`*.0`) blocks every task in its phase.** Nothing in a phase starts
until its contract task is merged, because the contract is what lets the two agents work
without colliding.

---

## How uniformity is enforced

Splitting spec from build is where a two-agent UI normally drifts: two agents hand-roll
the same button slightly differently, and after twenty screens the product looks assembled
rather than designed. **A document cannot prevent that — only a shared component library
in code can**, plus a check that fails mechanically when something bypasses it.

So three things hold the line, in order of strength:

1. **Phase F ships the component library in code, once, before any `.b` task starts.**
   Every build task *composes* from it. A build task that introduces a new component
   stops and raises it as an F-task instead.
2. **A conformance check fails the build** on a raw hex colour, an off-scale control
   height, a radius not bound to its height, a hyphen-minus in a figure, or a transition
   on a property outside the permitted set. Uniformity you cannot measure is uniformity
   you do not have.
3. **`DESIGN.md` is the written contract**, and the Control Bench artifact is its visual
   reference. Where they disagree, the artifact wins and `DESIGN.md` is corrected.

**Nothing in the library is authored twice.** If a screen needs a variant, it is added to
the library by its owner and then used — never forked into the screen.

---

## Phase F — UI foundation

**Blocks every `.b` task in every phase.** Runs alongside P0.

| # | Task | Owner | Files | Depends | Acceptance | Done |
|---|---|---|---|---|---|---|
| **F.0** | **Contract.** The token set as CSS custom properties — the full corrected set, both themes, with each of the four measured corrections carrying its contrast ratio in a comment | Claude | `app/globals.css` | D.1.s | Every token in `DESIGN.md` §1 present; no token below its stated floor | [ ] |
| F.1 | Component primitives: button (all variants and states), input, select, checkbox, radio, switch, segmented control, chip | Codex | `components/ui/` | F.0 | Height, radius, border strength and focus offset all derive from tokens; no literal values | [ ] |
| F.2 | Data display: table shell, compact row, cell types (text, figure, badge, action), the em-dash unknown cell | Codex | `components/ui/` | F.0 | The em-dash cell is `tabindex="0"` and carries its reason. Figures are tabular-lining and decimal-aligned | [ ] |
| F.3 | Feedback and overlay: toast, banner, dialog, popover, menu, tooltip, skeleton, spinner | Codex | `components/ui/` | F.0 | `prefers-reduced-motion` collapses transitions to 1ms and both spinners to a static dotted ring | [ ] |
| F.4 | Number formatting primitives — `rupee`, `compact`, `percentage`, `signed` | Codex | `src/core/format.ts` | — | `en-IN` grouping; minus is U+2212; compact truncates toward zero. Fixtures: `₹1,42,560`, `−₹4,350.00`, `₹48.72L`, `₹1.61Cr` | [ ] |
| F.5 | The 55-icon set, hand-authored inline SVG | Codex | `components/icons/` | F.0 | 16-unit grid, 1.3-unit stroke, `fill:none`, round caps. Optical weight constant at 14/16/20px | [ ] |
| F.8 | **Architecture conformance check** — fails on `instanceof`/type-tag switching inside `src/domain/`, any import from `src/domain/` to `src/infra/`, and a raw `number` crossing a domain boundary | Codex | — | Deliberately non-conforming fixtures fail; the shipped domain passes | [ ] |
| F.6 | **Conformance check** — fails on a raw hex, an off-scale height, a radius not bound to height, a hyphen-minus in a figure, or an animated property outside the permitted set | Codex | `scripts/`, lint config | F.1–F.5 | Deliberately non-conforming fixtures fail; the shipped library passes | [ ] |
| F.7 | Every existing screen migrated onto the library | Codex | `app/(root)/**`, `components/` | F.6 | F.6 passes repo-wide. No screen carries its own styling | [ ] |

---

## P0 — correctness debt

Ships alone, first. These are wrong *today*, independent of everything else.

| # | Task | Owner | Files | Depends | Acceptance | Done |
|---|---|---|---|---|---|---|
| 0.1 | `monthlyDebtPayments` nullable; `debtToIncome` returns null when payments are unmeasured, not when income is zero | Claude | `src/domain/reports.ts`, `src/app/reports.usecases.ts` | — | A user with income and loans sees an em-dash, never 0%. Test asserts null for unmeasured, a real ratio when fed | [ ] |
| 0.2 | Feed real debt payments from `equatedInstalment()` | Claude | `src/app/reports.usecases.ts` | 0.1 | Ratio matches a hand-computed EMI sum in a fixture | [ ] |
| 0.3 | Repair the SBI geometry column mapping | Codex | `src/infra/pdf-statements.ts` | — | `npm run check:statement` exits 0 on the two SBI files | [ ] |
| 0.4.s | Spec: how an opening-balance gap is stated — the arithmetic shown, the wording, which states apply | Claude | `DESIGN.md`, `src/domain/banking.ts` | — | The named gap and the rupee difference are both specified, with the em-dash case covered | [ ] |
| 0.4.b | Build the opening-balance gap notice on the account page | Codex | `app/(root)/accounts/[accountId]/` | 0.4.s | Conforms to spec; an account whose first statement starts mid-life shows the gap | [ ] |

**0.4 is the owner's reported balance bug.** Diagnosis already exists in
`_architecture/requirements/pdf-geometry-reader-drops-rows.md` — the arithmetic there is
exact. The balance is wrong because a period was never imported, not because parsing
failed.

---

## P1 — the four new domains

Runs in parallel with P2 (different tables, different screens).

| # | Task | Owner | Files | Depends | Acceptance | Done |
|---|---|---|---|---|---|---|
| **1.0** | **Contract.** Schema and types for `insurance_policies`, `recurring_commitments`, `physical_assets`, `income_streams`, plus a shared `recurrence` value type | Codex | `src/infra/db/schema.ts`, `src/core/recurrence.ts`, migration | P0 | Types compile; migration up and down both run | [ ] |
| 1.1 | Recurrence engine: cadence, next-due, cancel-by, price-change-at-renewal | Codex | `src/domain/recurrence.ts` | 1.0 | Tests cover monthly/quarterly/annual, leap years, month-end rollover, mid-term price change | [ ] |
| 1.2 | Insurance domain — cover adequacy as **presence only** | Claude | `src/domain/insurance.ts` | 1.0, 1.1 | No rupee sum-insured threshold anywhere; erosion shown as information, cited as a consultancy survey | [ ] |
| 1.3 | Recurring commitments — committed outgo per month and year, auto-renew flag | Codex | `src/domain/commitments.ts` | 1.0, 1.1 | Totals reconcile to active commitments; a cancelled one leaves the total on its end date, not immediately | [ ] |
| 1.4 | Physical assets — persist and generalise `Vehicle.depreciatedValueOn` | Codex | `src/domain/assets.ts`, repository | 1.0 | Round-trips; depreciation rate stored and surfaced, never baked into the stored value | [ ] |
| 1.5 | Income streams — expected vs actual, the three-state model | Claude | `src/domain/income.ts` | 1.0 | A missed expected inflow reads as **missing**, not as zero income | [ ] |
| 1.6 | Repositories and server actions for all four | Codex | `src/infra/db/repositories/`, `app/(root)/*/actions.ts` | 1.2–1.5 | Each round-trips; authorization scoped to the owner; no business logic in the action | [ ] |
| 1.7.s | Spec: the four entry surfaces and list views — layout, all six states, keyboard, what is an em-dash and why | Claude | `DESIGN.md` | 1.2–1.5 | Every figure on every surface has a defined unknown state | [ ] |
| 1.7.b | Build the four surfaces | Codex | `app/(root)/insurance/`, `/commitments/`, `/belongings/`, `/income/` | 1.6, 1.7.s | Conforms to spec and Control Bench; all six states present | [ ] |
| 1.8 | Expense-to-asset-acquisition link | Codex | schema, `src/domain/transactions.ts` | 1.0, 1.4 | Does **not** violate L12 — a side table, never a second column on the posting | [ ] |

---

## P2 — the mutation model

| # | Task | Owner | Files | Depends | Acceptance | Done |
|---|---|---|---|---|---|---|
| **2.0** | **Contract.** A/B/C data-class registry: every table declares its class and legal verbs | Codex | `src/domain/mutation-classes.ts` | P0 | Exhaustive over all 47 tables; a new table without a class fails to compile | [ ] |
| 2.1 | `restore()` — the one new repository primitive | Codex | `src/domain/transactions.ts`, repositories | 2.0, **D2** | Round-trips a tombstone; restored rows re-enter every balance; reconciled rows refuse (L10) | [ ] |
| 2.2 | Batch identity on `audit_events.request_id` as the undo unit | Codex | `src/app/ledger.usecases.ts` | 2.1 | One edit, fifteen removals and a whole import all undo as one unit | [ ] |
| 2.3 | Undo tombstones the reversal **and** the replacement | Claude | `src/app/ledger.usecases.ts` | 2.2 | Original returns to every balance; evidence stays behind a filter; reverse-a-reversal still blocked | [ ] |
| 2.4 | Recommended redo invalidation rules — one-step cursor (class A), bounded stack of 20 (class B), pending D3 | Claude | `src/app/ledger.usecases.ts` | 2.3, **D3** | Owner-approved scope; invalidated the moment a newer mutation touches an entity in the undone batch; disabled **with a reason** | [ ] |
| 2.5 | Bulk mutation resolved server-side at confirm time | Codex | `app/(root)/transactions/actions.ts` | 2.2, **D1** | Replaces the comma-joined id string for filter-scoped operations | [ ] |
| 2.6.s | Spec: the "remove all" confirmation pattern | Claude | `DESIGN.md` §7 | 2.5, **D5** | Scope restated as filter chips; typed phrase carries the count; unfiltered refusal pending D5 approval | [ ] |
| 2.6.b | Build the confirmation | Codex | `components/` | 2.6.s | Conforms to spec | [ ] |
| 2.7.s | Spec: the Activity screen — grouping, what is undoable, how a refusal reads | Claude | `DESIGN.md` | 2.2 | Every mutation class has a defined row treatment and a defined refusal reason | [ ] |
| 2.7.b | Build the Activity screen | Codex | `app/(root)/activity/` | 2.2, 2.7.s | Conforms to spec; every mutation in the retention window listed and attributable | [ ] |
| 2.8.s | Spec: the keyboard model across every table, incl. the text-input guard | Claude | `DESIGN.md` §6 | 2.3, 2.4 | Every binding defined, including what happens when the verb is illegal | [ ] |
| 2.8.b | Build the keyboard model | Codex | `components/` | 2.8.s | Conforms to spec; no destructive verb fires while typing in a field | [ ] |

---

## P3 — scoring and tiers

**Blocked on P1 completing.** The composite refuses to compute until the Protect pillar
has an insurance entity, so there is no point starting earlier.

| # | Task | Owner | Files | Depends | Acceptance | Done |
|---|---|---|---|---|---|---|
| **3.0** | **Contract.** Indicator registry: id, formula, benchmark, source URL, date, pillar | Codex | `src/domain/scoring/indicators.ts` | P1 | An indicator without a primary-source citation does not compile | [ ] |
| 3.1 | Three-state measurement model | Claude | `src/domain/scoring/` | 3.0 | A pillar with any unknown reports an em-dash; the composite refuses and names the missing pillar | [ ] |
| 3.2 | Normalisation and aggregation — geometric across pillars, arithmetic within | Claude | `src/domain/scoring/composite.ts` | 3.1 | Property test: a zero pillar cannot be compensated by a strong one | [ ] |
| 3.3 | Non-compensatory tier ceilings | Claude | `src/domain/scoring/tiers.ts` | 3.2 | Ceiling applies before the tier label is derived | [ ] |
| 3.4 | Hysteresis on demotion | Claude | same | 3.3 | A score oscillating across a boundary does not flicker the tier; a drop is never celebrated | [ ] |
| 3.5 | Coverage percentage and sensitivity range on every score | Claude | same | 3.2 | Recomputed under 3-vs-6 months, 10x-vs-15x, 3%-vs-4% SWR; the range is shown | [ ] |
| 3.6 | Missing metrics: CAGR, HHI concentration, emergency fund, stored target allocation | Codex | `src/domain/portfolio.ts`, `reports.ts` | 3.0 | Each matches a hand-computed fixture | [ ] |
| 3.7 | Descriptive per-holding context, including equity fundamentals per product §5.3 | Claude | `src/domain/scoring/position.ts` | 3.6; B/E metric-definition and peer-construction research; fundamentals ingestion blocked by RULES §4.3/§4.4 clarification | Own-history/sector comparisons carry filing URL, date and units; no buy/sell ranking; no fund-level fundamentals score, Beneish M-Score or Altman distress probability; Piotroski components never totalled into an action | [ ] |
| 3.8 | Percentile placement, India and World | Claude | `src/domain/scoring/percentile.ts` | 3.0 | Every placement a band with stated uncertainty, widening above the 90th; PPP-converted; refuses past "top 10%" for India | [ ] |
| 3.9 | Log-ratio-to-median progression; decomposition on every move | Claude | same | 3.8 | Reports real-income change against distribution change | [ ] |
| 3.10 | Badge criteria — what may and may not be rewarded | Claude | `src/domain/scoring/badges.ts` | 3.3 | No badge rewards transaction count or frequency; no leaderboards | [ ] |
| 3.11.s | Spec: the scoring dashboard, incl. guess-first framing and how a refusal reads | Claude | `DESIGN.md` | 3.1–3.10 | No score specified that P1 cannot compute | [ ] |
| 3.11.b | Build the scoring dashboard | Codex | `app/(root)/standing/` | 3.11.s | Conforms to spec; all six states present | [ ] |

---

## P4 — lifetime net worth

| # | Task | Owner | Files | Depends | Acceptance | Done |
|---|---|---|---|---|---|---|
| 4.1 | Capture date of birth | Codex | schema, migration, `app/(root)/settings/` | P1 | Optional; the chart degrades to a calendar-year axis rather than refusing | [ ] |
| 4.2.s | Spec: the net-worth-against-age chart — real vs nominal, the CPI base-break treatment, milestone marks | Claude | `DESIGN.md` §8 | 4.1 | The Jan-2026 CPI base break is explicitly spliced or marked; real is the default | [ ] |
| 4.2.b | Build the chart | Codex | `app/(root)/dashboard/` | 4.2.s | Conforms to spec | [ ] |
| 4.3 | Milestones as **expense** multiples | Claude | `src/domain/milestones.ts` | 4.2.s | 33x cited on screen. Never 25x. No income-multiple milestones | [ ] |

---

## P5 — projection

| # | Task | Owner | Files | Depends | Acceptance | Done |
|---|---|---|---|---|---|---|
| **5.0** | **Contract.** Assumption set — typed, user-editable, per-input source and label | Codex | `src/domain/projection/assumptions.ts` | P3 | Every default carries its basis; vendor-sourced inputs flagged | [ ] |
| 5.1 | Stationary block bootstrap, 3–5 year blocks, equity and debt jointly resampled by year | Claude | `src/domain/projection/bootstrap.ts` | 5.0 | Empirical correlation preserved without an invented correlation matrix | [ ] |
| 5.2 | SIP suspension re-runs the full path set | Claude | same | 5.1 | Gap between **lower bands** highlighted, not medians; cost reported in years as well as rupees | [ ] |
| 5.3.s | Spec: the fan chart — faded open-ended outer band, real-terms headline, scenario-count wording | Claude | `DESIGN.md` §8 | 5.2 | No crisp outer edge; no probability anywhere in the copy | [ ] |
| 5.3.b | Build the projection screen | Codex | `app/(root)/projection/` | 5.3.s | Conforms to spec | [ ] |
| 5.4 | Scenario **count**, never a probability | Claude | `src/domain/projection/` | 5.2 | A historical frequency, stated as one | [ ] |
| 5.5 | Refusal gate | Claude | `src/domain/projection/` | 5.0 | Refuses, naming the cause. **Never silently substitutes a default** | [ ] |
| 5.6 | NPS annuitisation 20% non-govt / 40% govt | Claude | same | 5.0 | A full NPS corpus is never treated as spendable | [ ] |

---

## P6 — alerts

| # | Task | Owner | Files | Depends | Acceptance | Done |
|---|---|---|---|---|---|---|
| 6.1 | Tier 1 alert rules and copy | Claude | `src/domain/alerts.ts` | P3 | Each states facts and suggests nothing; the boundary alert states both tax rates | [ ] |
| 6.2 | Threshold-band rebalancing, bands wider than 5/25 | Claude | `src/domain/portfolio.ts` | 6.1 | Offers the cash-flow route first — next SIP to the underweight sleeve, realising no gain | [ ] |
| 6.3.s | Spec: the Tier 2 in-app board | Claude | `DESIGN.md` §8 | 6.1 | No percentile appears next to an action or without dispersion; no interpretation text on the macro panel | [ ] |
| 6.3.b | Build the signals board | Codex | `app/(root)/signals/` | 6.3.s | Conforms to spec | [ ] |
| 6.4 | Source health monitor | Codex | `src/infra/market-data/` | — | Every source degrades gracefully; none is load-bearing | [ ] |

---

## Design debt (independent of the phases)

| # | Task | Owner | Depends | Acceptance | Done |
|---|---|---|---|---|---|
| D.1.s | Spec the visual elevation pass into `DESIGN.md` | Claude | — | Any new colour carries a computed contrast ratio, not an estimate | [ ] |
| D.1.b | Refit the Banking Console artifact to the corrected token set | Codex | D.1.s | `--border-control` present; no token below its WCAG floor | [ ] |
| D.2 | Reconcile debt-aggregates navigation placement across artifacts | Claude | — | One placement, applied everywhere | [ ] |
| D.5 | `--c-other` `#8C98A6` measures **2.93:1** on white — below the 3:1 non-text floor. **Failing today**, same class as the four corrections already made | Claude | — | Replacement measured at >=3:1 both themes | [ ] |
| D.6 | `info-i` puts every KPI explanation in a `title=` on a non-focusable `<i>` — not keyboard-reachable, the exact mistake `DESIGN.md` §3 forbids for the em-dash | Codex | F.1 | Each is a `<button>`; reachable and dismissible by keyboard | [ ] |
| D.4 | Wire `ProviderMark` into every surface showing an account, holding, platform or institution | Codex | F.1 | Logos resolve via `/api/logo/<id>`; a 404 renders the branded badge, never a generic square. No new logo mechanism added |  [ ] |
| D.3 | Visual inspection of every artifact at desktop, tablet and phone widths, both themes | Human, or an agent with a browser | — | Narrow widths, chart label crowding and dark-theme rendering confirmed by eye | [ ] |

---

## Blocking decisions the owner must make

**Reconciliation note (2026-10-24):** D1–D7 below are all still pending. A design or
recommendation elsewhere is not approval. D3 gates ledger redo, D5 gates the proposed
unfiltered-removal refusal, and D4 gates the optional restatement offer. The owner has
authorised DOC-R1 only, not these decisions or production implementation.

These sit in front of the tasks that depend on them.

| id | Decision | Blocks | Recommendation |
|---|---|---|---|
| **D1** | Is a filter-scoped bulk mutation **atomic**? Designed atomic — "Nothing was removed", blocking rows named, *Retry without them* as a new batch. **Contradicts today's deliberately non-atomic `bulkDeleteTransactionsAction`** | 2.5, 2.6 | Atomic, matching `saveMany` |
| **D2** | Tombstone retention. After the window, undo of a removal is impossible | 2.1, 2.7 | 30 days |
| **D3** | Does redo exist for ledger data at all, or class B only? | 2.4 | One-step cursor for A, stack for B. Honest fallback: B only |
| **D4** | When a class B header changes, offer "and restate the N postings already made from it"? | 1.2, 1.3 | Yes — a separate confirmed step, never automatic |
| **D5** | Does "remove all" require a filter? | 2.6 | Yes — refuse on an unfiltered table |
| **D6** | Does the command palette get destructive verbs, or only navigational ones? | 2.8 | Navigational only |
| **D7** | Saved-views storage table — still missing, carried forward since Wave 1 | — | Needed for v2; not yet specified |

## Verification debt

Must be discharged before the dependent task ships, not after. **Owned by Claude
regardless of who builds the surface** — these are figures that must be read from a
primary source before anything displays them, and routing them by convenience is how an
unsourced number reaches the screen.

- OECD/JRC Handbook aggregation chapter, CFPB user guide copyright statement, FinHealth
  toolkit — **all three refused automated fetch** and must be opened by hand. Blocks 3.0.
- Greninger et al. 1996 — the true provenance of most "standard" ratio thresholds, and
  what the UI should cite instead of blogs. Blocks 3.0.
- The two SSRN papers behind the 3.0% SWR default. Blocks 4.3 and 5.0.
- **Indian tax rates against the bare Finance Act** — before *any* tax computation ships.
  Blocks 6.1.
- WID.world data licence, whose terms-of-use URL 404s. Blocks 3.8.
