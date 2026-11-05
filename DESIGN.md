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

### 1.1a Page scales — the Elevation Pass *(D.1.s, 2026-10-24)*

**Status: binding.** These supersede the Institutional Shell's page typography, spacing
and structural border application, and **nothing else**. Component geometry — control
heights, radius binding, the five border strengths — stays with Control Bench and §1.1
above. Source: `_design/elevation-pass/index.html`, the `.stage[data-mode="after"]`
block. Where this table and that block disagree, **the block is right** and this table
is to be corrected.

The owner's verdict was that the UI "looks basic". The diagnosis was not colour and not
density: it was that **thirteen type sizes make nothing look deliberate**, that figures
and labels were set in the same face, and that the large spacing intervals existed in the
scale but were never spent. Each change below is one custom property on one element.

| Scale | Values | Rule |
|---|---|---|
| **Type — six sizes, and only six** | `--fs-hero clamp(40px,7.2vw,56px)` / lh `1.02` / w `500` / ls `−.022em` · `--fs-kpi 22px` / lh `28` / w `500` · `--fs-h1 20px` / lh `26` / ls `−.014em` · `--fs-sec 13px` · `--fs-lab 11px` / ls `.085em` / uppercase / w `500` · `--num-size 12.5px` | A seventh size is a defect, not a judgement call. Tracking tightens as size grows and the label is the only tracked-out step. The label is `--fg-muted`, never full-strength |
| **Figures are mono, everywhere** | `--fig-face: var(--mono)` · `--fig-vn: tabular-nums slashed-zero` | IBM Plex Mono was pinned to 11.5px badges. It now carries **every figure at every size**, hero included. Tabular figures are what make a column scannable; a slashed zero is what stops `0` reading as `O` in an account number |
| **Spacing — 4 / 8 / 16 / 24 / 40** | `--gap-screen 40px` · `--gap-block 16px` · `--pad-panel 20px 24px` · `--pad-panel-h 14px 24px` · `--gap-kpi 0` | The large intervals are the point. 40px between screen regions is what separates them without a rule; a panel's header pads less vertically than its body |
| **Border as three structural ranks** | screen rule → `--border-control` · panel edge → `--border` · internal division → `--border-subtle` | Previously one strength did all three jobs, which is why the page read flat. `--border-control` on the canvas measures **3.21:1 light / 3.78:1 dark** — both clear the 3:1 non-text floor |
| **KPIs are ruled, not boxed** | `--kpi-bd 0` · `--kpi-bg transparent` · `--kpi-r 0` · `--kpi-rule 1px solid var(--border-control)` · `--kpi-pad 14px 20px 2px 0` · `--kpi-cols repeat(auto-fit,minmax(154px,1fr))` | A card around every number is five boxes competing with the one panel that matters. A top rule groups them at a fraction of the visual cost |
| **Hero is unboxed** | `--hero-bd 0` · `--hero-bg transparent` · `--hero-r 0` · `--hero-pad 8px 0 0` · `--hero-tick block` | The largest figure on the screen needs no container to be found |
| **Table row** | `--row-h 34px` · `--cell-pad 7px 12px` | 34px, against the 32px compact row of §1.1. A control dropped into a cell is still `--h-md 32`, so the row absorbs it without reflow |

**No new colour was introduced by this pass.** The four corrections in §1.2 carry through
unmodified. The only new *application* is `--border-control` as a structural rule on the
canvas, which is why its contrast is restated above rather than assumed.

### 1.1b Marker geometry — the only exceptions, and why they are not exceptions *(2026-10-25, answering F.1)*

**Status: binding.** F.1 found four sizes that sit off the §1.1 height scale. Three of
them are not controls at all, and one is a real defect in the artifact. Classifying them
this way closes the question without a `calc()` loophole, which §1.1 would not survive.

**The height scale governs hit targets, not glyphs.** A control height is on the scale
because a control dropped into a 32px table cell must not change the row height, and
because a thing you click must be big enough to click. A mark that is painted *inside* a
hit target is neither: it never sits alone in a cell, it is never the focus ring, and
growing it to 24px would make the control it decorates look wrong. So markers get their
own closed scale rather than a waiver from this one.

| Token | Value | What it is | Hit target |
|---|---|---|---|
| `--mk-sm` | `16` | Checkbox box, radio dot, the chip's dismiss glyph, a segmented control's internal divider inset | The surrounding label row or chip — **never the marker** |
| `--mk-track` | `32 x 18` | The switch track; the knob is `14` inset `2` | The surrounding label row |

Three rules make this closed rather than a loophole, and **F.6 must fail on each**:

1. **The marker scale is an enumerated set of two.** A third marker size is a task, not
   a judgement call at the call site.
2. **A marker token may never be used as a control height, and a height token may never
   be used as a marker.** They are different kinds of measurement that happen to be
   expressed in pixels.
3. **A marker is never focusable and never the accessible name's owner.** If something
   is 16px and *does* take focus, it is a control at an illegal height — fail it. This
   is the rule that stops a shrunken button being relabelled a marker to get past F.6.

**The chip is the real defect: 22px is wrong, and the fix is 24px.** The chip is the hit
target — you click it, it takes focus, it carries a dismiss. There is no reading under
which it is a marker, so it must be on the scale, and `--h-xs 24` is the rank it belongs
to: "a control nested inside another control" is exactly what a chip in a filter bar or a
token in a field is. Radius follows height as always — `<=32px` → `--r-2`, which is what
`_design/control-bench/index.html` `.tok` already sets. **F.1 ships the chip at 24px.**

This is the same class of correction as the five contrast measurements in §1.2: the
artifact carries a value that fails its own rule, found by checking rather than by eye.
`.tok{height:22px}` in Control Bench is now superseded and the artifact is to be refit
(`D.1.b`). Where §1.1 said component geometry stays with Control Bench, **this one value
is the exception, and this section is the authority for it**.

### 1.2 The corrected token set — all five found by measuring

These supersede the original design research. **Any artifact or component not carrying
these five corrections ships a WCAG failure.**

| Token | Was | Now | Why |
|---|---|---|---|
| **`--border-control`** *(new)* | `--border-strong` light `#B9C2CC` **1.80:1**, dark `#343C45` **1.60:1** | light `#808C9A` **3.42:1**, dark `#64707E` **3.54:1** | Form-control boundaries claimed 3:1 and **both themes failed WCAG 1.4.11**. An input's edge was not a boundary. `--border-strong` is retired as a control token and survives only as decorative chrome |
| **`--border` (dark)** | `--n-800 #232A31` → **1.23:1** | `--n-700 #343C45` → **1.60:1** | In a borders-carry-all-elevation system, dark panels had no visible edge at all |
| **`--bg-subtle` (light)** | `#EFF2F5` — `--fg-muted` on it measures **4.49:1** | `#F2F5F8` — **4.61:1** | A hair under AA for every caption on a subtle fill. Lifting the fill was cheaper than darkening every caption |
| **`--fg-disabled`** | light `#8C98A6` **2.93:1**, dark `#49545F` **2.31:1** | light `#7C8896` **3.61:1**, dark `#5C6875` **3.14:1** | WCAG exempts inactive controls, but **contrast is not a state channel**. Disabled is carried by fill, a weakened border, removal of the inner highlight, and `cursor:not-allowed` |
| **`--c-other`** *(added 2026-10-24, D.5)* | light `#8C98A6` — **2.93:1** on `#FFFFFF` | light `#7C8896` — **3.61:1** | The "Other / withheld" slice of every allocation chart failed the 3:1 non-text floor. Dark `#64707E` already passed and is unchanged. Found by measuring a shipped mockup, not by review |

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

**2026-11-04 (D.1.b): the local mirror is refit; the published artifact is not.** The mirror
already carried `--border-control` (3.42/3.21:1 light, 3.54/3.78:1 dark, on surface/canvas)
on every control border. Two residual defects were fixed: six chart marks still drew the
retired, now-undefined `var(--border-strong)` (so they rendered nothing) and now draw
`var(--border-control)`; light `--c6` was the failing `#8C98A6` (2.93:1) and is now
`#7C8896` (3.61:1). `tests/d1b-banking-console.spec.ts` parses the mirror's three token
blocks and asserts every text pair >= 4.5:1 and every control/chart pair >= 3:1; 144
assertions pass. Lowest margins: light `warn` on `bg-subtle` 4.59:1, light `fg-muted` and
`flat` on `bg-subtle` 4.61:1, dark `fg-disabled` on surface 3.14:1. Republishing is an owner
item in `artifacts.md`.

**The Income & Standing artifact still carries the failing `--c-other`.** Its light value
is `#8C98A6` — the 2.93:1 one — while Analytics Depth, published the same day, carries
the corrected `#7C8896`. Income & Standing avoids the failure in practice by drawing its
long-tail fill from `--spark: var(--fg-muted)` (4.96:1 light / 6.61:1 dark) instead, so
nothing on that screen renders at 2.93:1 today. **The token is still wrong and must not be
copied.** `#7C8896` is the binding value; `--spark` is an alias for `--fg-muted` and is
not a sixth colour. Two artifacts published hours apart disagreeing on one hex is exactly
what the conformance check (F.6) exists to make impossible.

**Nothing in this document has been verified by eye.** No agent had a browser, so the
contrast figures here are computed from the hex values — which is the reliable half —
while label crowding at 18 columns, the sticky two-row header occluding data, behaviour at
narrow widths, and dark-theme optical weight are all unchecked. Task D.3 owns this and it
needs a human or a browser-capable agent. **A computed contrast ratio is not a look.**

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

**Owner approval, 2026-10-24.** D3 and D6 are settled and this section is now binding,
not a target. Relayed by Codex in `CONVERSATION.md`; recorded in `MEMORY.md`.

- **D3 — redo scope:** class A (ledger) mutations get **one step** of redo; class B
  (reference data) gets a depth of **20**. The asymmetry is deliberate: an append-only
  ledger correction is a posted financial event, and a deep redo stack over posted events
  invites a user to walk history backwards and forwards until they no longer know which
  state is real. Reference data has no such hazard.
- **D6 — command palette:** **navigation only.** It carries no destructive verb. A fuzzy
  matcher one keystroke away from "remove all" is a way to delete a year of records by
  autocomplete.


Applies to every table in the product, not only the ledger:

`Up`/`Down` move, `Space` selects, `Ctrl+A` selects all in scope, `E` edits,
`Del` removes, `Ctrl+Z` undoes, `Ctrl+Y` redoes — all behind a text-input guard so typing
in a field never triggers a destructive verb.

**Redo is disabled with a reason, never hidden.** A control that vanishes teaches nothing.

### 6.1 Every binding, and what it does when it cannot *(2.8.s — 2026-10-28)*

**Focus model.** A table is one tab stop. Inside it, a **row cursor** (`aria-activedescendant`
on the grid) is distinct from **selection** (checkbox state). Verbs act on the selection when
one exists, otherwise on the cursor row. Every refusal is announced through one shared
`aria-live="polite"` region **and** shown as a toast with the reason; the key never silently
does nothing.

| Key | Legal effect | When illegal | What happens then |
|---|---|---|---|
| `Up` / `Down` | Move the cursor one row | At the first/last row | Stays; no wrap, no sound, no message (not an error) |
| `Home` / `End` | First / last row of the loaded set | — | — |
| `Space` | Toggle selection of the cursor row | Row is class C · a group heading · no cursor yet | Not selectable; announced "System row — not selectable" · "Heading row — not selectable" · "No row is selected" |
| `Shift+Up/Down` | Move the cursor and add every selectable row passed over since the last plain move | At the first/last row · class C or heading rows in the range | Cursor stays at the edge; class C and heading rows are skipped, never selected |
| `Ctrl+A` | Select all **in the current filter scope** | Unfiltered table | Selects the loaded page only, announced "Selected 50 on this page — filter to select more" (§7 item 6) |
| `Esc` | Clear selection; else blur the table | — | — |
| `Enter` | Open the cursor row's detail | No detail view | Nothing; not announced |
| `E` | Edit the cursor row | Class C · reconciled (L10) · multiple selected | Refused with reason: "System data is recalculated, not edited" · "Reconciled to 30 Sep — unreconcile first" · "Edit one row at a time" |
| `Del` | One row: remove with undo toast. Several: opens §7.1 | Class C · any reconciled row in selection | Refused, naming the rows; nothing is removed (D1): "System data is recalculated, not removed: <rows>" · "Reconciled to 30 Sep — unreconcile first" · for several, "Reconciled — unreconcile first: <row> (to 30 Sep), …" |
| `Ctrl+Z` | Undo the newest undoable request (§9e) | Nothing to undo · window closed · refusal | "Nothing to undo" or the §9e refusal text |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo | Nothing to redo · invalidated · class A cursor spent | The §9e refusal text |
| `/` | Focus the table's filter field | No filter field | Nothing |
| `Ctrl+K` | Command palette — **navigation only** (D6) | — | Typing a verb ("delete") finds no destructive action, by construction. A shell binding: the table never consumes it |
| `?` | Open the binding sheet for this table | — | — |
| `E` / `Del` with no target | — | Empty table, or the cursor is on a heading and nothing is selected | Refused: "No row is selected" (a destructive key is never silent) |

**The text-input guard.** While focus is in `input`, `textarea`, `select`,
`[contenteditable]` or the command palette, **no single-letter key and no `Del` reaches a
table**, and `Ctrl+Z`/`Ctrl+Y` belong to the field (text undo), not to the ledger. The guard
is checked on the event target at keydown, so a field inside a table row is guarded too.
`Ctrl+A` inside a field selects the field's text.
*(Made exact 2026-10-30, 2.8.b.)* "A field" is: `textarea`; `select`; any
`[contenteditable]`; anything inside `[cmdk-root]` or `[data-command-palette]`; and `input`
of every type **except** `checkbox`, `radio`, `button`, `submit`, `reset`, `range`, `color`,
`file` and `image` — a selection checkbox is not a place anyone types. Inside a field the
table consumes **no key at all**, not only the destructive ones, and a keydown with
`isComposing` set (an IME mid-word) is ignored everywhere.

**Modifiers off the list do nothing.** No binding uses `Alt`, which Indian-language input
methods claim. Bindings are matched by `event.key`, not `event.code`, so they follow the
owner's keyboard layout. `Meta` (Cmd) is read as `Ctrl`. `E` matches with Caps Lock on;
`Shift+E` is not a binding. `Backspace` is not `Del`.

**Undo/redo text comes from the server, verbatim.** The table receives undo and redo as
`available`, or unavailable **with a reason** (`RedoBatch.state` → `RedoUnavailableError`
message; `UndoRefusedError` / `UNDO_MESSAGES` for undo). The key refuses with exactly that
text, so the toast, the live region and the disabled button's reason never disagree. A blank
reason falls back to "Nothing to undo" / "Nothing to redo".

**Implementation contract (2.8.b).** `components/ui/table-keyboard.ts` is the pure model:
`isTextEntryTarget`, `dispatchTableKey(key, inField, state)` → pass · command · refuse, and
`applyTableCommand`. `components/ui/use-table-keyboard.ts` applies it to one grid and returns
`gridProps`, `rowProps`, `liveRegionProps`; verbs that leave the table (`onEdit`, `onRemove`
with `"single"`/`"bulk"`, `onUndo`, `onRedo`, `onOpen`, `onFocusFilter`, `onHelp`) and every
refusal (`onRefuse`, for the toast) go to the caller. Plan: `_architecture/requirements/keyboard-model.md`.

**Discoverability:** `?` (outside a field) opens a sheet listing this table; each disabled
verb button's reason text names its key, e.g. "Undo (Ctrl+Z) — closed on 27 Nov".

**KPI explanations are keyboard-reachable (D.6, applying §3).** A KPI's explanation is
`<Kpi info="…">`, which renders `InfoButton` (`components/ui/info-button.tsx`): a 24px
(`--h-xs`) `<button>` named "About <label>", the 16px glyph inside it an `aria-hidden` marker
(§1.1b). `Tab` reaches it; the explanation is its `aria-describedby` description, so it is
heard on focus; `Enter`/`Space` opens a Radix popover; `Esc` closes it and focus returns to
the button. Never a `title=` on an `<i>`.

## 7. Destructive confirmation

**Owner approval, 2026-10-24.** D1 and D5 are settled and every item below is binding,
item 6 included. Relayed by Codex in `CONVERSATION.md`; recorded in `MEMORY.md`.

- **D1 — atomicity:** a filter-scoped bulk mutation is **atomic**. It applies in full or
  not at all, under one `audit_events.request_id`, and one undo reverses the whole batch.
  A partial application leaves the user holding a ledger they did not author and cannot
  describe. Where a protected row (an L10 reconciled posting) falls inside the scope, the
  **batch is refused and the protected rows are named** — it is not silently applied to
  the remainder, which would be a partial application wearing a success message.
- **D5 — the typed phrase** carries the count, as item 3 states.
- **Undo window: 30 days.** After that the batch is settled and reversal is a new,
  explicitly authored correcting transaction — which is what an append-only ledger means.
- **A class-B restatement is confirmed separately** from the mutation that triggers it.
  Changing a reference row can silently restate figures the user has already read and
  acted on, so that restatement is its own acknowledgement, not a side effect.


For a filter-scoped bulk removal:

1. Restate the scope as the **literal filter chips**, not a prose summary.
2. Preview the exact count, net amount and date range touched. **If any protected row is
   in scope, there is no confirmation to give: the dialog shows the refusal and names those
   rows** (D1). *(Corrected 2026-10-28, 2.6.s: this item used to say the protected rows
   "will stay", which is the partial application D1 forbids.)*
3. Require a typed phrase **carrying the count** — `remove 1240 rows` — so a memorised
   phrase cannot be typed blind at a different scope.
4. `btn-danger-quiet` in a footer bar, far from any primary action, never default-styled.
5. One undo unit, plus a session-persistent banner over the emptied table.
6. **Refused outright on an unfiltered table.**

### 7.1 The remove-all dialog, in full *(2.6.s — 2026-10-28)*

A modal dialog (F.3), opened from the table's bulk bar. Top to bottom:

| Part | Content |
|---|---|
| Title | "Remove 1,240 transactions" — the count is in the title too |
| Scope | The active filter chips, **read-only copies** of the ones above the table. No chip can be removed here; changing scope means closing and refiltering, so the count can never drift inside the dialog |
| Effect | Three figures: rows, net amount (signed, U+2212), date range. Plus "Balances change in 4 accounts" listing them |
| Undo note | "One undo restores all 1,240, for 30 days (until 27 Nov)" |
| Phrase | Label "Type **remove 1240 rows** to confirm"; a text input |
| Footer | *Cancel* (default focus) on the left; `btn-danger-quiet` *Remove 1,240 rows* far right |

**The phrase:** the count is written without grouping (`1240`, not `1,240`) so it can be
typed; matching is exact after trimming and ignores case. The danger button stays disabled
until it matches, with "Type the phrase to enable" beneath it. Nothing is accepted on a
partial match, and Enter in the field submits only when matched.

**Refusals replace the form, they don't sit under it:**

| Cause | Dialog body | Only action |
|---|---|---|
| No filter (item 6) | "Remove-all needs a filter. Narrow the table first, so the scope is something you chose" | *Close* |
| Protected rows in scope (D1) | "3 of these rows are in reconciled statements and cannot be removed. Nothing will be removed." + the three rows, each linked | *Close*; *Filter them out* adds an exclusion chip to the table and closes |
| Count changed since opening | "The table changed while this was open: 1,240 is now 1,238. Review again." | *Review again* reopens with the new count and a cleared phrase |

**After removal:** the toast says "Removed 1,240 transactions — Undo" and the banner from
item 5 sits over the emptied table until undone or dismissed; it survives reload for the
session. **Keyboard:** `Del` with rows selected opens this dialog; `Esc` cancels; focus
returns to the bulk bar. `Del` inside the phrase field types nothing destructive (§6 guard).

**Contract and build notes *(2.5 / 2.6.b — 2026-10-30)*.** The dialog posts the *filter*,
the count it showed and the phrase — never an id list. The server re-resolves the scope
at confirm time, refuses an unfiltered scope (item 6, D5 approved 2026-10-24), refuses a
drifted count, and removes through one atomic `RemoveTransactions` batch whose `requestId`
is the toast's and banner's Undo. One confirmation removes at most 5,000 rows; above that
the dialog asks the user to narrow the filter. Built as `components/ui/confirm-removal.tsx`
(Radix focus trap, Cancel initial focus, labelled phrase input, refusal bodies replace the
form). Known gaps: there is no `btn-danger-quiet` token class yet, so the button uses the
`destructive` Button variant; the register has no row selection, so `Del` is not bound —
the dialog opens from "Remove all matching…" in the bulk bar; reconciled rows are named
by id in the refusal, not yet as links.

## 8. Charts

- **Real terms by default**, nominal as a toggle, on every trajectory.
- **A fan chart's outer band is faded and explicitly open-ended.** A crisp edge is read as
  a hard bound.
- **A percentile never appears next to an action, and never without its dispersion** — on
  its own it reads as "rare, therefore an opportunity".
- **Context belongs on a page the viewer navigated to**, not in a notification.
- Five-hue chart ramp, both themes, unchanged from the original research.

### 8.1 Net worth against age *(4.2.s — 2026-10-28)*

A `ChartPanel` (§9b) on `/dashboard`, from `net_worth_snapshots`, one point per month.

**Axes.** X is **age in years** when a date of birth is recorded (4.1), labelled at whole
years. With no date of birth the axis **degrades to calendar years**, it does not refuse:
the panel's description says "Add your date of birth to see this against age" with a link.
Y is rupees, compact form (§4), starting at zero unless any point is negative, in which
case zero is drawn as a rule.

**Real by default** (§8). The toggle is a two-option segmented control, *Real* | *Nominal*,
and the headline under the title names the choice: "In today's rupees (CPI Urban)". Nominal
says "In rupees of each month". The **Urban** series is used, and named, because the owner
is urban; this is a stated assumption, editable in Settings, not a hidden one.

**The January 2026 CPI base break.** MoSPI rebased CPI from 2012=100 to 2024=100 with new
data from January 2026 and states the two series are not directly comparable. A deflator
chained naively across December 2025 → January 2026 is **wrong and forbidden**. The real line
is drawn one of two ways, decided by data, not by taste:

| Condition | Real line | Mark at Jan 2026 |
|---|---|---|
| An official MoSPI linking factor is recorded, with its source URL and date | One continuous line, pre-break values carried through the factor | A dashed vertical rule labelled "CPI spliced — MoSPI linking factor 1.xxxx" with the source in the panel description |
| No official factor recorded *(today: it is an open research item)* | **Two segments with a gap.** Each is in its own base's rupees; the left labelled "2012-base rupees", the right "2024-base rupees" | The same dashed rule, labelled "CPI rebased — not comparable across this line" |

**No factor is ever estimated in the app.** The nominal line is always continuous. The
break mark is drawn in both modes so the viewer is never surprised by a jump on toggling.

**Milestones — expense multiples only** (product §5, task 4.3). Horizontal rules at **33×
annual expenses**, labelled "33× expenses — independence marker (3.0% India safe withdrawal
rate, Saraogi 2022)". Also 10× and 20× as quieter intermediate rules. **Never 25×, never an
income multiple.** Annual expenses are trailing-12-month, real; with under 12 months of
expense history the rules are not drawn and the description says why (a refused overlay,
not a refused chart).

**Points.** Hover/focus shows month, age, the value in the active mode, and in Real mode the
nominal beside it. A month with no snapshot is a gap in the line, never interpolated, and
its focus stop reads "No snapshot for Mar 2025".

**Summary (required by `ChartPanel`):** "Net worth from ₹X at age 27 to ₹Y at 31, in today's
rupees; crossed 10× expenses at 30. CPI rebased in Jan 2026 and is not joined." — generated
from the data, never static text.

**States:** loading skeleton; **empty** under two snapshots ("Two months of history are
needed to draw a line"); error with retry; **unknown** when the latest month's net worth is
unknown (em-dash headline, line still drawn to the last known month); **refused** for the
real line alone if a needed CPI month is missing, with nominal still offered; **stale** when
the newest snapshot is over 45 days old.

#### 8.1 addendum — bound to the shipped code *(4.2.b, 2026-10-30)*

Model `app/(root)/dashboard/net-worth-age-model.ts` (pure, spec `tests/net-worth-age.spec.ts`);
view `net-worth-age-view.tsx`; loader `net-worth-age-section.tsx`, streamed in a `Suspense`
boundary on `/dashboard` so loading and error belong to this panel, not the page. Where the
spec above left a choice open, this is what was decided:

- **No CPI series is stored today.** Real is therefore refused with its reason ("no CPI Urban
  series is recorded, and the app never assumes an inflation rate"), the *Real* segment is
  shown disabled with that reason, and the chart is nominal. No rate is ever substituted.
- **"Today's rupees" means the latest published CPI month**, named in the headline ("In Sep
  2026 rupees (CPI Urban)"). Months after it — CPI is published with a lag — are carried at
  its prices, up to 2 months; beyond that real is refused ("the series ends at …").
- **Linking factor direction:** `2024-equivalent index = 2012-base index × factor`, stored
  with its source URL and recorded date. Without a factor, each segment is deflated to its
  own base's latest month; Dec 2025 and earlier are "2012-base rupees".
- **Milestones in real mode** need the trailing 12 months of expenses in one kind of rupee;
  when that window straddles the unjoined break the rules are refused, with the reason.
  A rule more than 1.5× above the highest value is not drawn (it would flatten the line) and
  is listed instead: "Above the top of the chart: 33× expenses (₹…)". The 33× citation is
  shown under the chart whenever the 33× rule is drawn or listed.
- **Unknown keeps the line.** `ChartPanel`'s `unknown` state replaces the whole figure, which
  would hide the history; the panel stays `ready`/`stale` and the headline is the em-dash with
  its reason.
- **History starts at the first month anything was recorded**, not at the window's leading
  zero months; the window is the last 120 months. The toggle is two links
  (`?basis=real|nominal`), so the page stays a server component; *Real* is the default.
- Every month is a focus stop with its value in the accessible name (native `title` on
  hover), and a "Show as a table" disclosure carries the same rows.

### 8.2 The projection fan *(5.3.s — 2026-10-28)*

A `ChartPanel` on `/projection`: corpus against age, **real rupees as the headline**,
nominal as the §8 toggle. Engine: stationary block bootstrap (5.1); the chart draws only
what the path set contains.

**Bands, and what they are called.** Three nested bands around a median line, from the
path set's percentiles: 25–75 (`--c1` at 32% opacity), 10–90 (16%), and the **outer
band, 5–95, faded to transparent at its outer edge** with a linear gradient: no stroke, no
crisp boundary, because a sharp edge is read as a hard bound (BoE 1998). Labels on the
right margin say **"half of scenarios"**, **"8 in 10"**, **"9 in 10 — and beyond"**. The
words *probability*, *likely*, *chance*, *confidence* and *%* **do not appear anywhere on
the screen**: a test greps the rendered copy for them.

**The headline is a count, never a probability:** "In **63 of 100** scenarios replayed from
Indian market history, the corpus reached your target by 60." *(Wording corrected 2026-10-30, owner-approved: paths are resampled from history, not distinct stretches.)* The denominator is the real number
of paths run. Beneath it, always: "These are past stretches replayed, not a forecast."
Figures are compact and **at most three significant figures** (§4).

**Target.** A horizontal rule at the target corpus (real), labelled with its basis
("33× expenses at 60"). The count above is the paths that cross it by the target age.

**Inflation note, in the description, not a tooltip:** "At 6% inflation over 30 years,
₹5 crore then is about ₹87 lakh today." Medical expenses inflate as their own stream; the
assumptions panel (5.0) says so and links to its rate's source.

**SIP suspension (5.2).** The control offers *Suspend for N years, then resume* and
*Stop permanently*. On apply, **two fans overlay**: the original in `--c1`, the suspended
in `--c3`, both faded. **The highlighted region is the gap between the two lower bands
(the 10th percentiles), not between the medians**, filled with `--warn-bg` and labelled
"Bad stretches lose most". The cost is stated twice, in rupees and **in years**: "Reaching
the same corpus takes 3 years longer in the bad stretches, 1 year at the median."

**Summary (required):** generated from the paths, e.g. "Real corpus at 60: middle half of
scenarios between ₹1.8 Cr and ₹3.1 Cr; 63 of 100 reach the ₹2.4 Cr target."

**States:** loading (the engine is slow; skeleton plus "Replaying 100 stretches…");
**refused** is the main non-happy state and is common: under 12 months of history, thin
categorisation, an unresolved asset mix, or an unverified required assumption (5.5) each
refuse **by name**, with a link to fix it, and **never draw a fan with a default substituted**;
empty (no investments recorded); error; unknown (current corpus unknown → refused, naming
it); stale (assumptions edited since the last run → amber, *Re-run*).

**Build notes *(5.3.b — 2026-10-30)*.** The view model is `app/(root)/projection/projection-model.ts`;
the screen is pure SVG (`projection-view.tsx`). The outer band is a vertical
`linearGradient` whose stops reach `stop-opacity: 0` at both edges and the path has
`stroke: none`; the 10–90 and 25–75 bands are `--c1` at 16% / 32% fill opacity (CSS only,
never in copy). Refusal reasons are listed **all at once** in a warning banner above the
panel: `projectionGate`'s reasons when the gate inputs are measured, and otherwise the
assumption set's own `blockers()` plus each missing input named — unsaved assumptions,
unmeasured history/coverage/asset mix, unknown current corpus, no returns series, no
target. The copy test (`tests/projection-screen.spec.ts`) greps every rendered string for
*probability*, *likelihood*, *chance* and any "%" beside them, and the ready state for any
"%" at all. *Today the page always refuses*: assumption persistence, the gate
measurements, the Indian returns series and the target are not yet stored (follow-up).

### 8.3 The Tier 2 board — `/signals` *(6.3.s — 2026-10-28)*

**In-app only, never pushed** (product §7). A page the owner navigates to, so context lives
here and nowhere else (§8). It describes; it never suggests. Four panels, in this order.

**1. Drawdown from peak.** Per index the owner holds against (Nifty 50 first): current
drawdown, e.g. "−8.4% from the high of 14 Sep", then its **historical percentile with the
dispersion of what followed, always together**:

> Deeper than 71% of days since 2000. After drawdowns this deep, the next 12 months ranged
> from **−22% to +41%**; the middle half from +2% to +19%.

Drawn as a horizontal strip plot of those subsequent 12-month outcomes with the middle half
shaded. **The percentile never renders without that strip beside it**: they are one
component, and the component refuses (§5) if the dispersion cannot be computed. No median
outcome is emphasised; the range is the message.

**2. Macro levels.** A table of levels and their percentile against their own history:
INR/USD, gold (INR), crude, US 10-year, FII/DII cumulative flows. Columns: Series · Level ·
As of · Percentile (own history, since a stated year) · Source. **No interpretation column,
no colour by value, no arrows, no "high/low" words.** A percentile here is plain ink.
Sources are keyless and named (FRED, EIA, Frankfurter, AMFI); a series without a keyless
source is **absent, not approximated**, and the page lists what is deliberately missing.
India 10-year G-Sec and monthly CPI are in that list (no keyless source).

**3. FII/DII flows.** Daily net figures for the last 30 sessions as bars, signed, with the
cumulative month figure. Labelled as flows, not as sentiment.

**4. Tax position (owner's own state).** The tax-lot ledger summary and realised LTCG this FY
against the **₹1.25 lakh** exemption: "₹84,200 used of ₹1,25,000". Fact, no "harvest now".

**Rules that bind the whole page:**
- **No percentile appears next to an action.** There are no buttons on this page that buy,
  sell, rebalance or open an order screen, and no link from a percentile to one.
- **No expected return, express or implied** (SEBI 2024 finfluencer amendment). Copy is
  past-tense and historical: "after", "ranged", "since".
- **No holdings named against a macro figure.** The macro panel names no security.
- Every panel shows its **source and as-of time**; a source failure makes that panel **stale**
  (amber, last good value kept and dated), never blank, never silently old. The page header
  counts failing sources and links to the Tier 1 data-source alert.

**States** per panel: loading; empty (no index held → drawdown panel says so, others still
render); error; unknown (em-dash level when a series has no observation); refused (drawdown
dispersion under 10 comparable episodes: "Too few past drawdowns this deep to show what
followed"); stale (above).

**Build notes *(6.3.b — 2026-10-30)*.** Read: `src/app/signals.usecases.ts` (`ViewSignals`);
view model `app/(root)/signals/signals-model.ts`; screen `signals-view.tsx`; plan
`_architecture/requirements/signals-board.md`. Additions and bindings to the four panels above:
- **Two owner-state panels lead, under "Your own state":** *Alerts* (the five Tier 1 rules of
  `src/domain/alerts.ts`, composed unchanged) and *Allocation against bands* (`bandStanding`,
  6.2). Then *Tax position*; then "Market context": drawdown, macro, FII/DII.
- **Each alert rule shows one of three outcomes**: *Stated* (the rule's own text, verbatim),
  *Nothing to state* (evaluated, a plain fact line), or *Not evaluated* with the missing input
  named. An unknown input is never shown as "all clear". Each rule has the anchor
  `#rule-<KIND>`; the header's "Data-source alert" link goes to `#rule-SOURCE_FAILURE`.
  Windows: 30 days for the term boundary and the unused exemption, stated in the copy.
- **Allocation:** sleeve · actual · target · deviation (signed, `pp`) · band (`±pp`) · status
  ("Inside band" / "Outside band"). The cash-flow route is the one sentence of arithmetic
  under it: "New money of ₹X into <sleeve> brings it to its T% target without realising any
  gain." No button, no link, no sale is ever stated. 5/25 or narrower bands → refused by name.
- **Percentile, bound (supersedes "plain ink" above):** a macro percentile renders only with
  the series' own range in the same cell — "Percentile 88 of readings since 2000; own range
  44.90 to 88.40". The drawdown percentile and what followed are one sentence and one
  `<figure>` with the strip; the type admits no percentile without both.
- **Copy test:** every rendered string and `aria-label` is checked against
  `RECOMMENDATION_WORDS` (buy, sell, should, consider, recommend, suggest, switch, exit,
  harvest, book, accumulate, rebalance, will, expect, opportunity, forecast); the macro panel
  against `INTERPRETATION_WORDS` (high/low and kin), arrows and tone attributes. The page holds
  no `<button>`; its only link is the in-page anchor.
- **Today, unwired inputs read as unknown / not evaluated by name:** per-lot unrealised gains,
  concentration threshold, runway and its target, target allocation and band, the 6.4 fetch
  log, index history, every macro series and FII/DII. The tax position needs the year's stored
  tax settings (no assumed slab); the exemption limit comes from the regime in force.

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
5. *(D.4, 2026-11-03)* **A holding shows its platform's mark, never the instrument's.**
   Instruments are not in the registry, and the resolver matches loosely, so "HDFC
   Corporate Bond Fund" would come back as HDFC Bank. That is the near-miss this section
   forbids. Resolve a mark only from a stored institution or platform name, through
   `InstitutionMark`, and place it beside that name.

## 9a. The coverage gap notice *(0.4.s, 2026-10-25)*

**The problem this states.** An account whose statements start mid-life shows a balance
that is wrong by an exact, knowable amount. The owner's real case: the ledger reads
₹10,596.08 against a true ₹1,00,905.39, because Nov 2023 → Dec 2025 was never imported.
**The import did not fail. The period was never supplied.** A warning exists at import
time and is correct, but it is shown once, to someone importing a file — not to someone
reading the account three months later, who sees only a wrong number.

**The standing decision this implements: we never post a balance to close a gap.** A
plug posting would make the account add up and make the ledger fiction — two years of
unknown transactions booked as one lump, distorting every income, spending and savings
figure for the missing window, and hiding the gap the reader most needs to see. Domain
model: `CoverageGap` and `coverageGap()` in `src/domain/banking.ts`.

**This does not forbid a new account's opening balance** *(clarified 2026-10-26, answering
Codex)*. When an account has **no postings at all**, `PostImportBatch` books the
statement's printed opening against Opening Balances equity. That is not a plug: nothing
in the ledger contradicts it, it is the bank's own stated figure, and it is ordinary
opening-balance accounting. Without it every first import would show a wrong balance. The
line is drawn by whether the ledger already holds postings — **an empty ledger takes the
statement's opening; a non-empty one never receives a balancing entry.**

### What is shown

A persistent notice directly **above the balance**, not in a toast and not dismissible.
The figure it qualifies must never be readable without it. Contents, in this order:

1. **The named period.** `No statements between 2 Nov 2023 and 6 Dec 2025.` The gap is
   the finding; the rupee difference is its size.
2. **The arithmetic, stated as three right-aligned rows**, never a sentence:

   | | |
   |---|---|
   | Statement opened at | `₹90,488.03` |
   | Ledger held | `₹178.72` |
   | **Difference** | **`₹90,309.31`** |

   Three figures and a subtraction, which the reader can check. A prose paragraph
   containing the same three numbers cannot be checked at a glance, and this is a figure
   someone will act on.
3. **What it means for the balance shown**, in one sentence: the account is understated
   by the difference until the missing statements are imported.
4. **The action**, as the notice's only button: import the missing period.

### The rules it is bound by

- **The sign is information.** A positive difference understates the balance, a negative
  one overstates it — the missing period was net spending. Both are shown with their own
  wording. **Never `Math.abs`**, and the minus is U+2212 (§4).
- **The balance itself is still shown, and is not an em-dash.** It is a measured fact
  about an incomplete ledger, not an unknown. The notice is what makes it honest. This is
  the one case where §3.1's em-dash rule does **not** apply, and the distinction is
  deliberate: a figure we cannot compute is an em-dash; a figure we computed correctly
  from incomplete input is shown with its incompleteness stated.
- **`coveredTo: null` is worded differently.** An account with no earlier postings at all
  is a new account, not a gap: *"This is the first statement for this account. Nothing
  before 6 Dec 2025 is recorded."* Calling that a gap would accuse the user of losing
  records they never had. Its opening balance is booked as above, so the balance is right
  and **no difference row is shown** — the line states where history starts, nothing else.
- **Known hole — an overdrawn first statement.** The import books an opening only when it
  is *positive*. A new account whose first statement opens overdrawn gets no opening entry,
  so its balance is wrong and nothing says so. Raised as its own task; until it lands, that
  case must render the full gap notice with its difference, not the quiet new-account line.
- **No gap, no notice.** When the statement's opening matches the ledger, `coverageGap()`
  returns null and nothing renders. A banner that appears when all is well is a banner
  nobody reads, and it would appear on every healthy account in the product.
- **It survives a reload and it is not dismissible.** The gap is a property of the
  ledger, not of the session. It disappears when the data arrives, never because someone
  clicked.

### States

| State | Notice |
|---|---|
| Statement opening = ledger | Nothing rendered |
| Opening > ledger | Gap stated; balance **understated** by the difference |
| Opening < ledger | Gap stated; balance **overstated** by the difference |
| No prior postings | New-account wording; no difference row |
| No row carries a running balance | **No notice.** `impliedOpeningBalance()` returns null and a gap cannot be claimed — the statement format simply does not print one |

The last row is the one to get right: not printing a running balance is not evidence of a
gap, and inferring one would raise a false alarm on every bank whose format omits it.

## 9b. Page composition — the F.7 shell contracts *(2026-10-26, answering Codex)*

**Status: binding.** F.7 says no screen carries its own styling, so the page structure
every screen shares has to exist in the library first. These are the shells, each
transcribed from the Elevation Pass `.stage[data-mode="after"]` markup and §1.1a tokens.
Nothing here is new design; it is the existing design given a component boundary.
**Codex implements; where this table and the Elevation source disagree, the source is
right and this table is corrected.**

| Shell | Elevation source | Contract |
|---|---|---|
| `Page` | `.screen` | Flex column, `gap: var(--gap-screen)`, `padding-top: var(--gap-screen)`. The only child of a route's content area. Takes `children`, nothing else. |
| `Masthead` | `.mast`, `.mast-main`, `.mast-side`, `.hero-fig` | `title` (renders the page's one `h1`), optional `hero` figure, optional `side` slot. **The hero is unboxed** (§1.1a): no border, no panel. A hero that is unknown renders the em-dash with its reason (§3), never `₹0`. |
| `KpiStrip` / `Kpi` | `.kpis`, `.kpi` | Grid `var(--kpi-cols)`, `gap: var(--gap-kpi)`. **Ruled, not boxed**: `--kpi-rule` between cells, `--kpi-bd 0`. `Kpi` takes `label`, `value`, optional `detail`. `value` is a formatted figure from `src/core/format.ts` or the unknown cell from F.2 — never a raw string. |
| `Section` | `.sechead`, `.sechead .rule` | `heading` (an `h2`), optional `actions`. The 1px `--border-subtle` rule fills the space between them. |
| `Panel` | `.panel`, `.panel-h`, `.panel-b` | `title`, optional `description` (max 74ch), optional `actions`, `children`. Radius `--r-4` (§1.1). A `flush` variant drops `.panel-b` padding **for a table only**, because the table rows supply their own `--cell-pad`. |
| `Columns` | `.two` | Two equal columns, **`gap: 32px`** (Elevation After overrides `.two` to 32px; corrected 2026-10-28, Codex found it); one column below the phone breakpoint. Two only. A third column is a design question, not a prop. |
| `ChartPanel` | `.panel` + §8 | A `Panel` whose body is a chart. **Requires `summary`**: a text statement of what the chart shows, rendered for assistive technology. Covers every §5 state itself, so a chart cannot ship with only its happy path. |

**Figures and the unknown — the API behind "never a raw string"** *(2026-10-28, answering Codex)*.
A prop typed `string` cannot tell a formatted figure from any other text, so the rule needs a type:

- **`Figure`** — `string & { readonly [figure]: true }`, exported from `src/core/format.ts`. Every
  formatter there (`rupee`, `compact`, `percentage`, `signed`, and any added later) returns
  `Figure`, not `string`. A brand has no runtime cost; the existing callers that treat the
  result as a string still compile. Nothing outside `format.ts` may construct one.
- **`Unknown`** — a value object `{ kind: "unknown"; reason: string }` with a non-empty reason,
  made by `unknown(reason)` in the same file. It is what a domain figure that cannot be
  computed (§3) becomes on its way to the screen.
- **`FigureValue = Figure | Unknown`** is the type of `Masthead.hero`, `Kpi.value`, and every
  other shell prop that shows a number.
- **`UnknownFigure`** — an inline component (`<span>`) rendering the em-dash with its reason
  attached for assistive technology, exactly as `UnknownCell` does. **`UnknownCell` becomes
  `<td>` around `UnknownFigure`**, so there is one em-dash treatment, not two. A shell given
  `Unknown` renders `UnknownFigure`; given `Figure`, it renders the string. One branch, at
  the leaf, on a value the type system has already split.

**Two additions found in QA of the shell library** *(2026-10-28)*:

- **The currency glyph and the scale unit are smaller than the digits, and muted**
  (`--fg-muted`, weight 400, everywhere). Sizes differ by context, exactly as Elevation After
  lines 166–202 *(corrected 2026-10-28; Codex caught that I had written "alike")*: **hero**
  `₹` `.46em` + `.1em` right margin, unit `.40em`, `.06em` tracking, `.12em` left margin;
  **KPI** `₹` `.6em`, unit `.56em`, `.04em` tracking, `.1em` left margin. Side figures have
  no size override and take the muting only. A flat `Figure`
  string cannot carry that, so `format.ts` also exports **`figureParts(figure)`** returning
  `{ sign, currency, amount, unit }` (each a string, possibly empty), and the shells' one
  figure leaf renders `currency` and `unit` in those two spans. The parts must rejoin to the
  exact `Figure` string; a test asserts it for every formatter.
- **`MastFigure`** — the `.side-i` item in the masthead's side slot: `label` plus
  `value: FigureValue`, figure at 16px / 22px in `--fig-face` with `--fw-kpi`, 3px gap.
  Without it every screen hand-styles its side figures, which F.7 forbids.

**`NativeSelect`, alongside F.1's select.** A real `<select>` with `name`, `form`,
`required` and `defaultValue` passed straight through, styled from the same control
tokens (`--h-md`, `--r-2`, `--border-control`) and **no client JavaScript**. It is for
forms posted to server actions, where the field must post its value without hydration.
F.1's custom select stays for client-side interaction. One rule decides between them: if
the value only matters when the form is submitted, it is a `NativeSelect`.

### Fonts — the app is not running the designed typefaces

**`app/layout.tsx` loads Geist and Geist Mono.** Every artifact, and every measurement in
§1.1a, assumes **Inter** and **IBM Plex Mono**. F.7's scope extends to `app/layout.tsx`
for this, and only this:

- `Inter` from `next/font/google`, `subsets: ['latin']`. A variable font, so no weight list.
- `IBM_Plex_Mono` from `next/font/google`, `subsets: ['latin']`, `weight: ['400', '500']`.
  Not a variable font, so the weights are required. Those two are the only ones any
  artifact uses.
- Each exposes a CSS `variable`. `--sans` and `--mono` in `app/globals.css` put that
  variable first and keep their existing fallback stacks after it.
- `next/font` self-hosts at build time, so **no request reaches Google from a user's
  browser**. That keeps it inside the no-third-party-calls rule (`RULES.md` §4.1).

### Theme — the light theme is currently unreachable

**`<html className="dark">` is hardcoded in `app/layout.tsx`.** `globals.css` gives `.dark`
the dark tokens unconditionally, so every user gets dark whatever their OS asks for, and
every light-theme contrast measurement in §1.2 describes a theme no one can see.

- **Remove the hardcoded class.** The tokens already follow `prefers-color-scheme`, with
  `data-theme="light"` / `"dark"` on `<html>` as the explicit override.
- A visible theme switch writes `data-theme`, and is its own task. Not part of F.7.
- **This is a visible change for the owner**, whose app has always been dark. The default
  becomes their OS setting. Recorded here so it is a decision, not a side effect.

## 9c. Debt navigation — reconciled *(2026-10-27, D.2)*

**Status: binding.** Three artifacts placed debt three ways. This settles it by adopting
the one that was argued for: the decision log on the **Assets, Debt & Platforms** "Debt
overview" screen (retire `/liabilities`, 21 Oct 2026). The other two are corrected to it.

| Artifact | What it showed | Verdict |
|---|---|---|
| Assets, Debt & Platforms | Debt group (Cards, Loans, Payoff) with a figures header; `/liabilities` retired | **Adopted** |
| Institutional Shell | Debt group = Cards, Loans; Deposits under "Savings & assets"; no figures header | Correct grouping; **gains the header** |
| Public Surfaces · Navigation IA | "Debt & commitments — what do I owe?" holding Cards, Loans, **Deposits, Assets** | **Defect.** A deposit and a property are owned, not owed. The group answers its own question wrongly |

**The placement:**

- **Sidebar group "Debt"** holds exactly **Cards** and **Loans**. Payoff is a tab of
  `/loans`, not a sidebar item. Deposits and Assets go to the savings/assets group;
  Platforms stays under Investments (Shell and Public Surfaces agree; the Assets, Debt &
  Platforms rail is superseded on that one point).
- **The Debt group header carries three figures**, visible on every screen in the group:
  **Total outstanding** (cards + loans), **Blended rate** (loans only, balance-weighted; cards
  store no rate and are never averaged in), **Monthly outgo** (instalments + card minimums).
  The header stays text, not a link: a group has no page of its own (Public Surfaces,
  breadcrumbs). An unknown figure is the em-dash with its reason (§3), never `₹0`.
- **`/dashboard` tile row:** Total outstanding (the existing Liabilities tile) and **Debt to
  assets**, beside Liquid.
- **`/loans` KPI row:** **Debt-free date**, at current instalments.
- **`/liabilities` is retired and must permanently redirect (308, Next.js `permanent: true`; amended 2026-11-04 from 301) to `/loans`**, never 404: the live app still
  ships it (`app/(root)/liabilities/`, an empty placeholder), and bookmarks want debt.
- **Narrow widths:** when the sidebar collapses, the header figures are not repeated in the
  mobile bar. The dashboard tile row is where they are reachable there.

**Where it is applied** *(2026-11-03)*: the `_design/` mirrors of all three artifacts now
show this placement, and the published artifacts await republishing (see `artifacts.md`).
The live sidebar, `src/ui/nav.ts`, still has one flat Wealth group with Cards, Loans and
Liabilities in it. That is an open implementation task, not a second placement.

**Amendment (2026-11-04, D.2 — header figures, authoritative over all mirrors and artifacts):**
- *Placement is unchanged:* the three figures live in the sidebar Debt group header only (plus
  Total outstanding on `/dashboard`). The Assets, Debt & Platforms "Debt overview" tile row is a
  design-time illustration of the same figures, not a second placement.
- *Blended rate:* loans only, weighted by **booked** outstanding (journal), from each loan's stored
  nominal annual rate; loans with no positive balance carry no weight. Exact BigInt arithmetic,
  rounded once HALF_UP to `Percentage`; shown to two places with the suffix "· loans only".
  Every loan stores a rate, so no coverage line is needed. Cards *do* store a finance rate
  (`CardTerms.financeRate`), but it bills only a revolved balance; they stay out by decision, not
  for lack of data. The earlier caption "cards store no rate" was wrong and is corrected in the mirrors.
- *Monthly outgo:* the target stays instalments + card minimums. Shipped interim: loan instalments
  only, suffixed "· loans only" whenever a card carries a balance, because the card list substitutes
  default terms for cards without recorded terms, so a minimum there could be invented. Gap: expose
  whether terms were recorded (as `standing.usecases` `monthlyService` already does) and add minimums.
- *Unknown:* no loan with a balance, mixed currencies, or a failed usecase hides the figure (§3).
  The em-dash-with-reason form is not used in the sidebar header; hiding is the binding behaviour.

**What reverses this** (from the same decision log, and checkable): a credit card carried
past its due date. Then a card needs a recorded finance rate and a place in Payoff before
any hub is reconsidered.

## 9d. Insurance and income surfaces *(1.7.s, part 1 of 2 — 2026-10-28)*

**Status: binding for insurance and income.** Recurring commitments and physical assets
follow when their domains (1.3, 1.4) land. Built only from the §9b shells; every figure is
a `FigureValue` (§9b), so the unknown state below is the type's, not a screen's choice.
Domains: `src/domain/insurance.ts`, `src/domain/income.ts`. Both are class B (reference
data): redo depth 20 (§6), edits through a form, removal through §7.

### Insurance — `/insurance`

**Masthead.** Title "Insurance". **Hero: annual premium outgo** across policies in force
(`annualPremiumOutgo`). Side figures (`MastFigure`): *Next renewal* (date + premium) and
*Policies in force* (count).

**KpiStrip — one `Kpi` per cover kind that matters first: Health, Term life, Personal
accident.** The value is **presence, never a rupee amount**, and has exactly three readings:

| `presenceOf` | Kpi value | Detail line | Never |
|---|---|---|---|
| `covered` | "Covered" | insurer + whom it covers; "2 policies" when several | a green tick implying *enough* cover |
| `declared-absent` | "None held" | "You said so on 12 Jun 2026" + *Change* | red, a warning icon, or advice |
| `unknown` | em-dash (`UnknownFigure`) | "Not entered — add a policy or say you have none" | "None", "₹0", or "0 policies" |

The three must look different at a glance and none may look like a verdict. **No sum
insured appears in the strip**, because placing it there invites reading it as a score.

**Section "Policies" — `Panel flush` + table**, one row per policy, in-force first then
ended. Columns: Kind · Insurer · Covers · Sum insured · Premium (per its cadence) · Next
due · Cancel by. Sum insured unentered → em-dash with "Not entered". Cancel by with no
notice period → em-dash with "Notice period not known" (**not** the due date: unknown
notice is not zero notice). An ended policy shows "Ended 31 Mar 2026" in Next due and is
muted, not hidden.

**Renewals — the next 60 days**, from `renewalsBetween`, soonest first. A renewal whose
premium rises shows old → new, both figures, neutral colour: a price change is a fact.

**Cover erosion — information, collapsed by default.** One sentence per health policy:
"₹5,00,000 today buys about ₹2,83,713 of care in five years at 12% a year." The rate's
**source is printed beneath it, every time** (`coverErosion` refuses without one). Never
labelled a shortfall, never coloured, never a call to action.

### Income — `/income`

**Masthead.** Title "Income". **Hero: received this month** (`period(...).received`).
Side figures: *Expected this month* and *Missing* (count).

**KpiStrip:** Received (FY to date) · Expected (FY to date) · Missing · Pending.
**Expected is the em-dash when any occurrence's amount is unknown** ("1 expected amount
not entered"), never a partial sum. Missing is a count, amber when above zero; zero is a
real "0", not an em-dash.

**Section "Streams" — one `Panel` per stream** with a 12-month occurrence row. Each cell
is one of three treatments, and these are the whole vocabulary:

| State | Cell | Text alternative |
|---|---|---|
| received | the amount, normal ink; a difference from expected shown beneath, neutral | "Received ₹1,00,000 on 31 Jan" |
| missing | **"Missing"** in amber with its expected amount and "18 days late"; *Link a payment* | "Missing — expected ₹1,00,000, 18 days late" |
| pending | expected amount, muted | "Due 31 Oct, expected ₹1,00,000" |

**A missing occurrence never renders as `₹0`, a blank cell, or a gap in a chart line.**
That is the acceptance check for 1.5 and the reason this module exists. In any income
chart, a missing month is a **marked hole** with its label, not a dip to zero.

**Linking a payment** is the only way an occurrence becomes received: a picker of
unlinked **money arriving in a bank, savings or cash account** within ±15 days (in ledger terms
the DEBIT leg on a cash-like ASSET account, per ARCHITECTURE §11; the statement shows it as a
credit), **sorted by date, not by amount similarity**, so the owner chooses rather than
accepting a guess. The income account's own leg is never offered. The received date shown is
that transaction's date and is not editable. The picker states that nothing is matched
automatically. *(Corrected 2026-10-30: this said "credit postings", which names the wrong
ledger leg.)*

### States — both screens

| State | Insurance | Income |
|---|---|---|
| Loading | Skeleton strip + three skeleton rows | Skeleton strip + one skeleton stream |
| Empty | "No policies yet. Add one, or record that you hold none." Two actions, equal weight | "No income streams yet. Add your salary or any regular inflow." |
| Error | Names the failed read; *Retry* | Same |
| Unknown | Per Kpi, above; never the whole page | Expected total, above |
| Refused | — (nothing here declines to compute) | — |
| Stale | — (manual data does not go stale) | — |

Refused and stale have no trigger on these screens. They are listed so their absence is
a decision, not an omission.

**Keyboard:** §6 applies to both tables unchanged. `E` on an occurrence cell opens the
link picker; `Del` on a received cell **unlinks**, it never deletes the posting.

### 9d (part 2). Commitments and physical assets *(1.7.s — 2026-10-28)*

Same rules as part 1: §9b shells, `FigureValue` everywhere, class B verbs (§6, redo depth 20).
Domains: `src/domain/commitments.ts`, `src/domain/depreciation.ts` + `PhysicalAsset` in `assets.ts`.

### Commitments — `/commitments`

**Masthead.** Title "Commitments". **Hero: committed outgo per month** (`committedOutgo().perMonth`).
Side figures: *Per year* (the exact figure, not 12 × the month) and **Auto-renewing per month**:
the number the owner asked for, product §4.2. Both are the em-dash when any active price is
unknown ("1 price not entered"), never a partial sum.

**Section "Renewing soon" — the next 30 days**, `upcomingCharges`, soonest first. Each row:
name · due date · amount · **Cancel by** · an *Auto-renews* chip. A price change at this renewal
shows "₹649 → ₹699" with a neutral "Price rises" chip: a fact, not a warning colour. Cancel by
with no known notice: em-dash, "Notice period not known", never the due date. A cancel-by date
already past reads "Cancel-by passed — renews 3 Nov" in amber.

**Section "All commitments" — `Panel flush` + table:** Name · Kind · Cadence · Price · Per month ·
Next charge · Auto-renews · Ends. Grouped *Active* then *Ending* (cancelled, still paid up) then
*Ended* (muted, collapsed). **A cancelled commitment shows "Ends 14 Nov" and stays in the totals
until then**; the row says so ("Counted until it ends"), so the total never seems wrong.

**Cancelling is not deleting.** The row action is *Mark cancelled*, which asks one question: "Last
day it runs?" (defaulting to the day before the next charge). *Remove* is separate and §7 applies.

### Physical assets — `/assets`

**Masthead.** Title "Assets". **Hero: total asserted value**, the sum of the latest
*asserted* valuations. **Modelled values are never in the hero.** If any asset has no assertion
the hero is the em-dash: "2 assets have no valuation". Side figure: *Oldest valuation* (age).

**Each asset is a `Panel`** with two figures side by side, never merged:

| Figure | Source | Treatment |
|---|---|---|
| **Valued at** | latest `AssertedValuation` | the amount, with its source and date beneath: "₹92,00,000 · bank valuation · Mar 2026". Stale past its shelf life: amber "Valued 14 months ago", value still shown |
| **Model estimate** | `modelledValueOn` | **italic, muted, labelled "Model"**, with its terms and basis beneath: "*₹8,67,000* · Model · 15% of the remaining value each full year · your assumption". Shown only when a purchase is recorded |

**A model estimate never replaces a missing valuation.** With no assertion, *Valued at* is the
em-dash ("Not valued yet — add a valuation") even when a model figure sits beside it. The model
picker offers the three models plus, for vehicles, **Motor insurance IDV**, whose basis line
reads "What an insurer pays on a total loss, not a resale price".

**Major-spend link** (product §4.3): an asset bought by a recorded expense shows "Bought for
₹12,00,000 on 24 Aug 2023 → transaction" linking to it; this is the purchase the model uses.

### States — both screens

| State | Commitments | Assets |
|---|---|---|
| Loading | Skeleton hero + 3 rows | Skeleton hero + 2 panels |
| Empty | "No commitments yet. Add subscriptions, plans and fees that renew." | "No assets yet. Add property, vehicles or gold you own." |
| Error | Names the failed read; *Retry* | Same |
| Unknown | Totals (above); a row's price | Valued at; the hero (above) |
| Refused | — | — |
| Stale | — | A valuation past its shelf life (above) |

## 9e. The Activity screen *(2.7.s — 2026-10-28)*

**Status: binding.** `/activity` is where every change the owner made can be read, undone
and redone. Mechanism: `ARCHITECTURE.md` §10; rules: `RULES.md` §2.3–2.5; owner decisions
D1 (atomic bulk), D2 (30-day window), D3 (redo depth, §6). **Every refusal names its
cause** (§2.5): a disabled verb always carries its reason as visible text, never only a
tooltip, and is never hidden (§6).

### Grouping — one row per request, not per database row

The unit is `audit_events.request_id` (§10.2). **One row = one thing the owner did**: "Edited
1 transaction", "Removed 15 transactions", "Imported SBI Sep 2026 — 142 rows". It expands to
list the affected records, each linking to where it lives. Rows are grouped under day
headings (`Today`, `Yesterday`, then `28 Oct 2026`), newest first, inside a §9b `Panel flush`.

Columns: Time · What happened · Class · Records · Undo/Redo. **Class** is a small neutral chip:
*Ledger* (A) or *Reference* (B). Class C never appears: it has no user verbs, so it has no
user activity.

### Row treatment per mutation class

| Class | Verbs shown | What undo does, in the row's own words |
|---|---|---|
| A — ledger edit | Undo, then one-step Redo | "Restores the original; the correction stays on record behind *Show reversals*" |
| A — remove / remove-all | Undo | "Restores 15 transactions to every balance" |
| A — import | Undo | "Removes this import's 142 rows from every balance; the file and its review stay" |
| B — create / edit / remove | Undo, Redo (depth 20) | "Puts the policy back as it was at 14:02" |
| C — system | *(never listed)* | — |

An undone row stays in the list, struck through at `--fg-muted`, with *Redo* in place of
*Undo* while redo is valid. **Undo never removes the activity row itself**: the history of
having undone something is history too.

### Refusals — every one named, every one disabled with its reason

| Cause | Rule | Row text beside the disabled verb |
|---|---|---|
| Older than the window | D2 | "Undo closed on 27 Nov — changes older than 30 days are kept, not undone" |
| Touches a reconciled posting | L10, §2.5 | "Touches HDFC ••1234, reconciled to 30 Sep. Unreconcile that statement first" + link |
| Would reverse a reversal | §2.4 | "This is a correction. Undo the edit that made it instead" + link to that row |
| Redo invalidated | D3, §10.3 | "A later change touched 2 of these records" + link to the later row |
| Redo past the class A cursor | D3 | "Ledger changes redo one step only" |
| Part of the batch is blocked | D1 | "1 of 15 records is reconciled — the batch undoes whole or not at all" + names it |

**D1 makes a batch atomic, so there is no partial undo.** The refusal names the blocking
record; it never offers to undo "the other 14", which would split one request into two
stories.

### The confirmation

Undo of class A asks once, inline in the row (no modal), restating effect in figures:
"Undo removes ₹1,42,560.00 of outflow from SBI ••4417 and 3 categories. Undo / Cancel".
Class B undoes without asking; it is reversible by redo at depth 20. **Remove-all is not
here**; its confirmation is §7 / 2.6.s.

### States

| State | Treatment |
|---|---|
| Loading | Three skeleton day groups |
| Empty | "Nothing has changed yet. Edits, removals and imports appear here, and can be undone for 30 days." |
| Error | Names the failed read; *Retry*. Verbs disabled with "Activity could not be loaded" |
| Unknown | A record whose current location cannot be resolved lists as "Record no longer reachable", em-dash for its figure |
| Refused | Per row, the table above. Never page-level |
| Stale | After another tab changes data: amber banner "Newer changes exist — refresh to see them"; verbs disabled until refresh, because redo validity may have changed |

**Keyboard:** §6 applies. `Ctrl+Z` undoes the newest undoable row; `Ctrl+Y` redoes the newest
redoable one; when the newest is refused, the key does nothing and the row's reason is
announced (`aria-live="polite"`), so the refusal is heard, not just seen.

### 9e addendum — bound to the shipped code *(2.7.s/2.7.b, 2026-10-30)*

**What is undoable.** A row is undoable when (a) its request wrote at least one
`transaction` entity (the unit `UndoBatch` inverts), (b) its newest event is inside D2's
30 days, and (c) no newer write touches its transactions (`touchedSince`). Reconciled
(L10) and reverse-a-reversal blocks are only known on attempt; the action returns the
wrapped `blockedBy` message inline beside the row (`aria-live="polite"`), never page-level.

**Row treatment, as built.** Class A rows carry the *Ledger* chip; Undo asks once inline
("Undo this whole change? It is all or nothing." · Undo · Cancel). Class B rows carry
*Reference* with Undo disabled: class B undo has not shipped (2.4 out of scope), so it
reads `ACTIVITY_REASONS.CLASS_B`. An `IMPORT_BATCH`-only request is Ledger with Undo
disabled, `ACTIVITY_REASONS.NOT_LEDGER`. Class C is never listed. Each row shows time,
"Added 1 transaction, reversed 1 transaction", who (*You*, or the actor id), record count.

**Refusal text — one source each.**

| Reason | Text source |
|---|---|
| `NO_BATCH` | `UNDO_MESSAGES.NO_BATCH` |
| `EXPIRED` | `UNDO_MESSAGES.EXPIRED` |
| `SUPERSEDED` | `UNDO_MESSAGES.SUPERSEDED` (pre-checked; shown before any click) |
| `BLOCKED` | the wrapped `RestoreRefusedError` / `TombstoneRefusedError` message |
| Redo, not this row | `ACTIVITY_REASONS.REDO_CURSOR` |
| Redo `INVALIDATED` | `RedoUnavailableError("INVALIDATED")`, as an amber page banner (the cursor is gone, so no row owns it) |

**States, as built.** Loading: three skeleton groups. Empty: the §9e sentence. Error:
"Activity could not be loaded", Retry, no verbs. Unknown: an actor other than the owner
shows its id, never blank. Refused: per row, table above. Stale: the redo-invalidated
banner; the cross-tab stale banner and `Ctrl+Z`/`Ctrl+Y` are deferred (recorded in the plan).

## 9f. The Standing screen — scoring *(3.11.s — 2026-10-28)*

**Status: binding**, built only from what P1 + 3.0–3.5 + 3.10 compute (`src/domain/scoring/`).
**No score is specified here that those modules cannot produce.** Percentile placement (3.8/3.9)
is **not on this screen yet**: its data licensing is unresolved (WID.world), so the panel is
absent, not stubbed. Route `/standing`.

**1. Composite — or its refusal, which is the common case at first.**
- *Scored:* hero is the score as 0–100 (`composite().score × 100`, no decimals) **with its tier
  label beside it, never alone** ("72 · Steady"), and beneath it the sensitivity range "68–76
  under other reasonable benchmarks" and coverage "100% of indicators measured". Distance to the
  next tier: "8 points to Strong". If a ceiling blocks the next tier, that sentence is replaced
  by the ceiling's own reason (`tierFor().ceilings`), never by a points figure.
- *Refused:* a `ChartPanel`-style **refused** state, not an error and not an empty hero:
  "The composite is not computed — 5 of 6 pillars computable. Missing: Retirement funding." plus
  the one action that would fix it. The five computable pillars render in full below. A refusal
  is not a blank screen.

**2. Pillars table** (`Panel flush`): Pillar · Data state · Score · Range · Basis · Threshold and
its source. **Data state is one of three chips — Measured / Declared absent / Unknown — never
collapsed**; Unknown shows the em-dash in Score and Range with its reason. Every threshold cell
shows its citation **with its kind**: a CONVENTION reads "convention — used by lenders", never as
a standard; OWN_HISTORY reads "against your own 24 months"; PRIMARY links its source.

**3. Tier change.** When `droppedFrom` is set: one neutral line, "Tier moved from Strong to Steady:
Runway fell from 6.2 to 4.1 months." **No icon, no colour change beyond ink, no animation,
nothing celebratory or consoling.** A rise gets the same plain sentence, also without celebration
(product §8: no celebration animations).

**4. Badges.** A quiet list of `badgesHeld`, each with its `meaning`. No count of badges, no
"next badge" nudge, no progress ring. A badge no longer met is simply absent.

**Guess first** applies to **both the tier and percentile placement** *(owner decision
2026-11-03, MEMORY.md; amends the 2026-10-30 9f.1 supersession, which covered the tier only,
and the original wording "applies only to percentile placement")*. The tier guess ships now
(9f.1); percentile placement arrives with 3.8 inside the same guess gate, never beside it.

**States:** loading (skeleton hero + table); empty (no data at all: "Add accounts and statements
to start measuring"); error; unknown (per pillar, above); **refused** (composite, above);
stale (any underlying figure older than 45 days, amber, names it).

### 9f.1 Scoring dashboard — guess first, refusal, unwired data *(3.11.s amendment — 2026-10-30)*

**Supersedes** the 9f line "Guess first applies only to percentile placement" (owner-approved
3.11 brief). Built at `app/(root)/standing/`, logic in `standing-model.ts`.

- **Guess first on the tier.** When the composite is scored, the owner picks Tier 1 / 2 / 3
  (radio group, Arrow keys) and presses "Show my score" before the hero, tier, range and table
  appear. The reveal is one plain sentence, "You guessed Tier 2. The score places you in Tier 1."
  — no praise, no consolation, no colour, on a match or a miss. Tier names are placeholders
  (`TIER_LABEL`) and the screen says so.
- **No guess on a refusal.** There is nothing to reveal; the refusal shows at once:
  "The composite is not computed. 0 of 6 pillars computable. Missing: …" plus the action
  "Measure <pillars> to compute it." The composite KPI is the em-dash with its reason.
- **Always shown:** coverage % (even 0%) and the sensitivity range; a refused range is the
  focusable em-dash with "No range: the composite is refused…". Per-axis ranges likewise.
- **Unwired measurements.** Until ledger-derived measurements are wired, every indicator is
  *unknown* with "<Indicator> is not yet derived from your records" — never a zero, never a
  placeholder number. The screen therefore shows the refusal naming all six pillars.
- **States:** loading (skeleton); empty (no cash account: "Add accounts and statements to start
  measuring"); error (names the failed read, Retry); unknown (em-dash per pillar/indicator);
  refused (above); stale (amber banner naming the oldest input over 45 days).

*Dated correction 2026-11-03:* the "Supersedes" line above narrowed guess first to the tier.
The owner has since decided it covers **both** the tier and percentile placement; see the 9f
line above and 9f.2.

### 9f.2 QA repair — owner decisions and disclosures *(2026-11-03)*

Repairs the independent QA FAIL (`tmp/scoring-independent-review.md`,
`tmp/standing-independent-qa.md`). Built in `app/(root)/standing/`, logic in `standing-model.ts`.

- **Guess first covers the tier and percentile placement.** Before "Show my score", nothing that
  reveals the tier renders: no hero, tier label, points-to-next, held-by-margin sentence, range,
  pillar or indicator table, or tier-rules table. Percentile placement (3.8) goes inside the same
  `GuessFirst` gate.
- **Retirement funding is measured on total net worth** (every asset less every liability on the
  ledger balance sheet) ÷ trailing-12-month expenses — not retirement accounts. The indicator's
  formula line says so. A non-zero balance in another currency makes it Unknown, naming the
  account and saying no conversion is made.
- **Pending owner decisions are shown, never silent.** The 0.03 demotion margin is owner-set and
  **not confirmed**. A `warning` Banner titled "Pending owner decision, not confirmed" lists it on
  every screen (refused or scored, before the guess — it reveals no tier). A **Tier rules** table
  (`Panel flush`: Rule · Value · Status · Source) lists every threshold the tier reads; Status is
  Cited / Owner decision / "Pending owner decision — not confirmed". When the margin alone kept the
  tier, one plain line says so inside the guess gate: "The score is below the floor of Tier 3; the
  tier is kept by the demotion margin, an owner decision that is not confirmed yet."
- **10× vs 15× income is shown as Not computable**, with its reason (cover is scored as presence,
  product §4.1, and an income-multiple insurance score is refused). Each axis line carries its
  status (Recomputed / Refused / Not computable); the Range KPI detail names the axis it could not
  include. No figure is invented for it; task 3.5 stays open.
- **Limitations panel.** Always rendered: "Runway counts spendable cash in INR only. Cash held in
  another currency is left out, not converted, so runway is understated if you hold any." The
  exclusion stays until a completeness contract for foreign cash exists.

*Owner decisions 2026-11-03 16:11 (supersede the two items above where they differ):*
- The **0.03 demotion margin is approved**: OWNER_SET, confirmed. The Tier rules row reads
  "Owner decision — confirmed"; it is no longer in the pending banner, which remains for any
  other unconfirmed owner-set threshold (none today). The held-by-margin line reads "...the tier
  is kept by the owner-confirmed demotion margin of 3 points."
- **10x vs 15x income stays pending, unscored**: its axis status reads "Pending owner decision —
  unscored" (not "Not computable"); no carrier is invented and there is no insurance income score.

## 10. Known gaps

- **No artifact has been inspected visually.** No agent in this session had a browser or
  screenshot tool. Narrow widths, chart label crowding and dark-theme rendering are
  unverified by eye across all artifacts.
- **Banking Console predates the corrected token set** (§1.3).
- ~~The debt-aggregates navigation placement is inconsistent between artifacts~~
  Reconciled in §9c (D.2, 2026-10-27). The mirrors were corrected on 2026-11-03, and
  the published artifacts await republishing.
