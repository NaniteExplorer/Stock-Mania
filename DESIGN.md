# Design

Updated: 2026-10-24
Owner: Claude (per the routing in [`RULES.md`](RULES.md) §7)

The visual and interaction contract for the v2 redesign. Holds tokens, component
contracts, state coverage and accessibility floors. It holds no business logic and no
task list.

**The visual source of truth is [`_design/`](_design/README.md)** — the published
mockups mirrored into the repository as readable source, so both agents work from the
same thing. Codex cannot open a claude.ai artifact; it can read
`_design/control-bench/index.html` perfectly well, and that file's `:root` block is the
real token set.

**Where this document and `_design/control-bench/` disagree, the mirrored source wins**
and this document is corrected. This document is a summary of those files, and a summary
drifts. Artifact links are indexed in [`artifacts.md`](artifacts.md) for viewing; they are
not the handoff medium.

**Precedence clarification (2026-10-24):** Control Bench remains the reference for
components, control geometry and corrected colours. For the newer page typography,
spacing and structural border application, `_design/elevation-pass/index.html`'s
`.stage[data-mode="after"]` supersedes the Institutional Shell scales. D.1.s still
must integrate those scales here before F.0 starts; DOC-R1 does not complete that
design task or approve the remaining contrast/accessibility debt.

---

## 1. Foundations

**Fonts:** Inter (UI) + IBM Plex Mono (figures). Settled; earlier artifacts disagreed and
one used JetBrains Mono — that is superseded.

**Elevation is carried by borders, not shadows.** One border width (1px) and five
strength steps.

### 1.1 Scales — binding

| Scale | Values | Rule |
|---|---|---|
| **Control height** | `--h-xs 24` · `--h-sm 28` · `--h-md 32` · `--h-lg 36` · `--h-xl 40` | 32px is the default **because the compact table row is 32px** — a control dropped into a cell must not change the row height. 24px only for a control nested inside another control. 40px is the mobile touch size. Forms use 36px |
| **Radius** | `--r-1 2` · `--r-2 3` · `--r-3 4` · `--r-4 6` · `--r-5 8` · `--r-pill 999` · table cell `0` | **Radius is bound to height, never chosen per component.** <=32px control → `--r-2`; >=36px → `--r-3`; panel/menu/popover → `--r-4`; modal/sheet → `--r-5`; nested-in-a-control → `--r-1`; status dots only → `--r-pill` |
| **Border** | `--border-subtle` → `--border` → `--border-control` → `--border-hover` → `--border-active` | Hover = +1 step, press = +2 steps. Hover **darkens**, never re-hues |
| **Transition** | `--t-fast 90ms` (state) · `--t 110ms` (bar and fill widths) · `--ease cubic-bezier(.2,0,.38,1)` | Only `background-color`, `border-color`, `color`, `box-shadow`, `transform` animate. Collapses to 1ms under `prefers-reduced-motion`; spinners become a static dotted ring beside `aria-busy` |
| **Surface step** | light `#FFFFFF → #F6F8FA → #EFF2F5` · dark `#1A2026 → #232A31 → #2A323A` | rest → hover → pressed |

### 1.2 The corrected token set — all four found by measuring

These supersede the original design research. **Any artifact or component not carrying
these four corrections ships a WCAG failure.**

| Token | Was | Now | Why |
|---|---|---|---|
| **`--border-control`** *(new)* | `--border-strong` light `#B9C2CC` **1.80:1**, dark `#343C45` **1.60:1** | light `#808C9A` **3.42:1**, dark `#64707E` **3.54:1** | Form-control boundaries claimed 3:1 and **both themes failed WCAG 1.4.11**. An input's edge was not a boundary. `--border-strong` is retired as a control token and survives only as decorative chrome |
| **`--border` (dark)** | `--n-800 #232A31` → **1.23:1** | `--n-700 #343C45` → **1.60:1** | In a borders-carry-all-elevation system, dark panels had no visible edge at all |
| **`--bg-subtle` (light)** | `#EFF2F5` — `--fg-muted` on it measures **4.49:1** | `#F2F5F8` — **4.61:1** | A hair under AA for every caption on a subtle fill. Lifting the fill was cheaper than darkening every caption |
| **`--fg-disabled`** | light `#8C98A6` **2.93:1**, dark `#49545F` **2.31:1** | light `#7C8896` **3.61:1**, dark `#5C6875` **3.14:1** | WCAG exempts inactive controls, but **contrast is not a state channel**. Disabled is carried by fill, a weakened border, removal of the inner highlight, and `cursor:not-allowed` |

Two ramp steps exist to support the above: `--n-450 #808C9A` (light control border) and
`--n-775 #2A323A` (dark pressed surface).

**`--inner-hl` inverts between themes, deliberately.** Light has no room above `#FFFFFF`,
so a raised control is *seated* with `inset 0 -1px 0 rgb(19 24 29 / .07)`; dark has room,
so it flips to a true top highlight `inset 0 1px 0 rgb(255 255 255 / .055)`. One token,
two opposite values.

**Unchanged:** the neutral ramp, the indigo accent, the gain/loss pair, the five-hue chart
ramp, the type scale, and the borders-over-shadows stance.

### 1.3 Outstanding token debt

**The Banking Console artifact still ships the pre-correction set** — no
`--border-control`, and `--border-strong` still failing 3:1. It is visibly one step apart
from Statement Intake until refitted. Tracked as a task.

## 2. Craft rules

- **Pressed shifts the label 0.5px, not the button.** A button that moves as a whole
  breaks alignment with its neighbours.
- **Loading keeps the button's width** — the label goes `visibility:hidden` and the
  spinner is absolutely centred over it, so a toolbar never reflows.
- **Selection is a 2px inset accent bar, never a filled row** — a fill collides with hover
  and with the expanded-row fill.
- **Menu separators inset 9px each side; container edges stay full-bleed.** A full-width
  divider reads as a cut through the surface.
- **The hairline beside a selected flush segment is suppressed on both sides** — a divider
  touching a filled segment reads as a seam.
- **Success uses `--accent`, never `--gain`.** Green means money up; borrowing it for
  "saved" makes a confirmation look like a profit.
- **`Unpriced` is an outline badge, not a warning.** A missing price is an absence. Amber
  is reserved for `Stale` and `FX unavailable`, where a figure exists but should not be
  trusted as current.
- **Read-only is not disabled.** Read-only keeps `--fg-secondary` ink and takes a *dashed*
  border so the value still reads as real data; disabled drops to `--fg-disabled` on
  `--bg-subtle` with the inner highlight removed.
- **Icons are hand-authored inline SVG** — 16-unit grid, 1.3-unit stroke so optical weight
  stays constant at 14/16/20px, `fill:none`, round caps and joins. 55 icons. No icon font,
  no library.

## 3. Accessibility floors

- **4.5:1 for text, 3:1 for non-text boundaries.** Measured from hex values with a
  relative-luminance script, never estimated.
- **Focus ring: 2px accent**, `offset:2px` standalone, `offset:-2px` for controls packed
  in a row (table headers, menu items, calendar days), `offset:1px` on input shells, where
  the border simultaneously turns accent.
- **The unavailable em-dash is `tabindex="0"`** with a dotted underline, so "unavailable,
  and why" is reachable by keyboard and not only on hover. This is the house rule made
  operable.
- **`prefers-reduced-motion` collapses every transition to 1ms** and replaces both
  spinners with a static dotted ring beside `aria-busy`.
- **Every surface is checked against both grounds.** Light and dark are equal citizens,
  not a theme and its afterthought.

## 4. Numbers on screen

- `en-IN` grouping throughout: `Rs 1,42,560`, `Rs 58,423.50`.
- Minus is **U+2212**: `−Rs 4,350.00`.
- Compact forms truncate toward zero: `Rs 48.72L`, `+Rs 1.84L`, `Rs 1.61Cr`.
- **Percentile bands are never quoted beyond three significant figures.** Nor are
  projection bands.
- A figure that cannot be computed is an em-dash, never a zero, never a dash of any other
  kind.

## 5. State coverage — required on every surface

No screen is complete without all six, and a review may reject on any one missing:

1. **Loading** — skeletons using `--skel-a` / `--skel-b`, never a spinner over content.
2. **Empty** — says what would appear here and how to put something there.
3. **Error** — names what failed and what the viewer can do.
4. **Unknown** — the em-dash state, distinct from empty and from zero.
5. **Refused** — the computation declined, with its cause named. Distinct from error.
6. **Stale** — a figure exists but should not be trusted as current. Amber.

## 6. Keyboard model

The model below is a target specification. Redo scope remains subject to TASKS.md D3;
destructive command-palette bindings remain subject to D6. Neither is approved by
this reconciliation.

Applies to every table in the product, not only the ledger:

`Up`/`Down` move, `Space` selects, `Ctrl+A` selects all in scope, `E` edits,
`Del` removes, `Ctrl+Z` undoes, `Ctrl+Y` redoes — all behind a text-input guard so typing
in a field never triggers a destructive verb.

**Redo is disabled with a reason, never hidden.** A control that vanishes teaches nothing.

## 7. Destructive confirmation

**Approval clarification (2026-10-24):** this is the recommended pattern. D1 (atomicity)
and D5 (requiring a filter) remain owner decisions in TASKS.md. In particular item 6
below is proposed, not an already-approved policy. The affected build stays gated.

For a filter-scoped bulk removal:

1. Restate the scope as the **literal filter chips**, not a prose summary.
2. Preview the exact count, net amount, date range touched, and the protected rows that
   will stay.
3. Require a typed phrase **carrying the count** — `remove 1240 rows` — so a memorised
   phrase cannot be typed blind at a different scope.
4. `btn-danger-quiet` in a footer bar, far from any primary action, never default-styled.
5. One undo unit, plus a session-persistent banner over the emptied table.
6. **Refused outright on an unfiltered table.**

## 8. Charts

- **Real terms by default**, nominal as a toggle, on every trajectory.
- **A fan chart's outer band is faded and explicitly open-ended.** A crisp edge is read as
  a hard bound.
- **A percentile never appears next to an action, and never without its dispersion** — on
  its own it reads as "rare, therefore an opportunity".
- **Context belongs on a page the viewer navigated to**, not in a notification.
- Five-hue chart ramp, both themes, unchanged from the original research.

## 8a. Comparison — the actual deficit *(added 2026-10-24)*

Measured across all nine mockups: **`percentile` appears zero times.** Not one figure
anywhere in the product is placed against a reference value — no sector percentile, no
peer column, no own-5-year range, no "against your own median".

That, not density, is why the surfaces read ordinary. **The investments holdings table
already carries 16 data columns, 5 header groups, a 90-day sparkline and a column
chooser** — near Tickertape's column count. A 16-column table of bare absolutes still
reads flat, because every number answers *what* and none answers *is that good?*

The pattern to copy, observed on Tickertape's ITC page where it recurs four times, is
**plain text and almost no chart**: `PE 16.64` beside `Sector PE 33.79`; revenue growth
`9.49%` against industry `10.1%`; "Largecap, rank 24"; "MF holder rank 5/281 (+1)". Cheap
to build, and it is the whole difference.

**The dashboard is the sparse screen, not the investment pages.** Its holdings row is
**4 fields** against the investments page's 16, and the whole screen carries ~85 figures.
It is hiding data the product already has. The "ordinary" verdict was given on this
screen.

**Income is the weakest surface of all** — the banking console contains zero occurrences
of `recurring`, `discretionary`, `seasonal`, `cohort`, `median` or `quartile`.

### The countable target

A target that cannot be counted is not a target:

| Measure | Target | Today |
|---|---|---|
| Fields per table row | 16–18, **at least 2 comparative** | 16, **0 comparative** |
| Micro-charts per row | exactly 1 | 1 (investments), 0 (dashboard) |
| Semantically-coloured cells per row | at most 1 | — |
| Drill-down levels | 3, only the third navigating | — |
| Figures on the dashboard | ≥200 | ~85 |
| Saved views | ≥1 | 0 |

### Two additions the contract needs

1. **An unavailable sparkline is a gapped line, never interpolated.** A sparkline has no
   em-dash form, so the house rule needs this spelling-out: a gap is the admission.
2. **A per-instance contrast-exemption procedure.** Faint *bands* are legitimately
   exemptible under the W3C text; **strokes are not**. Any exemption is recorded with
   its measured ratio and the clause relied on.

**Structural model for the Performance screen: Portfolio Visualizer, not Bloomberg** —
13 summary metrics, 31 risk metrics, 22 stacked sections, all plain tables, no
progressive disclosure at all. The current Performance surface has 4 figures.

**Not Sankey as the income headline.** It is a one-period diagram and the question here
is longitudinal. (The circulating "40% cognitive load" figure has no traceable source and
must not be cited.)

## 9. Institution identity — reuse what exists

**Do not design or build a new logo mechanism. One exists, it is good, and the
mockups ignored it.**

- `src/ui/providers.ts` — a registry of **56 Indian banks, brokers, wallets, bullion
  vaults and retirement schemes**, each with `id`, `name`, `shortName`, `aliases`,
  `kind`, a two-colour brand pair, and a `domain`.
- `app/api/logo/[id]/route.ts` — a same-origin logo proxy. One stable CSP-clean URL,
  the upstream fetch cached for 7 days, a curated local asset winning over everything,
  favicons as last resort, byte-size guards against placeholder stubs, and per-upstream
  timeouts. **Misses are cached as hard as hits**, which matters: for a bank no favicon
  service knows, an uncached 404 repeated ~2.8s of lookups on every page draw.
- `src/ui/provider-picker.tsx` — the picker and `ProviderMark`, which resolves a logo
  from a stored institution *name* as well as an id, so an account created before the
  picker existed still gets its mark.

**The rule the code already states, and the design must honour: a logo is an identity
claim, so a near-miss is worse than none.** The proxy returns 404 rather than guessing,
and the client renders a branded badge built from the provider's own two brand colours.
The registry comment records that five hand-traced approximations once *displaced* real
favicons for Axis and HDFC — the app drew its own sketch over the bank's actual mark.
**Never draw an approximation of an institution's logo.**

So, for every surface showing an account, a holding, a platform or an institution:

1. Use `ProviderMark`, requesting `/api/logo/<id>`.
2. On 404, the branded badge — the provider's brand colours with its `shortName`,
   never a generic grey square and never a hand-drawn shape.
3. Size from the control scale like any other element; the mark does not get its own.
4. The badge is an identity, not a status: it never carries gain/loss colour.

## 10. Known gaps

- **No artifact has been inspected visually.** No agent in this session had a browser or
  screenshot tool. Narrow widths, chart label crowding and dark-theme rendering are
  unverified by eye across all artifacts.
- **Banking Console predates the corrected token set** (§1.3).
- **The debt-aggregates navigation placement is inconsistent between artifacts** and is
  unreconciled.
