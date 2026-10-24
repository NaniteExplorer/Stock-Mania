# UI Redesign v2 — Design Research Brief (classic professional finance UI)

Status: PLANNING
Owner: Research Agent
Updated: 2026-10-19
Lane: **Research only** — no production code, no experiments. Output is this brief, executable directly by a design agent.

## Requirement
Stock-Mania needs a visual and interaction language that reads as institutional-grade — the register of Bloomberg Terminal, Koyfin, Sharesight and Zerodha Console rather than consumer fintech (Groww, Copilot). This brief prescribes concrete tokens, table mechanics, dashboard composition, analytics and their visual forms, Indian-market formatting rules, and a11y requirements, so the design agent picks values rather than deliberating.

## Evidence quality note
Web search on 2025-26 "professional finance dashboard UX" returns mostly agency/vendor content, not standards. Treat that material as informed opinion. The strongest, most reproducible evidence is (a) the products themselves, (b) W3C WCAG 2.2, (c) typography/locale specs (OpenType `tnum`, CLDR/`en-IN`), (d) Indian tax statute summaries. Where this brief is prescriptive without an external citation, it is a reasoned recommendation derived from the product references, flagged as **[judgement]**.

---

## 1. Visual language for "classic + professional"

### 1.1 What actually reads as institutional
Observed consistently across Bloomberg Terminal, Koyfin, Sharesight, Portfolio Performance, Morningstar Direct and Zerodha Console — and *absent* from Groww/Copilot/Monarch:

| Signal | Pro products | Consumer products |
|---|---|---|
| Information per screen | High — tables first, 28–36px rows, 12–20 columns | Low — cards, big numerals, lots of air |
| Elevation | **Hairline borders**, almost no shadow | Soft shadows, large radii, gradients |
| Corner radius | 2–6px | 12–24px |
| Color | Neutral canvas; color reserved for *meaning* (gain/loss, state) | Brand color as decoration, gradient fills |
| Typography | One UI sans + tabular/mono numerals; weight, not color, for hierarchy | Display weights, varied type sizes |
| Charts | Thin strokes, grid, axis labels, no fills or faint fills | Thick strokes, gradient area fills, rounded caps |
| Motion | ~0; instant state changes | Animated counters, entrance transitions |

Design rule: **color is a data channel, not decoration.** If a hue is not encoding gain/loss, a category in a chart, or a state (warning/error/selected), it should not appear.

Supporting observations: reviewers describe Koyfin as cleaner and more visually appealing than Bloomberg while serving the same research job ([G2 Koyfin reviews](https://www.g2.com/products/koyfin/reviews)); practitioners designing for fund managers and compliance officers report those users expect *a table*, not cards with big numbers ([Deeflect: data tables are the hardest UI problem](https://blog.deeflect.com/valk-06-data-tables-hardest-problem/)); financial-dashboard writeups converge on right-aligned tabular figures, inline sparklines, consistent currency formatting and drill-downs that preserve position ([Lazarev: financial dashboard design](https://www.lazarev.agency/articles/financial-dashboard-design)).

### 1.2 Typography
- **UI/text face:** Inter (variable) or IBM Plex Sans. Both ship true tabular figures. Inter: enable `font-feature-settings: "tnum" 1, "cv05" 1;` globally on numeric contexts.
- **Numeric face for tables/KPIs:** either (a) Inter with `tnum` + `ss01`, or (b) a dedicated mono — **JetBrains Mono**, **IBM Plex Mono**, or **Roboto Mono** — at 0.95× the sans size to compensate for the wider cap-height feel. **Recommendation [judgement]: Inter + `tnum` for tables (better density, fewer fonts), mono reserved for ISIN/symbol codes, order IDs and raw CSV previews.**
- Tabular figures are mandatory anywhere numbers stack vertically. OpenType `tnum` is the mechanism; `font-variant-numeric: tabular-nums;` is the CSS. Add `slashed-zero` for symbol/ID columns.
- **Scale** (use these exact values, 4px base grid):

| Token | px / line-height | Weight | Use |
|---|---|---|---|
| `text-display` | 30 / 36 | 600 | Single hero figure (net worth) only |
| `text-h1` | 22 / 28 | 600 | Page title |
| `text-h2` | 17 / 24 | 600 | Section / card title |
| `text-kpi` | 24 / 30 | 600, tnum | KPI tile primary value |
| `text-body` | 14 / 20 | 400 | Default UI text |
| `text-table` | 13 / 18 | 400, tnum | Table cells |
| `text-label` | 12 / 16 | 500, +0.02em tracking | Column headers, KPI captions |
| `text-micro` | 11 / 14 | 500, tnum | Deltas, badges, footnotes, units |

- Never exceed 4 distinct sizes in one view. Hierarchy comes from **weight (400/500/600) and neutral step**, not size or hue.
- Currency symbol and unit suffix (`L`, `Cr`, `%`) render at `text-micro` in `--fg-muted`, baseline-aligned, 2px gap — keeps the digit stream the dominant mark.

### 1.3 Borders vs shadows
- Default elevation = **1px border, no shadow.** `--border` at ~12% contrast against surface.
- Shadow allowed only for genuinely floating layers: dropdown/menu/popover (`0 4px 12px rgb(0 0 0 / 0.10)`), modal (`0 16px 48px rgb(0 0 0 / 0.20)`), and the right edge of a sticky/pinned first column (`inset -1px 0 0 var(--border), 6px 0 8px -6px rgb(0 0 0 / 0.12)` — appears **only when horizontally scrolled**).
- Radii: `--radius-sm: 3px` (inputs, badges, buttons), `--radius-md: 6px` (cards, panels), `--radius-lg: 8px` (modals). Nothing larger. Tables and table cells: `0`.

### 1.4 Token set (copy these values)

Neutral ramp — single ramp, used by both themes via semantic aliases. Values are OKLCH-derived hex, near-neutral with a faint cool cast (hue ~250) so it doesn't read as muddy next to green/red.

```
--n-0:  #FFFFFF
--n-25: #FBFCFD
--n-50: #F6F8FA
--n-100:#EFF2F5
--n-150:#E4E8ED
--n-200:#D6DCE3
--n-300:#B9C2CC
--n-400:#8C98A6
--n-500:#64707E
--n-600:#49545F
--n-700:#343C45
--n-800:#232A31
--n-850:#1A2026
--n-900:#13181D
--n-950:#0C1014
```

Accent — exactly one. **Indigo/slate-blue**, deliberately *not* green or red (those are reserved for P&L) and not saffron/orange (reads as a brand, collides with warning).

```
--accent-50:  #EEF2FF
--accent-100: #E0E7FF
--accent-300: #A5B4FC
--accent-500: #4F62D8   /* primary action, light theme */
--accent-600: #3F50BE
--accent-400: #7D8CEA   /* primary action, dark theme */
```

Semantic gain/loss — India uses green = gain, red = loss, identical to the US convention (Zerodha Kite, Groww, INDmoney, NSE/BSE tickers all follow it). Hues chosen as **teal-leaning green + orange-leaning red**, the standard deuteranopia/protanopia-safe substitution, so the pair stays distinguishable for the ~8% of men with red-green CVD while still reading as "green/red" to everyone else.

```
--gain-fg-light:  #0E7C66   /* teal-green, 4.9:1 on --n-0 */
--gain-fg-dark:   #3FC9A6   /* 7.0:1 on --n-900 */
--gain-bg-light:  #E6F5F1
--gain-bg-dark:   #0E2F29

--loss-fg-light:  #C0392B   /* orange-leaning red, 5.0:1 on --n-0 */
--loss-fg-dark:   #FF7A6B   /* 6.4:1 on --n-900 */
--loss-bg-light:  #FBEAE7
--loss-bg-dark:   #3A1A16

--flat-fg-light:  #64707E
--flat-fg-dark:   #8C98A6
```

Rule: **color is never the only channel.** Every signed figure carries an explicit `+` / `−` sign (U+2212 minus, not hyphen) and, in tables, an optional ▲/▼ glyph toggleable in settings. This satisfies WCAG 1.4.1 Use of Color.

Status (non-P&L): `--warn: #B45309` / dark `#F0B429`; `--info: #1D6FA5` / dark `#5BB0E8`; `--danger` reuses `--loss`; never reuse `--gain` for "success" in forms — use `--accent` for confirmation so green always means money up.

Semantic aliases (the only tokens components reference):

```
light:  --bg-canvas:var(--n-50);  --bg-surface:var(--n-0);   --bg-raised:var(--n-0);
        --bg-subtle:var(--n-100); --bg-hover:var(--n-100);   --bg-selected:var(--accent-50);
        --border:var(--n-200);    --border-strong:var(--n-300);
        --fg:var(--n-900); --fg-secondary:var(--n-600); --fg-muted:var(--n-500); --fg-disabled:var(--n-400);

dark:   --bg-canvas:var(--n-950); --bg-surface:var(--n-900); --bg-raised:var(--n-850);
        --bg-subtle:var(--n-850); --bg-hover:var(--n-800);   --bg-selected:#1B2340;
        --border:var(--n-800);    --border-strong:var(--n-700);
        --fg:var(--n-50);  --fg-secondary:var(--n-300); --fg-muted:var(--n-400); --fg-disabled:var(--n-600);
```

### 1.5 Light/dark handling
- Dark theme is **not** inverted light. Canvas `#0C1014`, surfaces *lighter* than canvas (`#13181D`), borders lighter still. Never pure black (#000) or pure white text (#FFF → use `--n-50`) — reduces halation on OLED.
- Saturation of gain/loss rises in dark (the `-dark` tokens above are more saturated and lighter) to hold perceived contrast.
- Chart grid lines: light `--n-150` at 100%; dark `--n-800` at 100%. Axis labels always `--fg-muted`.
- Theme switch via `data-theme` attribute on `<html>` + `prefers-color-scheme` media query fallback; respect `prefers-reduced-motion` by disabling all transitions.
- **Density is theme-independent** — do not make dark mode airier.

### 1.6 Spacing & layout grid
4px base. Steps: 4, 8, 12, 16, 24, 32, 48. Page gutter 24px desktop / 16px mobile. Max content width: **none** for table pages (let them use the monitor); 1440px for dashboard. Card padding 16px; KPI tile padding 16px; table cell padding `8px 12px` (comfortable) / `6px 12px` (compact) / `4px 10px` (dense).

---

## 2. Data-table craft

The table is the product's core surface. Build one table primitive; every list in the app is a configuration of it. (TanStack Table v8 headless + custom cells is the standard answer for this shape of requirement. **[judgement]**)

### 2.1 Column design for financial tables
- **Alignment:** text left; all numerals **right**; dates right or left but consistent app-wide (recommend left for dates, right for everything numeric); status badges left; row-action affordances right, in a fixed 44px column.
- **Header alignment matches cell alignment.** A right-aligned number column gets a right-aligned header. Sort indicator sits on the *inner* side of the header text.
- **Column widths:** fixed px per semantic type, not `auto`. Symbol 96, Name 220 (truncate with tooltip), Qty 88, Avg cost 104, LTP 104, Value 120, Day Δ 104, Day Δ% 80, Unrealized P&L 120, P&L% 88, Weight% 72, Actions 44.
- **Never wrap numeric cells.** Truncate names with `text-overflow: ellipsis` + native `title`.
- **Decimals per unit type, enforced globally:** money ≥ ₹1,00,000 → 0 dp; money < ₹1,00,000 → 2 dp; percentages → 2 dp; quantities → up to 4 dp for MF units, 0 dp for equity shares; NAV → 4 dp; price → 2 dp. Zero-pad so the decimal points line up.
- **Column groups** (two-row header) for related metrics: `Position | Cost | Market | P&L | Returns`. Group header row uses `--bg-subtle`, 11px uppercase `--fg-muted`.

### 2.2 Structure & mechanics
- **Sticky header** always (`position: sticky; top: 0; z-index: 2;` with a solid `--bg-surface` background and `box-shadow: inset 0 -1px 0 var(--border)`).
- **Sticky first column** (instrument/name) on tables wider than the viewport; shadow appears only on `scrollLeft > 0`.
- **Sticky totals footer** at the bottom of the scroll container for any table where a sum is meaningful (holdings value, P&L, invested). Footer background `--bg-subtle`, weight 600.
- **Density toggle** — three levels (Comfortable 36px, Compact 32px, Dense 28px row height), persisted per user, exposed in the table toolbar as a segmented control. Default **Compact** [judgement].
- **Zebra striping: no.** Use a 1px `--border` bottom rule per row plus a `--bg-hover` row hover. Striping fights column grouping and looks dated. Exception: when density = Dense and columns > 12, allow optional striping at `--n-25`/`--n-850`, user-toggleable.
- **Row hover** must also highlight nothing else; **row focus** (keyboard) gets a 2px `--accent` left border inset, not a full outline.
- **Pagination vs virtualization:** virtualize (row windowing) whenever the dataset can exceed ~200 rows — transactions, dividends, tax lots, price history. Use page-less infinite scroll *with* a sticky "N of M rows" counter and a jump-to-top control. Keep classic pagination only for server-paged remote data. Holdings tables (typically < 200 rows) render in full, no pagination. Virtualization must not break Ctrl+F expectations — provide an in-table search field that filters rather than scrolls.

### 2.3 Column visibility & reordering
- Toolbar "Columns" popover: searchable checkbox list, grouped by column group, with drag handles for order, "Reset to default", and a count badge (`Columns · 14/22`).
- Drag-reorder in the header itself as a secondary affordance (grab the header, 2px accent drop indicator).
- Column resize by dragging the header divider; double-click = fit-to-content; widths persist.
- All of visibility + order + width + sort + filters + density = **one saved-view object.**

### 2.4 Sorting
- Multi-sort: click = sort asc → desc → none. **Shift+click** adds a secondary/tertiary key; the header shows a small ordinal (`1`, `2`) beside the arrow. A "Sorted by: Value ↓, Symbol ↑ ✕" chip appears in the toolbar so multi-sort is discoverable and clearable.
- Sort nulls last always, in both directions.
- Sorting respects the *numeric* value, never the formatted string (₹1.2 Cr must sort above ₹99 L).

### 2.5 Filtering
- **Toolbar filter bar** with three control kinds:
  1. **Faceted multi-select** for low-cardinality dimensions — asset class, sector, platform/broker, account, exchange, category, tag, FY. Show counts next to each facet value (`Equity 48`, `Mutual Fund 23`). Searchable when > 10 values.
  2. **Range filters** for numeric/date — min/max numeric inputs plus a dual-handle slider with a tiny histogram behind it (distribution preview) for value, P&L%, weight, quantity. Date ranges use the presets in §3.3.
  3. **Free-text search** over name + symbol + ISIN, debounced 150ms, matching substring and acronym.
- Active filters render as removable chips below the toolbar: `Sector: Banking ✕` · `Value ≥ ₹1,00,000 ✕` · `Clear all`. Row count updates as `Showing 37 of 214`.
- Filters are URL-encoded (query string) so views are linkable and back-button-safe.

### 2.6 Saved views
- A view = filters + sort + columns + order + widths + grouping + density, named, with a default-per-page flag. Surface as a tab strip or a dropdown at the top-left of the table: `All holdings · Equity only · Underwater · Long-term eligible · + New view`.
- Ship **preset views** so the feature is useful on day one: *All*, *Equity*, *Mutual funds*, *Top 10 by value*, *Losers*, *LTCG-eligible* (holding ≥ 12m equity / ≥ 24m debt), *Approaching LTCG* (within 60 days), *Dividend payers*, *This FY transactions*.
- Views are per-user, duplicable, renameable, deletable with undo.

### 2.7 Grouping & subtotals
- Group-by a single dimension (asset class, sector, platform, account, FY, category). Render as collapsible group header rows: `▸ Banking — 7 holdings · ₹8,42,310 · +12.4%` with the group's aggregate values rendered *in their own columns*, right-aligned, weight 600, `--bg-subtle`.
- Subtotal semantics must be declared per column: sum (value, invested, P&L, quantity-if-same-instrument), weighted average (avg cost, XIRR, yield), or blank (price, symbol). **Never sum a percentage.** Weight the average by invested capital and say so in the header tooltip.
- Grand total in the sticky footer, consistent with the group semantics.
- Expand/collapse all; group state persists in the saved view.

### 2.8 Row expansion
- Chevron in a 32px leading column. Expanded panel renders *inside* the row span, `--bg-subtle`, 16px padding, and contains: a 90-day sparkline, the lot list (buy date, qty, cost, holding period, STCG/LTCG bucket), recent transactions, and quick actions. Max height 320px with internal scroll.
- Only one row expanded at a time by default (`accordion`), with a toggle for multi-expand.

### 2.9 Bulk actions
- Checkbox column (leading, 40px, sticky with the first column). Header checkbox = select all *on the filtered set*, with an explicit "Select all 214 matching rows" link when the view is virtualized/paged.
- Selection summary bar replaces the toolbar in place (does not float over content): `12 selected · ₹3,21,400 total · Tag… · Assign platform… · Export CSV · Delete · Clear`.
- Destructive bulk actions require a typed confirm with the count.

### 2.10 CSV export
- Export **exactly what is visible**: current filters, sort, column set and order. Offer a second option "Export all columns".
- Export raw numeric values with full precision and ISO-8601 dates in a `_raw` variant; the default export uses display formatting with a UTF-8 BOM so Excel renders `₹` correctly. Filenames: `stockmania_holdings_2026-10-19.csv`.
- Also offer "Copy as TSV" for paste into Sheets/Excel — one keyboard shortcut (`Ctrl/⌘+C` on a selection) — and a print/PDF stylesheet for statement-like tables.

### 2.11 Empty / loading / error states
- **Loading:** skeleton rows matching the real row height and column widths (never a centered spinner over a table), 8 rows, shimmer disabled under `prefers-reduced-motion`. Header and toolbar render immediately and are interactive-disabled.
- **Refreshing existing data:** keep stale rows visible at 100% opacity, show a 2px indeterminate bar under the header, and a `Updated 14:32 · refreshing…` timestamp in the toolbar. Never blank out data you already have.
- **Empty — no data at all:** icon-free, 1 line of 15px `--fg` ("No holdings yet"), 1 line of 13px `--fg-muted` explaining, 1 primary action ("Add a transaction") and 1 secondary ("Import from broker CSV").
- **Empty — filters exclude everything:** different copy, must echo the filters and offer `Clear all filters`. This distinction is non-negotiable.
- **Error:** inline panel inside the table body, `--loss` left border, plain-language cause, the operation's correlation/request id in mono, `Retry` as the primary button. Partial failure (e.g. prices stale for 3 of 40 symbols) is *not* a full error — render rows with a `⚠ stale` chip in the price cell and a tooltip giving the last-known timestamp.
- **Stale market data** is a first-class state: any price-derived figure older than the configured freshness window renders in `--fg-muted` with a dotted underline and a tooltip. Never show a stale number as if it were live.

---

## 3. Dashboard composition

### 3.1 KPI / stat tile anatomy
Fixed anatomy, top to bottom, 16px padding, 1px border, no shadow, `--radius-md`:
1. **Label** — `text-label`, `--fg-muted`, uppercase off (sentence case), with an ⓘ affordance if the metric needs a definition.
2. **Primary value** — `text-kpi`, tnum, `--fg`. Currency symbol at `text-micro`.
3. **Delta line** — `text-micro`: signed absolute change *and* percent, colored `--gain`/`--loss`/`--flat`, followed by the comparison period in `--fg-muted` (`+₹24,180 · +2.14% today`). Always state the period; a naked delta is meaningless.
4. **Context strip** (optional) — a 32px-tall sparkline flush to the tile's bottom edge, 1.5px stroke, `--fg-secondary`, no axes, no fill, with a single end-point dot. Or a 4px segmented allocation bar.
Tiles are clickable → navigate to the corresponding detail view; whole tile is the hit target, with a visible focus ring.

### 3.2 The top metrics (net-worth + portfolio dashboard)
Six tiles, in this order [judgement, derived from Kubera/Sharesight/INDmoney/Empower defaults]:
1. **Net worth** — assets − liabilities. Delta vs selected range. Sparkline of the net-worth series. *The hero; may render at `text-display` in a wider tile spanning 2 columns.*
2. **Invested / Current value** — total invested cost vs current market value of investable assets (the portfolio-only subset of net worth).
3. **Unrealized P&L** — absolute and %; this is the number users check most.
4. **XIRR (overall)** — the single honest return number for a cashflow-driven portfolio. Label it "XIRR (since inception)" and offer a range-scoped variant.
5. **Today's change** — absolute and %, market-hours aware; shows "Markets closed · as of 15:30 IST" outside hours.
6. **Cash + liquid / Savings rate (this month)** — depending on whether the user has budgets enabled; if both, show liquid assets here and savings rate in the budgets section.

Secondary row (below the fold or on the portfolio page): realized P&L this FY, dividend income this FY, allocation drift vs target, debt-to-asset ratio, loan outstanding, next 30 days of expected cashflows.

### 3.3 Time-range control
One control, used identically everywhere, as a segmented control with an overflow:
`1D · 1W · 1M · 3M · 6M · **FY** · 1Y · 3Y · 5Y · Max · Custom…`
- **`FY` means the Indian financial year (1 Apr – 31 Mar)** and is a first-class preset, not hidden in Custom. Offer `FY 2026-27` (current) and a dropdown of prior FYs. `YTD` (calendar) is also available but is secondary in India.
- Custom opens a two-month range calendar with Indian-FY quick picks (`This FY`, `Last FY`, `Q1 FY27 (Apr–Jun)`, …).
- The selected range is global to the page, shown in a persistent subheader (`1 Apr 2026 – 19 Oct 2026 · 202 days`), and is URL-encoded.
- Every delta and every chart on the page obeys it; any tile that *cannot* (e.g. "Today's change") must label its own period explicitly.

### 3.4 Benchmark comparison
- A benchmark selector adjacent to the time range: `vs NIFTY 50 ▾` (NIFTY 50, NIFTY 500, NIFTY Midcap 150, Sensex, NIFTY Bank, a custom 60/40, None).
- Default comparison method: **normalized cumulative return, both rebased to 100** at range start, drawn as two lines — portfolio in `--fg` (or `--accent`), benchmark in `--n-400` dashed. Add a shaded difference band between them tinted `--gain`/`--loss` by sign.
- Also show an "alpha" figure (portfolio return − benchmark return over range) in the chart header. Be explicit that the portfolio line is TWR when compared to an index (see §4.1) — a cashflow-distorted MWR vs an index is a misleading comparison, and the UI should say so in the ⓘ tooltip.

### 3.5 Drill-down conventions
- Consistent path: **tile → filtered table → row expansion → entity page → transaction**. Each step keeps the time range and relevant filter in the URL.
- Clicking a chart segment/bar/slice applies that dimension as a filter on the table below it, rather than navigating away. The chart and table on a page are a linked pair.
- Every entity page has the same spine: header (name, symbol, exchange, current price, day change) → KPI row (qty, avg cost, value, unrealized, XIRR, weight) → price chart with transaction markers → tabs (Transactions · Lots & tax · Dividends · Notes).
- A breadcrumb trail with the active filters encoded, plus an always-available "Back to <view name>" that restores scroll position.

### 3.6 Above the fold (1440×900)
Row 1: page header + global time range + benchmark selector + "as of" timestamp (56px).
Row 2: the six KPI tiles (one row, ~140px).
Row 3: net-worth / portfolio-value trend chart with contribution-vs-growth attribution (~320px), beside a compact allocation panel.
Everything else — holdings table, transactions, budgets, loans — below. The holdings table's first rows should peek above the fold to signal there is more.

---

## 4. Pro-level analytics worth featuring

For each: definition, why it matters, and the prescribed visualization.

### 4.1 Return measures
- **TWR (time-weighted return)** — return of the *strategy*, neutralizing the timing and size of deposits/withdrawals (geometric link of sub-period returns between cashflows). **Use for all benchmark comparisons.** Visual: the rebased-to-100 line chart of §3.4.
- **MWR / XIRR (money-weighted, internal rate of return on irregular cashflows)** — the return the *investor* actually earned, counting when money went in. This is the number Indian users expect (every Indian broker and MF statement quotes XIRR). **Use for "how am I doing".** Visual: a single large figure in a KPI tile + a small bar chart of XIRR by asset class / by platform. Never plot XIRR as a time series without stating it is "XIRR as of date, since inception".
- **Show both, side by side, labelled**, with a one-sentence ⓘ explaining the difference. Divergence between them is itself insight (it quantifies timing skill). Keep the underlying implementation consistent with `_architecture/30-CALCULATIONS.md`.
- **CAGR** — geometric annualized growth of a single value series with no intermediate flows: `(End/Start)^(1/years) − 1`. Correct for a single lumpsum holding; wrong for an SIP. Visual: a figure on the instrument page, next to absolute return.
- **Absolute vs annualized return** — absolute = `(Current − Invested)/Invested`. **Rule: never annualize a holding period under 12 months** (it produces absurd numbers); render `—` with a tooltip "annualized return shown after 1 year". Display as a paired cell: `+24.1%` on line 1, `+11.3% p.a.` in `text-micro` `--fg-muted` on line 2.

### 4.2 Allocation
- Dimensions to support: **asset class** (equity / MF / debt / FD / gold / cash / real estate / crypto), **sector** (GICS-like or NSE sector), **market cap** (large / mid / small, using SEBI's AMFI ranking: top 100 / 101–250 / 251+), **geography** (India / US / other), **platform or broker**, **account**, **custom tag**.
- Visual: **horizontal stacked bar (100%)** as the primary allocation mark — it ranks, labels and compares across time far better than a donut. Pair it with a right-aligned table of `Dimension | Value | Weight% | Target% | Drift`. 
- Use a donut **only** for the single top-level asset-class split on the dashboard, max 6 slices + "Other", with the total in the hole.
- **Allocation drift vs target** deserves its own mark: a diverging bar chart centered on 0 showing `actual% − target%` per bucket, with a ±2pp tolerance band shaded. This is the actionable view.
- Allocation over time: **stacked area** (100% normalized) by month.

### 4.3 Concentration
- **Top-N weight** — the share of portfolio in the largest 1/3/5/10 holdings. Visual: four small stat chips, plus a Pareto chart (sorted bars + cumulative % line) of holdings by weight.
- **HHI (Herfindahl–Hirschman Index)** — `Σ(weightᵢ)²` with weights as percentages (0–10,000) or as fractions (0–1). Interpret: `1/HHI` = "effective number of holdings", which is the number to *show users* because it is intuitive ("your 32 holdings behave like 7"). Display HHI itself as a secondary figure with a banded gauge: <1500 diversified, 1500–2500 moderate, >2500 concentrated (the US DOJ market-concentration thresholds, repurposed as a familiar scale — label it as a heuristic, not a rule).

### 4.4 Risk & drawdown
- **Drawdown curve** — `value_t / running_max_t − 1`, always ≤ 0. Visual: a dedicated area chart below the value chart, filled `--loss` at 12% opacity, y-axis inverted-feeling (0 at top, negative down), with the max-drawdown point annotated (`Max DD −22.4% · 12 Mar 2026 → recovered in 84 days`). Also list the 5 worst drawdowns in a small table with peak date, trough date, depth, recovery days.
- **Rolling returns** — e.g. all 1Y/3Y/5Y windows stepped daily. This is the fairest way to show consistency and is heavily used in Indian MF analysis. Visual: a line of rolling 1Y return over time, with a horizontal zero rule; plus a distribution strip (histogram or box plot) summarizing `% of windows positive`, median, min, max.
- **Volatility** — annualized standard deviation of daily/monthly returns (`σ_daily × √252`). Visual: a figure plus a rolling-30d volatility line.
- **Sharpe ratio** — `(R_portfolio − R_f)/σ`. Set `R_f` from the Indian 10Y G-Sec or 91-day T-bill, make the assumed rate visible and editable in settings, and show it in the tooltip — an unstated risk-free rate makes Sharpe unfalsifiable. Visual: a figure; optionally a risk/return scatter (σ on x, return on y) plotting each holding plus the portfolio and the benchmark — one of the highest-value charts in the whole app.
- **Beta vs NIFTY 50** and **max drawdown** round out a "Risk" card of 4 figures.

### 4.5 Income
- **Dividend / payout calendar** — a month × year heatmap-calendar of received income, cell intensity by amount, plus a forward-looking list of announced ex-dates and record dates in the next 90 days.
- **Yield on cost** — `annual income / original invested cost` per holding (contrast with current yield = `annual income / current market value`). Show both columns; YoC is the one long-term holders care about. Visual: table columns + a scatter of YoC vs holding period.
- **Income trend** — monthly bar chart of dividends/interest/FD payouts, stacked by source type, with a 12-month trailing line overlaid.

### 4.6 P&L and tax
- **Realized vs unrealized P&L** — two clearly separated figures; never add them into one "total P&L" without labelling. Visual: a stacked bar per FY (realized STCG, realized LTCG, unrealized), plus a table by instrument.
- **Tax lots** — every buy is a lot with date, quantity, cost, and a derived holding period. Matching method must be explicit in the UI (**FIFO is mandatory for Indian equity/MF**; show it as a locked label, not a user choice). Visual: within the row-expansion panel, a lot table with a holding-period progress bar per lot and a bucket badge.
- **STCG/LTCG bucketing (FY 2025-26 / FY 2026-27 rules):**
  - *Listed equity & equity-oriented MF (≥65% domestic equity):* **> 12 months = LTCG @ 12.5%**, with the first **₹1,25,000** of LTCG per financial year exempt; **≤ 12 months = STCG @ 20%** ([MProfit ready reckoner](https://www.mprofit.in/blog/2026/07/capital-gains-tax-ready-reckoner-fy-2025-26/), [Finnovate FY 2025-26](https://www.finnovate.in/learn/blog/mutual-fund-taxation-india-fy-2025-26), [INDmoney](https://www.indmoney.com/learn/mutual-funds/taxation-rules)).
  - *Debt mutual funds purchased on/after 1 Apr 2023:* gains taxed at **slab rate regardless of holding period** (no LTCG benefit).
  - *Debt MF units purchased before 1 Apr 2023 and sold after 23 Jul 2024:* **> 24 months = LTCG @ 12.5% without indexation**; otherwise slab.
  - *Hybrid funds:* bucket by actual equity exposure (≥65% → equity rules; 35–65% → 24-month threshold; <35% → debt rules). Sources disagree here — store the fund's equity allocation and the rule applied, and surface it in the tooltip.
  - *Other assets (gold, property, unlisted):* 24-month threshold, 12.5% LTCG without indexation.
  - **UI consequences:** a `holding period` column with a badge (`STCG` amber / `LTCG` neutral-green / `LTCG in 47 days` with a progress bar); a **"Tax harvesting" view** showing (a) unrealized LTCG headroom against the remaining ₹1.25L exemption for the current FY, and (b) unrealized losses available to offset. Every tax figure carries a persistent disclaimer: *indicative, not tax advice; verify against the Finance Act.* Flag the rule-set version and effective date in the footer, since the Income Tax Act, 2025 renumbered sections from 1 Apr 2026.
- **Realized-gains statement** per FY, exportable as CSV/PDF, columns: instrument, ISIN, buy date, sell date, qty, cost, proceeds, gain, bucket, FY.

### 4.7 Cashflow, budget, savings
- **Cashflow waterfall** — opening balance → income bars (up, `--gain`) → expense bars (down, `--loss`) → closing balance, with connector lines and a running cumulative. Use for the monthly money story; cap at ~12 bars and roll the tail into "Other".
- **Budget vs actual variance** — per category: a bullet-style bar (actual as the bar, budget as a vertical target tick, pace-to-date as a lighter marker), right-aligned `₹ spent / ₹ budget` and a signed variance. Sort by largest overspend. Never use a dual-bar grouped chart; the bullet form is denser and reads faster.
- **Savings rate** — `(income − expenses)/income` per month. Visual: line or column with a 3-month moving average and a user-set target rule.
- **Net-worth trend with attribution** — the single most valuable chart in a net-worth app: decompose Δnet-worth into **net contributions** (deposits − withdrawals) and **market growth** (everything else). Visual: a stacked column per month (contribution in `--n-400`, growth in `--gain`/`--loss` by sign) with the cumulative net-worth line on the same panel (same axis, because both are ₹ — do not introduce a second axis). This answers "am I getting richer because I'm saving, or because markets went up?"
- **Loan amortization / payoff** — a stacked area over the loan term showing principal vs interest per EMI, with the outstanding-balance line; a payoff-date marker; and a prepayment what-if slider that redraws interest saved and months saved as two deltas. Table view of the schedule with sticky header and a "jump to today's row" control.

---

## 5. Chart selection rules

### 5.1 Question → mark
| Question | Chart | Notes |
|---|---|---|
| How did value change over time? | Line (single series), area only when a single series and the baseline is zero | 1.5–2px stroke, no gradient fill, no point markers above ~40 points |
| How do I compare to an index? | Two rebased lines + difference band | Never dual axis |
| How much per discrete period? | Column | Dividends per month, contributions per month |
| What's it made of? | 100% horizontal stacked bar + table | Donut only for a single ≤6-slice top-level split |
| What's it made of, over time? | 100% stacked area | Monthly steps |
| Rank of items | Horizontal bar, sorted desc | Top holdings, biggest movers, category spend |
| Deviation from a target | Diverging bar centered at 0 | Allocation drift, budget variance |
| One actual vs one target | Bullet bar | Budget vs actual |
| Build-up / bridge | Waterfall | Cashflow, P&L attribution |
| Relationship of two numerics | Scatter | Risk/return, YoC vs holding period |
| Distribution | Histogram or box plot | Rolling-return windows |
| Density over 2 categorical dims | Heatmap | Dividend calendar, monthly returns grid (year × month) |
| Trend at a glance, inside a row | Sparkline | See 5.3 |
| Downside history | Inverted-fill area | Drawdown |

### 5.2 Avoid
- **Donut/pie overuse** — more than ~6 slices, nested rings, or any pie used to compare magnitudes across time. Humans compare angles poorly; a sorted bar always wins.
- **Dual y-axes** — the correlation is an artifact of axis scaling. Instead: rebase both series to 100, use an indexed ratio, or stack two small-multiple panels sharing an x-axis.
- **3D, bevels, shadows, gradients on data marks** — all distort magnitude.
- **Truncated y-axis on bar charts** (bars encode length from zero; truncation lies). Line charts *may* truncate, but must show the axis values clearly.
- **Spaghetti line charts** — more than 5 series. Use small multiples.
- **Animated transitions on load** for financial figures; disable entirely under `prefers-reduced-motion`.
- **Rainbow / sequential-as-categorical palettes.** Categorical series use a 6-color qualitative ramp distinct from gain/loss hues; sequential (heatmaps) use a single-hue ramp; diverging (drift, variance) use the gain↔loss ramp through a neutral mid.

### 5.3 Small multiples, sparklines, annotations
- **Small multiples** — identical scales, 3–4 across, 120×80px each, shared y-axis range so panels are comparable, one-line title, no legend. Use for: per-sector performance, per-platform XIRR, each holding's 1Y shape.
- **Sparklines in tables** — 72×20px, 1.25px stroke, no axes, no labels, one end dot colored by sign over the period, optional faint zero/entry rule. All sparklines in a column must share a **consistent normalization rule** (percent change over the same window), otherwise they are not comparable — state the window in the column header (`90d trend`).
- **Event annotation** — vertical dashed rules on price/value charts for: buys (▲, `--accent`), sells (▼, `--n-500`), dividends (•), splits/bonuses (⌥ marker, with a note saying whether prices are split-adjusted — critical here, since this app ingests prices only and the user logs corporate actions separately; a double-adjustment warning belongs in the tooltip). Annotations are toggleable as a layer. Hovering an annotation shows a compact card with date, action, qty, price.
- **Tooltips/crosshair** — one shared vertical crosshair, a single tooltip listing all series at that x, values right-aligned and tnum, date in the header. Snap to data points. Keyboard-reachable via arrow keys when the chart has focus.
- Always pair a chart with the numbers: either a value-at-cursor readout in the chart header or an adjacent table. A chart with no readable numbers fails this product's register.

---

## 6. Indian-market specifics

### 6.1 ₹ formatting
- Use `Intl.NumberFormat('en-IN', …)`, which applies the Indian 3-then-2s grouping natively: `123456.789` → `1,23,456.789` ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)); 1,00,000 = one lakh, 1,00,00,000 = one crore ([IBM CLDR locale notes](https://public.dhe.ibm.com/software/globalization/documents/India-Tamil_Currency.pdf)). Western grouping is not offered for `en-IN` and should not be emulated ([TC39 discussion](https://github.com/tc39/proposal-intl-numberformat-v3/issues/3)).
- INR defaults to 2 fraction digits from its ISO-4217 minor unit; override explicitly rather than relying on defaults.
- **When to abbreviate (L / Cr):**
  - **Full digits with grouping** in: all table cells, transaction amounts, forms, exports, statements, tax figures, anything the user may reconcile against a broker contract note. `₹12,45,678`.
  - **Abbreviated** in: KPI tile primary values above ₹1 crore, chart axis ticks, chart data labels, tight mobile layouts, group subtotals when the column is narrow. `₹1.25 Cr`, `₹8.42 L`.
  - **Thresholds:** `< ₹1,00,000` → full digits, 2 dp. `₹1,00,000 – ₹99,99,999` → `X.XX L` (2 dp). `≥ ₹1,00,00,000` → `X.XX Cr` (2 dp). Never mix units within one column or one chart axis — pick the unit from the column max and label it once in the header (`Value (₹ L)`).
  - Abbreviations are **`L`** and **`Cr`** (not "lac", not "lakhs", not "K"/"M"/"B" — those read as foreign in an Indian product). `K` may appear only in chart axes below ₹1 L if the designer prefers; recommend `₹` + plain grouped digits there instead.
  - Every abbreviated figure must expose the exact value on hover/focus via `title` or tooltip, and copy-to-clipboard must yield the exact value.
- Negative money: `−₹12,340` (U+2212, symbol inside the sign) — not parentheses, which Indian retail users read less fluently than accountants do. Offer an accounting-parentheses setting for power users.
- Percentages: always signed for change (`+2.14%`, `−0.87%`), unsigned for weights (`14.2%`). `pp` suffix when expressing a difference of two percentages.

### 6.2 Indian financial year
- FY runs **1 April – 31 March**, labelled `FY 2026-27` (and `AY 2027-28` where assessment year matters, e.g. tax reports). Quarters: Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar.
- FY is the **default grouping** for tax, realized gains, dividend income and capital-gains statements; calendar year is secondary and must never be the silent default anywhere money meets tax.
- Date display: `19 Oct 2026` (day-first) in UI, `DD-MM-YYYY` where compact, ISO-8601 in exports and machine fields. Times in **IST** with the zone shown on market-sensitive stamps (`15:30 IST`).
- Market-hours awareness: NSE/BSE equity 09:15–15:30 IST Mon–Fri; show a `Markets closed` chip and freeze "Today's change" against the last session's close outside those hours; respect the exchange holiday calendar.

### 6.3 Capital-gains rules (display rules; see §4.6 for the full table)
Holding-period thresholds the UI must encode: listed equity & equity-oriented MF **12 months**; debt MF bought ≥ 1 Apr 2023 **n/a (slab always)**; other capital assets incl. gold, property, unlisted shares, pre-Apr-2023 debt units **24 months**. LTCG rate 12.5% (no indexation); equity LTCG exemption ₹1,25,000 per FY, resetting each FY; equity STCG 20%. Verify against the Finance Act / Income Tax Department before any figure is presented as authoritative — all cited sources are secondary ([MProfit](https://www.mprofit.in/blog/2026/07/capital-gains-tax-ready-reckoner-fy-2025-26/), [Finnovate](https://www.finnovate.in/learn/blog/mutual-fund-taxation-india-fy-2025-26), [INDmoney](https://www.indmoney.com/learn/mutual-funds/taxation-rules), [StableMoney](https://stablemoney.in/blog/long-term-capital-gain-tax-on-mutual-funds-2025-26)).

### 6.4 Symbol & instrument display conventions
- Primary form: **trading symbol in uppercase + exchange chip**: `RELIANCE` `NSE`. Exchange chip is 11px, `--fg-muted`, bordered, never colored.
- Yahoo-style suffixes (`.NS`, `.BO`) are *data-source artifacts* — strip them from display, keep them in the data layer; show them only in a "data source" detail line.
- BSE scrip codes (6-digit, e.g. `500325`) are shown as secondary metadata, not as the primary identifier.
- **ISIN** (e.g. `INE002A01018`) is the canonical join key and should be visible on the entity page in mono, copyable — it is what broker statements and CAS use.
- Mutual funds: display the **full scheme name including plan and option** (`Parag Parikh Flexi Cap Fund — Direct Growth`), because Direct vs Regular and Growth vs IDCW change the numbers materially; truncate in tables with the full name in the tooltip. Carry the **AMFI scheme code** as the join key; show NAV at 4 dp and units at 3–4 dp.
- Series/segment badges where relevant: `EQ`, `BE`, `SME`, `ETF`, `REIT`, `InvIT`, `SGB`, `T2T`.
- Row identity in tables: symbol (600 weight) on line 1, company/scheme name (12px `--fg-muted`) on line 2 — a two-line cell is worth the vertical cost in the name column only.

---

## 7. Accessibility & responsiveness

### 7.1 Contrast (WCAG 2.2 AA minimum; target AAA for body text)
- Body and table text ≥ **4.5:1**; `text-kpi` and headings ≥ 3:1 (large text) but the tokens above exceed 4.5:1 anyway. `--fg-muted` must stay ≥ 4.5:1 against its own surface — verify `--n-500` on `--n-50` and `--n-400` on `--n-900`.
- Non-text UI (borders of inputs, chart strokes, focus indicators, icon-only controls) ≥ **3:1** (WCAG 1.4.11). `--border` at 1.3:1 is decorative-only and is therefore never the sole indicator of an input's boundary — form controls use `--border-strong`.
- Gain/loss must be distinguishable without color: sign character always, direction glyph optional, and the underlying number present.
- Chart series must be distinguishable by more than hue: stroke dash patterns, direct labels at line ends (preferred over legends), and distinct marker shapes in scatters.
- Support `prefers-contrast: more` by swapping `--border` → `--border-strong` and raising `--fg-muted` one step.
- Validate every token pair with an automated contrast check in CI. ([WCAG 2.2](https://www.w3.org/TR/WCAG22/))

### 7.2 Focus & keyboard
- Focus indicator: **2px solid `--accent` outline with 2px offset**, plus a 1px inner light ring so it survives both themes. Never `outline: none` without a replacement. Must meet WCAG 2.2 SC 2.4.11 Focus Not Obscured — sticky headers/footers must not cover the focused row (scroll-padding on the scroll container equal to the sticky header height).
- **Table keyboard model** (grid pattern, `role="grid"`, roving tabindex):
  - `Tab` enters/exits the grid as one stop; arrows move between cells; `Home`/`End` row ends; `Ctrl+Home`/`Ctrl+End` table ends; `PageUp`/`PageDown` by viewport.
  - `Enter` on a row = expand/open; `Space` = toggle row selection; `Shift+↑/↓` = extend selection.
  - Header cells are focusable: `Enter` sorts, `Shift+Enter` adds a sort key, `Alt+↓` opens the column menu.
  - `/` focuses table search; `Esc` clears the active filter chip or exits the grid.
  - Sortable headers expose `aria-sort`; the row count and filter result changes announce via a polite live region (`Showing 37 of 214 rows`).
- Virtualized rows must set `aria-rowcount`/`aria-rowindex` on the full dataset, not the rendered window.
- Charts: focusable container with a text alternative (`aria-label` summarizing trend + range + endpoints), arrow-key traversal of data points announcing `date, value`, and a "View as table" toggle on every chart. Provide `<figcaption>`-style captions.
- Skip link to main content and to the table body.

### 7.3 Responsive degradation of dense tables
Breakpoints: `≥1440` full, `1024–1439` reduced column set, `768–1023` tablet, `<768` mobile.
- **≥1024:** all columns; horizontal scroll with sticky first column rather than hiding data.
- **768–1023:** drop to a prescribed "essential" column set per table (holdings: Name/Symbol, Value, Day Δ%, Unrealized P&L%); the rest remain available via the Columns popover and horizontal scroll.
- **<768:** convert each row to a **two-column summary card** (not a horizontally scrolling table, and not a label:value stack which doubles height):
  - Line 1: symbol/name (600) — right: current value (600, tnum).
  - Line 2: secondary identity (sector/platform, `--fg-muted`) — right: signed P&L + % colored.
  - Line 3 (optional, dense): qty × avg cost — right: day change.
  - Tap opens the full detail sheet with every field. Cards are 72–84px tall, separated by 1px rules, virtualized.
  - Sort/filter/density move into a bottom sheet triggered by a sticky toolbar; the active-filter chips remain visible as a horizontally scrolling strip.
  - Keep the totals row as a **sticky bottom bar** on mobile — it is the most-wanted number.
- Charts on mobile: reduce to one series + benchmark, drop gridlines to 3 ticks, replace hover with tap-and-drag scrubbing, and always show the value-at-cursor readout above the chart.
- Minimum touch target 44×44px (row actions become a single overflow button on mobile). Respect `prefers-reduced-motion` everywhere. Never require horizontal scrolling of the *page* (WCAG 1.4.10 Reflow at 320px).

---

## Decisions and constraints (for the design agent)
- One accent (indigo). Green and red are reserved for P&L semantics and must never be used for generic success/error chrome.
- Borders over shadows; radius ≤ 8px; motion ≈ 0.
- Tabular numerals everywhere numbers stack; right-align all numerics.
- Default density = Compact (32px rows); density is a user setting, not a theme difference.
- Indian FY is a first-class time range; full-digit ₹ in tables, L/Cr only in KPIs and chart axes.
- Show XIRR (money-weighted) as the headline return and TWR for benchmark comparison; label both.
- Every chart must be paired with readable numbers and a "view as table" affordance.
- Market data is prices-only in this product; corporate actions are user-logged, so every adjusted series needs an explicit "split-adjusted?" indicator to avoid double-adjustment confusion.
- Tax figures are indicative and must carry a visible disclaimer plus a rule-set effective date.

## Open questions for the Coordinator
1. Is a target-allocation model stored per user? The drift chart and the rebalance view depend on it.
2. Is there a benchmark price series available (NIFTY 50/500) under the free/keyless market-data constraint? §3.4 and §4.4 assume one; if not, benchmark comparison must be deferred and the dashboard composition in §3.6 adjusted.
3. Does the data model carry ISIN and AMFI scheme code as first-class keys (needed for §6.4 display conventions)?
4. Are budgets/loans in scope for v2's dashboard, or portfolio-only? §3.2 tile 6 branches on this.
5. Chart library choice (Recharts / visx / ECharts / uPlot) — uPlot or ECharts are the realistic options if dense time series with 10k+ points are expected; this affects what §5 can specify.

## Handoffs
### Research Agent -> Planner/Implementer (Design)
```markdown
## Baton: Research Agent (external patterns) -> Design/Planner
- Goal: a professional, institutional-grade visual + interaction language for Stock-Mania v2.
- Completed: design-research brief covering visual tokens, table craft, dashboard composition, analytics catalogue, chart rules, Indian-market formatting, a11y/responsive rules.
- Decisions: borders-over-shadows; single indigo accent; CVD-safe teal-green/orange-red P&L pair; Inter + tnum; Compact 32px default density; Indian FY as a first-class range; XIRR headline + TWR for benchmarks.
- Inputs: this file; `_architecture/30-CALCULATIONS.md` for the authoritative return/tax math.
- Changed files: `_architecture/requirements/ui-redesign-v2-design-research.md` (new).
- Contract/output: the token table in §1.4 and the table-primitive spec in §2 are the contract; components should reference semantic aliases only.
- Verification: none runnable (research lane). External claims cited; tax and locale claims are secondary sources and flagged for verification.
- Open risks: tax rules cited from blogs, not statute; benchmark data availability unknown under the keyless-sources constraint; search returned thin authoritative material on 2025-26 dashboard UX, so §1.1 rests on product observation plus judgement.
- Next action: Coordinator answers the five open questions, then a Design/Planner agent turns §1.4 into a token file and §2 into a table-primitive spec.
- Do not revisit: palette hue selection, density default, borders-vs-shadows — settled unless a contrast test fails.
```

## QA record
Status: NOT_RUN
Evidence:
- Research lane; no commands run.
Residual risks:
- Indian capital-gains figures cited from secondary sources; must be verified against the Finance Act / Income Tax Department before any user-facing tax number ships.
- Contrast ratios quoted in §1.4 are computed from the stated hex values and should be re-verified by an automated checker in CI.

## Sources
- [Lazarev — Financial dashboard design: how strategic UX strengthens fintech products](https://www.lazarev.agency/articles/financial-dashboard-design)
- [Deeflect — Data tables are the hardest UI problem nobody talks about](https://blog.deeflect.com/valk-06-data-tables-hardest-problem/)
- [AdminLTE — Fintech dashboard design examples](https://adminlte.io/blog/fintech-dashboard-design-examples/)
- [G2 — Koyfin reviews](https://www.g2.com/products/koyfin/reviews)
- [G2 — FactSet Workstation vs Koyfin](https://www.g2.com/compare/factset-workstation-vs-koyfin)
- [TheCFOClub — Kubera review](https://thecfoclub.com/fr/tools/avis-logiciel-kubera/)
- [MProfit — Capital gains tax ready reckoner FY 2025-26](https://www.mprofit.in/blog/2026/07/capital-gains-tax-ready-reckoner-fy-2025-26/)
- [Finnovate — Mutual fund taxation in India FY 2025-26](https://www.finnovate.in/learn/blog/mutual-fund-taxation-india-fy-2025-26)
- [Finnovate — Debt fund taxation in India](https://www.finnovate.in/learn/blog/debt-fund-taxation-india-fair-treatment)
- [INDmoney — Mutual fund taxation rules](https://www.indmoney.com/learn/mutual-funds/taxation-rules)
- [StableMoney — LTCG on mutual funds 2025-26](https://stablemoney.in/blog/long-term-capital-gain-tax-on-mutual-funds-2025-26)
- [MDN — Intl.NumberFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)
- [IBM — India locale currency and grouping](https://public.dhe.ibm.com/software/globalization/documents/India-Tamil_Currency.pdf)
- [TC39 — Intl.NumberFormat v3, Indian grouping discussion](https://github.com/tc39/proposal-intl-numberformat-v3/issues/3)
- [W3C — WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [W3C — ARIA Authoring Practices: Grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)

---

## Density and analytics depth — design research 2026-10-24

Lane: **research only**. No production code, no mockups, nothing staged. Author: Claude
(design research agent). Scope: the owner's third "ordinary / basic" verdict, the
"TickerTape" and "nerdy dashboard" comparison, and whether the deficit is polish or depth.

### 0. Method, and what I could and could not verify

I had `WebFetch` and `WebSearch` but **no browser, no screenshot tool and no logged-in
session**. Every claim below is tagged:

- **[V]** — verified: I fetched the page on 2026-10-24 and the figures below are what came
  back in the rendered text.
- **[D]** — documentation: the vendor's own help/marketing page, not the live product.
- **[P]** — prior knowledge only. **Weakest tier. Treat as a hypothesis, not evidence.**
- **[M]** — measured by me from this repository's own files, reproducible by the commands
  given.

| Reference product | Access result |
|---|---|
| **Screener.in** (`/company/ITC/consolidated/`) | **[V]** full page, real figures. Peer table was lazy-loading — **not verified** |
| **Tickertape** (`/stocks/itc-ITC`) | **[V]** server-rendered, real figures across 8 tabs. Pro-gated fields returned blank — noted inline |
| **Trendlyne** (`/equity/.../`) | **[V] partial only.** Hit the DVM view quota — two of three scores returned `- / 100`, financials and technicals showed "Loading". Treat Trendlyne as largely unverified |
| **Portfolio Visualizer** (`/backtest-portfolio`) | **[V]** results page with the real metric tables |
| **Koyfin** | **[D] only** (help centre, portfolio-tools page). The app itself is behind login |
| **Monarch** | **Not verified.** `monarchmoney.com/features/reports` 301s to `monarch.com/features/reports`, which returns **404** |
| **YNAB** | **Not attempted** after the Monarch failure; no verified observation offered |
| **Morningstar** | **Not attempted.** No verified observation offered |
| **Bloomberg Terminal** | **Could not verify any density figure.** Student guides confirm only the 4-panel layout. The oft-repeated "thousands of data points per screen" style claim has **no source I could trace** — I am not repeating it |

**Design literature** is cited by source, not paraphrased as fact. I could not open
Tufte's "Sparkline theory and practice" forum post — the old `bboard` URL 301s to a
notes index that lists the post but not its body, and the slugged URL 404s. I therefore
cite *Beautiful Evidence* (2006) by its published definition only and **do not** attribute
specific pixel dimensions to Tufte.

---

### 1. The hypothesis is half right, and it is pointed at the wrong screen

The brief's hypothesis was that waves 1 and 2 optimised for refinement when the owner
wanted density. **[M] Measuring this repository's own mockups shows that is true of the
dashboard and false of the investments table.**

Reproduce:

```bash
python - <<'PY'
import re
for f in ['_design/institutional-shell/index.html','_design/investments/index.html']:
    s=open(f,encoding='utf8').read()
    for i,m in enumerate(re.finditer(r'<thead.*?</thead>',s,re.S)):
        ths=re.findall(r'<th\b.*?>(.*?)</th>',m.group(),re.S)
        print(f,i,len(ths))
PY
grep -oic percentile _design/*/index.html
```

**[M] What the numbers say:**

| Surface | Fields per row | Verdict |
|---|---|---|
| `institutional-shell` → Holdings panel (the screen the verdict was given on) | **4** — Holding, Units, Market value, Unrealised | Sparse |
| `investments` → `COLS` array (line 935) | **16 data columns** across header groups Position / Cost / Market / P&L / Returns, incl. a `90d trend` sparkline column, plus 2 fixed control columns, plus a Columns chooser | **Already near Tickertape column count** |
| `investments` → disposals table | **12** | Dense |
| `investments` → lots table | **9** | Dense |
| `banking-console` → monthly history | **6** (Month, Money in, Money out, Net, Savings rate, Net worth) | Thin |

**[M] The dashboard carries roughly 85 discrete figures** excluding sparkline vertices
(6 KPI tiles × [value + delta] = 12, allocation panel 5×5 = 25, the books `dl` 6, the
return `dl` 4, holdings 12 rows × 4 = 48), or **~165 if the five 12-point sparklines are
counted vertex by vertex**. For a product whose reference point is Screener.in, that is
low.

**So the honest finding is a correction to the hypothesis, not a confirmation:**

> The problem is **not** that the product lacks columns. The investments table already has
> 16. The problem is that **not one figure anywhere in the product is placed against a
> reference value.** `grep -oic percentile _design/*/index.html` returns **0 for all nine
> mockups**. There is no sector percentile, no peer column, no own-5-year range, no
> distribution glyph, no "vs. your own median", anywhere.

That is what separates these mockups from Screener and Tickertape, and it is a different
deficit from density. A 16-column table of bare absolutes is still *ordinary*, because
every number answers "what" and none answers "**is that good?**". Tickertape's entire
product shape is the answer to that second question.

**Secondary finding, also [M]:** the sparkline is used **only inside KPI tiles**
(`.kpi .spark`, 30px, 12 points) and in the one `90d trend` investments column. The
dashboard contains **4 `<svg>` elements in 84 KB of markup**. There is no small-multiple
anywhere in the repository.

**[M] Third finding:** the personal-finance side is the thinnest of all.
`banking-console/index.html` contains **zero** occurrences of `recurring`,
`discretionary`, `seasonal`, `cohort`, `median`, `quartile`, or `sankey`. Its savings
analytics are a 2-line chart (monthly + 3-month moving average) and a 6-column table. The
owner asked for "analytics income, investment etc." — **income is the weakest surface in
the product**, and it got the least attention in both prior passes.

---

### 2. (A) Density targets from the reference products — verified counts

#### Screener.in, ITC consolidated page **[V]**

| Block | Count |
|---|---|
| Top summary ratios | **9** (Market Cap, Current Price, High/Low, Stock P/E, Book Value, Dividend Yield, ROCE, ROE, Face Value) |
| Quarterly Results | **11 rows × 13 period columns = 143 cells** (Jun 2023 → Jun 2026) |
| Profit & Loss | **12 rows × 13 columns = 156** (Mar 2015 → Mar 2026 + TTM) |
| Balance Sheet | **10 rows × 12 columns = 120** |
| Cash Flow | **6 rows × 12 = 72** |
| Ratios | **6 rows × 12 = 72** (Debtor Days, Inventory Days, Days Payable, Cash Conversion Cycle, Working Capital Days, ROCE %) |
| Growth blocks | **4 blocks × 4 windows = 16** (Compounded Sales Growth, Compounded Profit Growth, Stock Price CAGR, Return on Equity — each at 10y / 5y / 3y / TTM-or-1y) |
| Pros and Cons | 4 pros + 1 con, **machine-generated, labelled as such** |

**One page ≈ 580 numeric cells.** The salient structural facts, not the count:

1. **Every P&L row expands** — `Sales +`, `Expenses +`, `Other Income +`, `Net Profit +`,
   `Borrowings +` carry a `+` affordance that expands to component breakdown **in place**.
   That is the drill-down ladder: *summary row → expanded components → the segment page*.
   No navigation for the middle step.
2. **The growth block is the comparison device.** The same measure at 10y / 5y / 3y / TTM
   in one four-cell strip makes "is that good?" answerable against the company's own
   history without a second chart. **This is the cheapest high-value pattern found in the
   whole study** — four cells, no graphics, no colour.
3. **The pros/cons block states its own provenance** ("machine generated"). That matches
   this repo's existing honesty rules.

#### Tickertape, ITC **[V]**

| Block | Count |
|---|---|
| Tabs | **8** (Overview, Sentiment, Forecasts, Financials, Peers, Holdings, Events, News) |
| Scorecard | **6 categories** — Performance, Valuation, Growth, Profitability, Entry point, Red flags — each a short verdict (Low / High / Good) |
| Key Metrics | **6 tiles, and this is the critical observation: three are the stock's and three are its sector's.** PE 16.64 / PB 4.53 / Div Yield 5.50% sit **directly beside** Sector PE 33.79 / Sector PB 7.09 / Sector Div Yield 1.83% |
| Classification chips | **4** — Consumer Staples; FMCG-Tobacco; Monopoly; **Largecap with its rank (#24)**; **Low Risk with its number (1.64× Nifty volatility)** |
| Income statement | **16 rows × 10 columns** (FY2018–FY2026 + TTM) |
| Quarterly income | **10 rows × 10 quarters** |
| Cash flow | **7 rows × 10 years** |
| Insight cards | **4, each a paired comparison**: revenue growth 9.49% **vs industry 10.1%**; market share 93.01% → 85.71%; net income growth 9.47% **vs 10.21%**; FCF growth 8.78% **vs industry 8.44%** |
| Peer comparison | **4 rows × 3 tabs** (Valuation: PE/PB/DivYield · Forecast: Buy Reco%/Upside%/1Y Fwd EPS Growth · Technical: Volatility/RSI-14D/Price Momentum Rank) = **9 metrics behind a 3-way tab, not 9 columns** |
| Similar-stock cards | **5 peers × 3 fields** (PE, 1Y Return, Buy Reco %) |
| Mutual-fund holders | **5 rows × 5 fields** — Fund, Market-cap held, Weight, **3M holding change**, **Portfolio rank with its 3M delta** (e.g. "rank 5/281 (+1)") |
| FAQ returns strip | **7 windows** — 1W −2.31%, 1M −2.99%, 3M −8.32%, 6M −15.53%, 1Y −38.00%, 3Y −37.46%, 5Y +16.80% |

**The structural lesson from Tickertape is not count, it is pairing.** Observed four
separate times on one page: *stock metric beside sector metric*; *growth beside industry
growth*; *rank expressed as "24" and "5/281"*; *change expressed as a 3-month delta on a
rank*. Tickertape's "nerdiness" is **relative framing applied uniformly**, implemented
mostly in plain text, with almost no chart.

Note also: **the peer table is tabbed into three groups of three, not flattened into nine
columns.** The product the owner wants to resemble *limits* simultaneous columns and
spends the budget on comparison instead.

#### Trendlyne **[V, partial — quota-limited]**

Verified: **DVM = three named scores out of 100** (Durability / Valuation / Momentum), a
**single composite label** ("Falling Comet"), **SWOT as four counts** — Strengths 13,
Weakness 11, Opportunity 5, Threats 0 — and `35.62% Fall from 52W High` as a header-level
figure. Two of three DVM scores and the whole financials/technicals area were gated.
**I did not verify any per-ratio percentile on Trendlyne.** Do not design against it.

The transferable pattern verified: **a four-number SWOT strip and a "% fall from 52-week
high" header figure** are both one-line comparison devices requiring no chart.

#### Portfolio Visualizer **[V]** — the depth ceiling

- **Performance Summary: 13 metrics × N portfolios + benchmark column.** Start Balance,
  End Balance, Annualized Return (CAGR), Standard Deviation, Best Year, Worst Year,
  Maximum Drawdown, Sharpe, Sortino, **Active Return, Tracking Error, Information Ratio,
  Benchmark Correlation** — the last four exist *only* because a benchmark column exists.
- **Risk and Return Metrics: 31 rows**, including Arithmetic/Geometric Mean, Beta, Alpha
  (annualized), R², Treynor, Calmar, Modigliani–Modigliani, Skewness, Excess Kurtosis,
  Historical/Analytical/Conditional VaR (5%), Upside and Downside Capture Ratio, Safe
  Withdrawal Rate, Perpetual Withdrawal Rate, Positive Periods, Gain/Loss Ratio.
- **22 named result sections**, including Trailing Returns, Rolling Active Return, **Up vs.
  Down Market Performance**, **Historical Market Stress Periods**, per-portfolio Drawdowns
  tables, Monthly Correlations, **Portfolio Return Decomposition**, **Portfolio Risk
  Decomposition**, Annual Asset Returns, Rolling Returns.

**Inference [not verified]:** PV is the model for *depth by stacked sections* rather than
depth by wide rows. Its page is long, each section is narrow, and the user scrolls. This
is the cheapest density architecture to build and the easiest to keep accessible — it is
all plain tables. **Recommendation:** this, not Bloomberg, is the structural model for
Stock-Mania's Performance screen.

#### Koyfin **[D only]**

Help centre names **12 portfolio columns** — 4 user-input (Quantity, Average Cost/Share,
Purchase Date, My Price Target) and 8 calculated (Weight, Market Value, Total Cost, Total
Gain/Loss, Total Gain/Loss %, **Annualized (CAGR) Gain/Loss**, Gain/Loss Chg, **My Price
Target Difference %**). Columns are user-selectable and saved as a **named view**.
**[D]** The documented analysis feature is a "Weight Adjusted Sum" summary row. No
attribution/factor view is documented on that page.

Two patterns worth taking: **(a)** a user-entered target alongside an auto-computed
*difference from target* — comparison the user supplies themselves; **(b)** **saved column
sets as first-class named objects.** This repo's investments mockup has a Columns chooser
but **[M]** no saved-view concept.

#### Monarch, YNAB, Morningstar, Bloomberg

**No verified observation.** Monarch's reports page 404s after its own redirect; the others
I did not reach. I am deliberately not describing them from memory, since that is the
failure mode the brief named. **This is a real gap: the personal-finance half of question
A is unevidenced** and should be re-run by an agent with a browser or a logged-in session.

---

### 3. (B) Density without clutter — the craft, and what it costs here

#### Established technique, cited

- **Sparklines.** Tufte defines them in *Beautiful Evidence* (Graphics Press, 2006) as
  **"data-intense, design-simple, word-sized graphics."** The conventional sizing rule —
  a sparkline is about the height of the surrounding text — is attributed to Tufte's
  sparkline writing. **I could not open the primary forum post** (`bboard` URL 301s to an
  index without the body; the slugged URL 404s), so I cite only the published definition
  and **attribute no specific dimension to Tufte**. The repo's existing 30px / 1.5px
  stroke / end-dot spec is a house decision, not a Tufte one, and should stop being
  described as if it were.
- **Data-ink ratio** (Tufte, *The Visual Display of Quantitative Information*, 1983) is the
  governing principle for removing axes, gridlines and legends from in-cell graphics.
- **Bullet graph** (Stephen Few, Perceptual Edge, 2006/2010) is the canonical
  measure-plus-target-plus-qualitative-bands glyph and is the correct form for
  "value against its own range" in a single row of a table. It encodes a figure, a target
  marker and 2–3 background bands in one horizontal strip with no axis.
- **Small multiples** (Tufte, 1983/1990) is the correct form for "the same chart for every
  category" and is the single most under-used technique in this repository — **[M]** there
  is not one instance of it in nine mockups.
- **Tabular figures.** Already correct here: `font-variant-numeric: tabular-nums
  slashed-zero` is set on `.mono` in `_design/elevation-pass/index.html`, and the elevation
  pass moved every figure to IBM Plex Mono. **This is the one density prerequisite the
  project has already paid for and should now cash in**, because column-aligned digits are
  what makes a 16-column table readable at all.

#### What breaks at density — and the specific traps for this project

1. **Colour-coding past working memory.** The five-hue ramp (`--c1`…`--c5` + `--c-other`)
   is already at the practical ceiling for a categorical legend. **A small-multiple grid
   must not introduce a sixth hue.** Small multiples should be *monochrome and repeated*;
   the category is identified by its **position in the grid and its text label**, never by
   hue. This is also the mechanism by which small multiples usually smuggle colour-alone
   encoding back in — avoided by not colouring them at all.
2. **Legends.** A legend is a lookup table the eye has to traverse. At the density targeted
   here, direct labelling at the end of the series is the only defensible choice.
3. **Redundant axes.** 16 sparklines in a column must not each carry an axis. The column
   header carries the window once ("90d"); the cell carries nothing.
4. **Gridlines competing with data.** **[M] `--grid` measures 1.23:1 against the surface in
   both themes** — correctly faint. Leave it alone; it is below the data and must stay
   there.
5. **The emphasis-everywhere failure.** This is the real danger for Stock-Mania, because
   the existing tokens make it easy: if every gain cell is `--gain` green and every loss
   cell is `--loss` red, a 16-column × 12-row table is up to 190 coloured cells and the
   colour stops meaning anything. **The elevation pass's own ▲/▼-in-muted-ink decision is
   the correct rule and must be extended to the whole table**: direction is a glyph in body
   ink; the semantic colour is spent **only** on the row's single headline P&L cell, or not
   at all.
6. **[M] A measured, specific hazard.** Running a relative-luminance script over the chart
   tokens against `--bg-surface`:

   | Token | Light vs `#FFFFFF` | Dark vs `#13181D` |
   |---|---|---|
   | `--c1` `#5468D6` / `#8A7FE8` | **4.85** | **5.34** |
   | `--c2` `#1F94A8` / `#2FA3BA` | **3.58** | **6.01** |
   | `--c3` `#B5801F` / `#B68530` | **3.46** | **5.43** |
   | `--c4` `#A14C9E` / `#C76BA0` | **5.19** | **5.13** |
   | `--c5` `#4E7A3A` / `#6FA14E` | **5.04** | **5.85** |
   | **`--c-other` `#8C98A6` / `#64707E`** | **2.93 — FAILS 3:1** | 3.54 |
   | `--gain` `#0E7C66` / `#3FC9A6` | 5.13 | 8.60 |
   | `--loss` `#C0392B` / `#FF7A6B` | 5.44 | 7.01 |
   | `--warn` `#B45309` / `#F0B429` | 5.02 | 9.58 |
   | `--gain-line` `#8FD3C4` / `#1F6B5B` | **1.71 — fails** | **2.82 — fails** |
   | `--loss-line` `#EAA69E` / `#8A3C33` | **2.01 — fails** | **2.36 — fails** |
   | `--accent-line` `#A5B4FC` / `#4F62D8` | **1.99 — fails** | 3.46 |
   | `--grid` `#E4E8ED` / `#232A31` | 1.23 | 1.23 |

   Script: sRGB → linear (`v/12.92` below 0.03928, else `((v+0.055)/1.055)^2.4`),
   `L = .2126R + .7152G + .0722B`, ratio `(L₁+.05)/(L₂+.05)`.

   **This is a new, measured defect:** `--c-other` at **2.93:1 in light** is below the 3:1
   non-text floor and is exactly the token a dense chart reaches for most ("Other", the
   long tail). **It fails today, before any density work.** It should be referred to
   whoever owns the token set — it is the same class of error as the four corrections
   already recorded in `DESIGN.md` §1.2.

   The `*-line` tokens failing is **not** automatically a defect — see §6.

---

### 4. (C) What a nerdy *personal-finance* dashboard shows

This is the weakest-evidenced section, because Monarch 404'd and I did not reach YNAB or
Morningstar. What follows is **inference and recommendation from the methodology
literature**, clearly marked, not product observation.

#### Sankey for income → allocation — **recommend against, as the primary device**

**[V, weak]** The literature search found no study of Sankey diagrams for consumer cash
flow. What exists: an arXiv preprint comparing Sankey against tables for *engineering
simulation parameters*, reporting a 51% PURE-score reduction and 56% fewer interactions
(**engineers configuring models, not consumers reading finances — transfers only
loosely, and it is a preprint**); and blog-level criticism that Sankey labels clutter and
repeat redundantly. A widely-circulated "MIT found 40% cognitive-load reduction" claim
appears in search results **with no traceable citation and should not be used**.

**Recommendation.** A Sankey is a *one-period* diagram. The owner's question is
longitudinal — "is my savings rate improving?" — which a Sankey cannot answer. It also
collides with this repo's settled rules: node colouring is colour-alone encoding, curved
ribbons have no defensible border-vs-shadow treatment, and a many-category Indian expense
taxonomy produces unreadable node labels. **Offer it as one view among several, never as
the headline, and only above ~900px.** The headline for income → allocation should be a
**stacked bar per month with a savings-rate line** — which `banking-console` already
half-has.

#### The decompositions worth building — recommendation

These are the "nerdy" moves for the income side, in rough order of value per unit of work:

1. **Savings-rate decomposition into income change vs. expense change.** If the savings
   rate moved from 24% to 31%, the only interesting question is *which side moved*. Three
   figures: Δ from income, Δ from expense, residual (interaction term). **This is a
   three-cell strip, costs nothing visually, and is the single highest-value addition to
   the banking surface.** The interaction term must be shown, not silently absorbed —
   consistent with the house "an em-dash is an admission" stance.
2. **Recurring vs. discretionary split.** **[M] The word `recurring` appears zero times in
   `banking-console/index.html`.** This is the most load-bearing distinction in personal
   finance (it is what makes runway computable) and it is absent. It is also derivable
   from the existing keyword-categorisation system (see `MEMORY.md`, "Keyword not AI
   categorization") **without any AI**, by periodicity detection on merchant + amount.
3. **Rolling-window framing alongside calendar framing.** The repo has a 3-month moving
   average on savings rate and nothing else. Trailing-12-month versus financial-year is a
   real distinction in India (FY ends 31 March) and both should be offered as a toggle
   rather than one being assumed.
4. **Seasonality decomposition.** With an Indian expense series, festival months and the
   March tax-planning spike dominate. A month-of-year **small-multiple grid** (12 tiny
   panels, one per month, each showing that month across available years) is the
   established form, needs no colour, and is exactly the under-used technique from §3.
5. **Cohort / vintage views of spending.** **Recommend deferring.** Cohort analysis needs
   many entities; a single-user product has one. The analogous useful thing is a
   **category-vintage view** — for each category, spend by month since it first appeared —
   which is a small-multiple, not a cohort table.
6. **Net-worth attribution: contribution vs. market movement vs. FX.** **[V]** The method
   question is real and has a settled institutional answer:
   - **Karnosky–Singer** (1994, CFA Institute Research Foundation) separates *market
     attribution* from *currency attribution*, aggregating FX effects into a single
     currency-allocation term.
   - Mai (arXiv 2302.01010) decomposes PnL into FX-rate change, interest-rate change,
     carry, and residual, and **its Remark 1.1 explicitly states the FX/non-FX split
     depends on convention** (e.g. arithmetic averaging of start/end FX rates).
   - The practical implication, **my synthesis not a source's claim**: the split is
     **path-dependent**, so the UI must state the convention it used and carry a
     reconciling residual bucket. Showing "contribution / growth / FX" as three clean
     numbers that sum exactly, with no stated convention, would be a false precision — and
     this repo already refuses TWR for exactly this class of reason.

   **[M] The dashboard already has the shape for this** — `attribution()` stacks "value
   carried in / net contributions / market growth". **Adding FX as a fourth band, with its
   convention named and a residual row, is a small change with high nerd-value**, and it
   is the one place the product can beat Tickertape outright, since Tickertape has no
   multi-currency personal ledger.

---

### 5. (D) Progressive disclosure at density

**[V] Observed ladders, by product:**

| Product | Ladder |
|---|---|
| Screener.in | **In-place row expansion.** `Sales +` / `Expenses +` / `Borrowings +` expand to components **inside the same table**. Overview → expanded components → segment page = 3 levels, only the last navigates |
| Tickertape | **Tabs, 8 of them**, plus **tabbed sub-tables** (peer comparison = Valuation / Forecast / Technical). Overview → tab → sub-tab → "View more (2)" = up to 4 levels |
| Portfolio Visualizer | **No disclosure at all.** 22 sections, all expanded, user scrolls |
| Koyfin **[D]** | **Saved views** — column sets and summary templates saved as named objects |

**Synthesis [inference]:** the successful density architectures are *expand in place*,
*tab*, and *just scroll*. **Navigation to a detail page is the least-used of the four**,
and in Screener it is reserved for a genuinely different entity (a segment, a peer), not
for more detail on the same one. The existing mockups lean on page navigation, which is
the expensive choice.

**Accessibility hazards, specifically:**

1. **Hover-only reveal** fails WCAG 2.2 **1.4.13 Content on Hover or Focus** unless
   dismissible, hoverable and persistent, and is unavailable to touch entirely.
   **[M] This is already a live defect in the repo:** `institutional-shell/index.html`
   puts each KPI's explanation in a `title=` attribute on an `<i class="info-i">`, and
   investments puts the stale-price reason in `title=`. A `title` tooltip is not
   keyboard-reachable on a non-focusable element and is not announced reliably. **This is
   the exact mistake `DESIGN.md` §3 already forbids for the em-dash** (`tabindex="0"`,
   dotted underline) — the rule exists and is not being applied to `info-i`. Fix is
   mechanical: make it a real `<button>`.
2. **Colour-alone encoding** — covered in §3 and §6.
3. **Expandable rows** need `aria-expanded` on the control and the disclosed content
   associated with the row, not floating as an unlinked sibling — otherwise a screen
   reader loses the association.
4. **Keyboard nav in dense tables** — the repo already specifies the right model
   (`DESIGN.md` §6, Up/Down/Space/Ctrl+A/E/Del behind a text-input guard) and the W3C
   **ARIA APG Grid pattern** is already cited in this file's sources. **At 16+ columns,
   Left/Right cell navigation becomes mandatory, not optional** — row-only navigation in a
   16-column grid means a keyboard user cannot reach most cells.
5. **Saved views** are an accessibility *benefit*, not a hazard: a user who needs fewer
   columns can save a 6-column view permanently rather than re-configuring each visit.
   **Recommend promoting the existing Columns chooser to a named, saved view.**

---

### 6. (E) Reconciliation with settled decisions — where density conflicts

| Settled decision | Density-first verdict |
|---|---|
| **Borders over shadows; no gradients, glass, flourish** | **Keep, no conflict.** Density is adversarial to decoration anyway. A bullet graph and a sparkline are strokes and fills, not elevation |
| **4.5:1 text / 3:1 non-text, computed never estimated** | **Keep, with one new measured defect and one genuine tension — see below** |
| **32px / 34px compact row, controls bound to it** | **Keep, with a caveat.** A 34px row holds a 1.5px-stroke sparkline comfortably. **But a bullet graph needs ~10–12px of vertical strip**, which fits 34px only with ~11px of padding above and below. Workable, but tight — this must be prototyped, not assumed |
| **"An em-dash is an admission, a zero is a claim"** | **Keep — and density raises the stakes.** A 16-column table has 16 chances per row to fake a figure. **A sparkline has no em-dash form**: a partially-unavailable series must render as a *gapped* line, never an interpolated one, and the cell must carry the reason. **This is an unresolved design problem and should become a named task** |
| **`en-IN`, U+2212, lakh/crore** | **Keep, no conflict.** Compact forms (`₹48.72L`) are *more* valuable at density, not less |
| **No colour-alone encoding** | **Keep — and this is the main battleground.** See below |
| **Inter + IBM Plex Mono, Plex Mono carries every figure** | **Keep, and this is a density asset**, not a cost. Tabular figures are the precondition for a wide table |
| **Light and dark as equal citizens** | **Keep, and density doubles the verification cost.** Every new glyph needs both measurements, as in §3 |

#### The honest tensions, not waved away

**Tension 1 — do sparklines have to meet 3:1?** **[V]** W3C's *Understanding SC 1.4.11*
says the requirement covers **"Parts of graphics required to understand the content"**, and
states plainly that **"Not every graphical object needs to contrast with its surroundings."**
For a line graph: **"The lines should have 3:1 contrast against their background,"** while
lines with little overlap need not contrast with each other or with gridlines. There is a
further exemption where the information is available in another form.

**Conclusion, and it is favourable:** the **sparkline stroke itself must clear 3:1** — so
`--gain` (5.13 / 8.60) and `--loss` (5.44 / 7.01) are fine, and **`--gain-line` /
`--loss-line` at 1.71–2.82 must never be used as a stroke.** But a *reference band* behind
the stroke is a context layer whose value is also printed as text in the adjacent cell, and
is therefore exemptible as "available in another form". **That is the mechanism that makes
dense context affordable**: bands stay faint, strokes stay strong, and every banded figure
must carry its numeric form in the same row. **This exemption must be earned per instance,
not claimed globally** — if a band is the only way to read a value, it is required for
understanding and must clear 3:1.

**Tension 2 — colour-alone, and small multiples.** This is where the conflict is real.
The elevation pass correctly moved day-change to ▲/▼ glyphs. But a gain-coloured versus
loss-coloured **sparkline** is colour-alone encoding: there is no glyph on a line. Three
resolutions, in preference order:

1. **Do not tone the sparkline at all.** One ink for every sparkline in a column; the
   direction is already stated by the signed numeric delta in the neighbouring cell —
   which satisfies 1.4.1 outright, since the information is available non-chromatically.
   **Recommended.** It also removes the coloured-cell-saturation failure from §3.
2. If toning is wanted, pair it with a **terminal end-dot plus a visible baseline** so the
   sign is readable by position, not hue.
3. Never use hue to distinguish *series* inside one cell.

**Tension 3 — new measured defect.** `--c-other` at **2.93:1 in light** fails the 3:1
floor today. Not caused by density, but density is what will expose it.

**No decision in `DESIGN.md` or `MEMORY.md` needs to be overridden for a density-first
direction.** That is a genuinely useful result: the existing contract was written tightly
enough to survive the change of axis. The only additions it needs are a rule for the
unavailable-sparkline and a per-instance contrast-exemption procedure.

---

### 7. (F) The density target — countable

Recommendation. Every line is a number the next pass can be held to.

**Per table row (Holdings, the flagship):**

- **Minimum 12, target 16–18 visible fields**, in **4–5 named header groups**.
  **[M] The investments mockup already satisfies this at 16** — this is a *floor to defend*,
  not a stretch.
- **Exactly one micro-chart per row** (the 90d trend sparkline, 12–90 points, single ink,
  1.5px, end dot, no axis). **Not two.** A second in-cell graphic is where tables tip into
  clutter.
- **At least 2 of the visible fields must be comparative, not absolute** —
  currently **0**. Candidates: return vs. the portfolio's own median return; weight vs.
  target weight (drift already exists in the allocation table); vs. NIFTY over the same
  hold period (already exists in a separate table — pull it into the row).
- **At most 1 cell per row may carry semantic colour.** Everything else is ink + glyph.

**Per screen:**

| Screen | Current **[M]** | Target |
|---|---|---|
| Dashboard | ~85 figures excl. sparkline vertices; holdings row = **4 fields** | **≥ 200 figures**; holdings row **≥ 10 fields** (it is the same data — the dashboard is just hiding it) |
| Investments → Holdings | 16 columns, **0 comparative** | 16–18 columns, **≥ 2 comparative**, **+1 saved-view control** |
| Performance | **4** figures in a `dl` (XIRR, absolute, realised, max drawdown) | **≥ 13**, the Portfolio Visualizer Performance-Summary set minus what cannot be computed — each absent one an **em-dash with its reason**, which is itself a nerdy, honest surface |
| Banking → savings | 6-column table + 1 two-line chart | **+ savings-rate decomposition (3 cells)**, **+ recurring/discretionary split**, **+ a 12-panel month-of-year small multiple** |

**Beside every figure, one of these three must appear** (the Tickertape rule, §2):

1. its **own history** — the 4-window strip (10y / 5y / 3y / TTM, or the Indian-FY
   equivalent) is the cheapest form; or
2. a **peer / sector / benchmark** value in the adjacent cell; or
3. its **position in a range** — a bullet strip, or a single number of the
   "% from 52-week high" kind.

If a figure can carry none of the three, it is a candidate for removal from the primary
view.

**Drill-down: exactly 3 levels, and only the third navigates.**

1. **Row** — 16 fields + 1 sparkline.
2. **Expanded row, in place** — Screener's `+` pattern. Lots, charges, the
   contribution / growth / FX split for that holding. `aria-expanded` on the control.
3. **Detail page** — only for a different entity (an instrument, a platform, a category).
   It must carry **at least 3 things the list cannot**: the full price/valuation series, the
   complete event log (splits, dividends, corporate actions), and the comparative block
   (peer / sector / benchmark). A detail page that is the row re-laid-out is a wasted level.

**Saved views: ≥ 1 named, user-saved column set must ship with the holdings table.**

---

### 8. What I am least confident about

1. **The entire personal-finance half of question A is unevidenced.** Monarch 404'd;
   YNAB and Morningstar were not reached. §4 is methodology-derived inference, not product
   observation. **Re-run with a browser.**
2. **No Bloomberg density figure exists in this report** and none should be invented.
3. **Trendlyne is quota-gated**; the per-ratio-percentile pattern often attributed to it is
   **unverified by me**. The sector-comparison evidence in this report rests on
   **Tickertape's Key Metrics block, which I did verify.**
4. **Tufte's specific sparkline dimensions are not cited** because I could not open the
   primary post. Only the *Beautiful Evidence* definition is quoted.
5. **The 34px row vs. bullet-graph fit is arithmetic, not a rendering.** It needs a
   prototype. Per `_design/README.md` caveat 2, **no artifact in this repository has ever
   been inspected visually** — that gap now compounds, because density failures are
   overwhelmingly visual failures (label collision, wrap, crowding at narrow widths).
6. **The dashboard figure count** depends on whether sparkline vertices count. Both numbers
   are given; neither is a standard, and they should be compared like-for-like.
7. **Screener's peer-comparison table was lazy-loading** and its column count is unverified.

### 9. Sources

Fetched 2026-10-24:

- [Screener.in — ITC consolidated](https://www.screener.in/company/ITC/consolidated/)
- [Tickertape — ITC](https://www.tickertape.in/stocks/itc-ITC)
- [Trendlyne — equity page](https://trendlyne.com/equity/1055/ITC/itc-ltd/) (quota-limited)
- [Portfolio Visualizer — Backtest Portfolio](https://www.portfoliovisualizer.com/backtest-portfolio)
- [Koyfin — Portfolio Tools functionality](https://www.koyfin.com/help/portfolio-tools-functionality/) (documentation)
- [W3C — Understanding SC 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- [Wikipedia — Sparkline](https://en.wikipedia.org/wiki/Sparkline) (for the *Beautiful Evidence* citation)
- [Karnosky–Singer attribution — summary](https://flametree.notion.site/Karnosky-Singer-attribution-b6c18ea5d5c8422d99d83110be228dd9) and [CFA Institute Research Foundation, 1994](https://rpc.cfainstitute.org/-/media/documents/book/rf-publication/1994/rf-v1994-n3-4444-pdf.pdf)
- [Mai — PnL attribution with FX decomposition, arXiv 2302.01010](https://arxiv.org/abs/2302.01010v1)
- [Tables or Sankey Diagrams? (arXiv preprint 2601.10232)](https://arxiv.org/pdf/2601.10232)
- [freerangestats — Sankey plots can work, but need polishing](https://freerangestats.info/blog/2025/06/25/sankey-charts)
- [Bloomberg Terminal primer (student guide)](https://datacenter.safe-frankfurt.de/documents/Bloomberg_Terminal_primer.pdf)

Literature cited but not fetched (standard references):

- Tufte, E. *Beautiful Evidence*, Graphics Press, 2006 — sparkline definition.
- Tufte, E. *The Visual Display of Quantitative Information*, Graphics Press, 1983 —
  data-ink ratio, small multiples.
- Few, S. *Bullet Graph Design Specification*, Perceptual Edge, 2006/2010.

### 10. Baton

```markdown
## Baton: Design research (density) -> Coordinator
- Goal: test whether the third "ordinary" verdict is a density deficit, and set a countable target.
- Completed: measured all nine mockups; verified 4 reference products live; computed contrast for 16 chart tokens in both themes.
- Decisions: hypothesis is HALF right — the investments table is already 16 columns; the real deficit is that ZERO figures anywhere carry a comparative reference. The dashboard holdings row is 4 fields and is the sparse surface.
- Inputs: _design/institutional-shell/index.html (holdingsTable, kpis at line 759), _design/investments/index.html (COLS at line 935), _design/banking-console/index.html, DESIGN.md §1.2/§3/§8.
- Changed files: _architecture/requirements/ui-redesign-v2-design-research.md (this section only)
- Contract/output: the §7 density target.
- Verification: fetch results recorded in §0; contrast script in §3.
- Open risks: (1) NEW measured defect — `--c-other` #8C98A6 is 2.93:1 in light, below the 3:1 floor, failing today. (2) `info-i` uses title= for KPI explanations — not keyboard-reachable, violating DESIGN.md §3's own em-dash rule. (3) Personal-finance reference evidence missing (Monarch 404, YNAB/Morningstar not reached). (4) No surface has ever been seen rendered.
- Next action: owner picks a lane. If implementation — the two defects above are cheap, isolated fixes and should be split from the density work.
- Do not revisit: no settled DESIGN.md/MEMORY.md decision needs overriding for a density-first direction; that was checked item by item in §6.
```

---

## Analytics depth — investment surfaces (2026-10-24)

Lane: **design, no production code, nothing staged.** Author: Claude (design agent).
Scope: the investment side only — dashboard, holdings, and a single-holding detail page.
A second agent owns the income and savings surfaces in parallel; nothing here touches
them. Both passes lift the same `:root` and `.stage` After token block from
`_design/elevation-pass/index.html`, so the two cannot drift.

Artifact: **Stock-Mania Analytics Depth** — https://claude.ai/artifact/76Ft9Qama2js5s3zv9fMWU

### 1. What was built against the §7 target

Three screens behind a tab strip, plus a fourth tab that **counts itself**. The counts
below are produced by the page when that tab opens, not typed into it: a figure is a
maximal run of digits in a screen's rendered text, so sparkline vertices are excluded
(they are not text, and counting them would roughly double the dashboard number and mean
nothing).

| Measure | Target | Delivered |
|---|---|---|
| Fields per table row (Holdings) | 16–18, ≥ 2 comparative | **18 fields in 8 header groups, 3 comparative** |
| Micro-charts per row | exactly 1 | **1** — the 90d sparkline. The weight cell's progress bar was **removed** to get there |
| Semantically-coloured cells per row | at most 1 | **1** — unrealised P&L only |
| Drill-down levels | 3, only the third navigates | **3** — row → lots expanded in place (`aria-expanded`) → detail screen |
| Figures on the dashboard | ≥ 200 | **~275 counted** (was ~85) |
| Saved views | ≥ 1 | **7 named**, two of which exist only because the comparison columns do |

The dashboard holdings row went from **4 fields to 12**, which is the single largest
change: that row was the sparse surface the "ordinary" verdict was given on.

### 2. The comparison pattern adopted

**Three readings, in text, in the same row.** Every figure that can carry a reference
carries one of:

1. **its own history** — a four-window strip (7y / 5y / 3y / TTM), or a five-year median
   with the five-year range it moved in;
2. **a peer, sector or benchmark value** in the adjacent cell, with the difference printed
   as its own figure rather than left to be read off;
3. **its position in a range** — a rank with its denominator (`11 / 38`), or a drift
   against a target in percentage points.

A figure that can carry none of the three was a candidate for removal. That is why the
dashboard holdings row went to twelve fields and not to twenty.

Implementation notes that matter for the build:

- **Comparative cells are grouped and share one faint fill** (`--bg-sunken`), so the
  reference layer is findable without a second hue. They are **never** coloured by sign.
- The **four-window growth strip is the cheapest device in the whole study** — five rows
  of five cells, no graphics, no colour, and it answers "is that good?" against the
  company's own past with no second reference.
- Where a bullet strip appears (a ratio against its own 5-year range), **the low, high,
  median and value are all printed as text in the same row.** The strip adds no
  information the row does not state. That is what makes its exemption legitimate (§4).

### 3. Fundamentals, and the line that was not crossed

The detail screen has three entities behind a sub-tab, chosen to exercise the three rules
from the 2026-10-23 fundamentals research rather than to show one page three times:

- **RELIANCE** — non-financial (`INDAS_`) taxonomy. 12 ratios each read against own
  5-year median, own 5-year range, peer-set median and rank-with-denominator; the
  four-window growth strip; promoter holding and pledging over 8 of the 23 published
  quarters with the quarter-on-quarter change on its own row; five quarters of results.
  **Piotroski is shown as its nine itemised components and the total is an em-dash with
  its reason** — not a hidden field, a stated refusal.
- **HDFCBANK** — banking (`BANKING_`) taxonomy. Gross and net NPA, provision coverage,
  ROA, NIM, CET1, Tier 1, CAR, cost-to-income, CASA, each against own history and a
  21-bank peer distribution. **Debt-to-equity, EV/EBITDA and interest coverage are absent
  by design**, and the screen says so and says why: the app reads the filename prefix and
  the exchange's `bank` flag, so it never computes them. It does not keep a blocklist.
- **Parag Parikh Flexi Cap** — **a full refusal**. No results, no balance sheet, no cash
  flow; a NAV is a price. The page states that and shows the position instead. Expense
  ratio and portfolio overlap are em-dashes naming the per-AMC-PDF reason.

Every figure carries its **filing date, consolidated/standalone tag, audited flag and the
filer's own rounding**. Three refusals are stated on the screen with their evidence: **no
buy or sell call**, **no Beneish M-Score**, **no Altman distress probability**.

**Describe, never prescribe** survives in the copy. The closest the screens come to a
verdict is a rank with its denominator, and `DESIGN.md` §8 is honoured: no percentile
appears next to an action, and none appears without its dispersion.

### 4. Colour — one token changed, and it is the §3 defect fix

`--c-other` light `#8C98A6` measures **2.93:1** against `#FFFFFF` and fails the 3:1
non-text floor (the defect recorded above on 2026-10-24, task D.5). Replaced with
**`#7C8896`**:

| Ground | Ratio |
|---|---|
| `#FFFFFF` (`--bg-surface` light) | **3.61** |
| `#F6F8FA` (`--bg-canvas` light) | **3.39** |
| `#F2F5F8` (`--bg-subtle` light) | **3.30** |

The dark value `#64707E` is unchanged and already conformant: **3.54** on `#13181D`,
**3.78** on `#0C1014`, **3.25** on `#1A2026`. Computed with the sRGB→linear
relative-luminance formula (`v/12.92` below 0.03928, else `((v+0.055)/1.055)^2.4`;
`L = .2126R + .7152G + .0722B`; ratio `(L₁+.05)/(L₂+.05)`), not estimated.

**No other colour is new.** The bullet strip reuses existing tokens: band `--bg-active`,
median tick `--border-control` (3.42 light / 3.54 dark), value mark `--fg`.

**The contrast exemption, claimed once and recorded here** — per the §6 procedure. The
bullet strip's background band does not clear 3:1 and is not required to: the low, high,
median and value it encodes are all printed as text in the same row, so it falls under
*Understanding SC 1.4.11*'s clause for information available in another form. The two
**marks** are not exempt and both clear 3:1. **The exemption is not claimed for any
stroke** — the sparkline is drawn in `--fg-secondary`, which is body ink.

### 5. The two contract additions, applied

1. **The unavailable sparkline is a gapped line.** TATAMOTORS is stale by 10 days; its
   90-point series stops where the data stops and the remaining span is a dashed amber
   baseline, never an interpolated line. The `aria-label` says how many days are missing.
2. **Every em-dash is a focusable `<button>`** carrying its reason, and **every KPI
   explanation is a `<button aria-expanded>` with a real panel** — `title=` on a
   non-focusable element (task D.6) is not reproduced anywhere on these screens.

### 6. What was deliberately not changed

- **The token set.** Lifted verbatim, `:root` plus the `.stage` After values. No type
  size, spacing step, radius or border strength re-derived. The one change is the measured
  defect fix above.
- **The sixteen existing columns.** They were not the problem. Three comparative columns
  were added beside them; one graphic was *removed*.
- **The em-dash rule**, applied harder — 18 columns are 18 chances a row has to fake a
  figure.
- **Totals.** Derived at render time, never typed: the ten priced rows sum to exactly
  ₹14,18,156.70 against ₹12,84,185.50 invested, unrealised +₹1,33,971.20 (+10.43%), and
  the allocation buckets rebase to the same priced total.
- **Income, savings, cash flow** — out of scope, owned by the parallel agent.
- **Sankey** — not introduced. One-period diagram, longitudinal question.

### 7. What is unverified, and what I am least confident about

**No browser, no screenshot tool. This page has never been seen rendered.** The risks
follow directly from what it is, and they are in that order:

1. **Label crowding — the real risk.** Eight header groups over eighteen columns,
   uppercase labels with `.085em` tracking, and a 34px row holding a 12px bullet strip.
   The arithmetic fits. Whether it *reads* is exactly the thing I cannot check, and
   density failures are overwhelmingly visual failures.
2. **Narrow widths.** Wide tables each scroll in their own `overflow-x` container and the
   body should not scroll sideways, but the KPI strip, the comparison group and the
   masthead have not been watched reflow at ~400px.
3. **Dark theme.** Structurally covered — both palettes declared, every colour a token,
   no literal inside a `[data-theme]` block. Optical weight at this density is not: a
   faint band that reads on white may vanish on `#13181D`.
4. **The ratio, growth, F-score, promoter and quarterly figures are sample values**, not
   ingested data. They are shaped to the fields the 2026-10-23 research verified exist in
   the XBRL, but no parser has produced them.
5. **The peer-set medians and ranks assume a holdings-scoped peer set** (38 non-financial
   companies, 21 banks). That ingestion scope is the one the research recommends, but the
   mechanism for building a peer set — and therefore the honesty of a rank's denominator
   — is section E of the fundamentals research, which **was not completed**.

### 8. Baton

```markdown
## Baton: Design (analytics depth, investments) -> Coordinator
- Goal: answer the third "ordinary" verdict by adding the comparison layer the measurement found missing.
- Completed: one published artifact with Dashboard, Holdings and a single-holding detail page (3 entities: non-financial, bank, mutual fund), plus a self-counting Counts tab.
- Decisions: the pattern is "three readings in text in the same row" — own history, peer/benchmark, position in a range. Comparative cells grouped under one faint fill, never coloured by sign. Weight's progress bar removed so the row keeps exactly one micro-chart.
- Inputs: ui-redesign-v2-design-research.md §7 target; financial-health-scoring.md §A/§C/§D; DESIGN.md §8a/§1/§3/§5/§9; _design/elevation-pass/index.html tokens; _design/investments/index.html COLS and sample rows.
- Changed files: _architecture/requirements/ui-redesign-v2-design-research.md (this section only), artifacts.md (one row).
- Contract/output: 18 columns / 3 comparative / 1 micro-chart / 1 coloured cell / 3 drill-down levels / ~275 dashboard figures / 7 saved views.
- Verification: counts measured by the page itself, not claimed; contrast computed with the relative-luminance formula; totals derived at render time and reconcile to ₹14,18,156.70.
- Open risks: (1) nothing seen rendered — label crowding at 18 columns is the live risk. (2) --c-other is fixed here but still ships broken in the other eight mockups; that is a token-set task, not this one. (3) Peer-set construction (fundamentals research section E) is unresearched, so a rank's denominator is design-sample only.
- Next action: owner reviews the artifact; if accepted, the token fix and the info-button fix should be split out as cheap mechanical tasks across the other mockups.
- Do not revisit: the token set, the sixteen existing columns, and the refusals — each was checked item by item against the settled contract and none needed overriding.
```

---

## Analytics depth — income and standing (2026-10-24)

Lane: **design only**. No production code, nothing staged. Author: Claude (design agent,
income/savings/standing scope). A second design agent held the investment surfaces in
parallel; both passes lift the same `:root` block from `_design/elevation-pass/index.html`
so the two cannot drift.

**Deliverable:** [Stock-Mania Income & Standing](https://claude.ai/artifact/9PLGPtgzz7JZbJhRuc6LUr)
— three screens behind a tab strip (Income · Savings and cash flow · Standing), light/dark
control, real/nominal toggle, rolling-12m/FY toggle.

### What this answers

The §1 finding that `banking-console/index.html` contains zero occurrences of `recurring`,
`discretionary`, `seasonal`, `cohort`, `median` or `quartile`, and the product-wide finding
that `percentile` appears zero times across nine mockups. All six words now carry weight on
these screens, and percentile appears only where the settled construction allows it.

### Counts achieved against the §7 / DESIGN.md §8a target

| Measure | Target | Income | Savings | Standing |
|---|---|---|---|---|
| Fields per flagship table row | 16–18 | **18** | **18** | 8 |
| — of which comparative | ≥2 | **4** | **3** | 2 |
| Micro-charts per row | exactly 1 | **1** | **1** | 0 |
| Semantically-coloured cells per row | ≤1 | **1** | **1** | 0 |
| Drill-down levels | 3, only the 3rd navigates | **3** | **3** | 2 |
| Figures per screen (counted live from the DOM) | ≥200 main | **227** | **224** | 18 |
| Saved views | ≥1 | **3** | **2** | 0 |

Counts are rendered by the page itself from `document.querySelectorAll('.fig')`, excluding
figures inside a collapsed drill-down row and excluding sparkline vertices. Standing is a
judgement screen, not a table screen, and is deliberately not held to the 200-figure target —
refusing to compute is most of its content.

### The comparison pattern adopted

Plain text, almost no chart — the Tickertape move from §2. Every figure on a flagship row
sits beside one of three references:

1. **Its own history** — 12-month median, 12m low, 12m high, CV, and a delta against the
   FY25-26 monthly average, in one header group.
2. **A stated expectation** — `Δ vs expected`, which is the only cell on an income row
   permitted semantic colour. A stream with no promised amount shows an em-dash there, not
   a zero.
3. **Its position in a range** — a Few-style bullet strip with the median as the target
   marker, inside the expanded row where the 34px-row fit question does not bind.

### Analytics built

- **Savings-rate decomposition** as a five-cell strip: total move, income side, expense
  side, interaction, and a *Reconciles* cell that re-adds the three and shows it equals the
  total exactly. The interaction term is printed, never absorbed. Identity verified in
  node: `Δs = −3.387 pp = −0.459 (income) + −2.904 (expense) + −0.024 (interaction)`.
- **Recurring / discretionary / mixed** split, with **committed outgo as a first-class
  total** per month and per year. Mixed categories (groceries, transport) carry a committed
  floor and a free top, which is why the split is three-way and not two.
- **Quietly auto-renewing** — 15 lines with charge, period, next date, annual equivalent,
  last price rise and 90-day usage. The one metered line (electricity) is an em-dash in
  both amount columns and is excluded from the annual total rather than estimated into it.
- **Seasonality** as a 12-panel month-of-year small multiple, monochrome, one panel per
  calendar month, years as bars oldest-palest, hairline at the all-month median, index
  printed as a multiple. The month is identified by position and label, never by hue.
- **Rolling-12m against FY 2026-27** as a chrome-level toggle, not an assumption.
- **A missed inflow reads as missing.** Rent — Pune 2BHK has an expected ₹22,000 on 5 Oct
  and no matching credit: the row shows `Missing`, an em-dash with the reason, and is
  excluded from totals. Distinct from *nil this month* (a real zero, e.g. freelance with no
  invoice) and from *unread* (two Kotak statements never imported, which gaps the sparkline).
- **Cohort/vintage deferred**, per §4.5 — a single-user product has one entity. The
  category small multiple is the useful analogue and is what was built.

### Standing — matched to the settled construction, not re-derived

- Two scales only, **India and World**, PPP, drawn as bands on a 50–99 axis. India resolves
  to **"Top 10% — refuses to resolve further"**; the band is drawn wide above the 90th
  rather than narrowed for comfort.
- **Guess-first.** The placement block does not render until the owner sets a slider and
  presses Reveal; their guess is drawn on the same axis as a second marker.
- **Every move decomposed** — "percentile −2; your real income +3.1%; the distribution
  +6.0%". Percentile is never plotted as a time series.
- **Progression is log₂-ratio-to-median**, real terms by default, with the **Jan-2026 CPI
  base break drawn as a dashed rule and labelled spliced**. The reference is the HCES
  2023-24 urban MPCE ₹6,996 scaled to a stated household size — an assumption the owner can
  change, not a hidden one.
- **No celebrity rungs.** Five sourced anonymous archetypes, including the WIR 2026
  thresholds and the fact that US Census Table H-1 resolves only to the top 5%.
- **Scoring refuses.** Six pillars in three states — measured / declared-absent / unknown.
  Retirement funding is unknown (no EPF or NPS ever imported), so the **composite is not
  computed** and says which pillar is missing. Designed as a deliberate refused state with
  the five computable pillars shown in full beside it, not an error. Every pillar carries a
  coverage percentage, a sensitivity range and its threshold's source, with conventions
  labelled as conventions. No tier drop is celebrated; there is no streak, badge or
  leaderboard anywhere on the screen.

### Colour — no new colour, one alias, measured

`--c-other` `#8C98A6` is **2.93:1 on white** and fails the 3:1 non-text floor (D.5), and it
is the token a dense chart reaches for most. These screens do not use it. One alias was
added instead: `--spark` resolves to `--fg-muted` and carries every sparkline stroke, every
small-multiple bar and every "long tail" fill. Ratios computed from the hex values with the
sRGB→linear relative-luminance formula, not estimated:

| Pair | Measured |
|---|---|
| `--fg-muted #64707E` on `--bg-surface #FFFFFF` (light) | **4.96:1** — clears both the 3:1 non-text and the 4.5:1 text floor |
| `--fg-muted #8C98A6` on `--bg-surface #13181D` (dark) | **6.61:1** |

**One contrast exemption is claimed, per instance.** The percentile band fill
(`--accent-soft`) and the seasonality median hairline (`--grid`, 1.23:1) are context layers
whose values are also printed as text in the same block — the W3C 1.4.11 "available in
another form" clause. Strokes claim no exemption and do not need one.

### Defects not reproduced

- **D.6** — every KPI explanation is a focusable `<button>` opening a positioned popover
  with a source line, dismissible on Escape. No `title=` on a non-focusable element anywhere.
- **The unavailable sparkline** is drawn as a gapped path (two gaps, Jan–Feb 2026), never
  interpolated; its `aria-label` states how many months are missing.
- **Every em-dash is a `<button class="dash">`** with a dotted underline and its reason.
- **Bank marks** request `/api/logo/<id>` and fall back to a branded badge built from the
  provider's own two colours on error. In a static artifact that endpoint does not exist, so
  every mark rendered is the 404 fallback — which is the path worth checking. No
  approximation of a real mark is drawn.

### Reconciliation

Every total is summed from the rows at render time, verified in node:

- 8 stream TTM totals sum exactly to TTM income ₹30,10,495.
- 14 category TTM totals sum exactly to TTM outgo ₹18,07,738.
- Derived runway = ₹9.34L ÷ (TTM outgo ÷ 12) = **6.20 months**, matching the §6 sample
  figure rather than asserting it beside a contradicting total. One calibration constant on
  the expense bases does this and is named in a source comment.
- Savings rate 39.95%, against 43.34% twelve months earlier.

### What I deliberately did not change

The token block (lifted verbatim; the `--c-other` defect is routed around here, not fixed —
fixing it inside this artifact would fork the token set, and it belongs to whoever owns
tokens). Investment surfaces. The percentile construction. Sankey stays unused. Borders
over shadows, no gradient or glass.

### What is unverified

**No browser, no screenshot tool.** Nothing here has been seen rendered. In order of risk:

1. **The sticky two-row table header** — a group band above a column band with a hard-coded
   `top:26px` on the second row. Arithmetic, not a rendering, and the one failure that can
   occlude data rather than merely look wrong. **Least confident about this.**
2. **Narrow widths.** Both 19-column tables scroll inside their own containers, but the
   chrome carries five control groups on one row and clean wrapping near 400px is unconfirmed.
3. **Dark theme.** Every token has a dark value and no component uses a literal colour, but
   the small-multiple bar opacities (0.45–1.0 on `--fg-muted`) were chosen against the light
   ground; the palest year may fall below legibility on dark.
4. **The popover** near a right edge, or opened from inside a horizontally scrolled table.
5. **Label crowding** at 34px rows × 12.5px mono × 19 columns, and the 12-panel seasonality
   grid collapsing at phone width.

### Baton

```markdown
## Baton: Design (income/savings/standing) -> Coordinator
- Goal: design the income and savings analytics that did not exist, to the §7 countable target.
- Completed: one published artifact, three screens; 227 / 224 figures on the two main screens, 18 fields per flagship row with 4 and 3 comparative, 3 drill-down levels, 5 saved views; identities verified in node.
- Decisions: comparison is carried in plain text (own median / stated expectation / range position), not in new chart types. Percentile appears only on Standing and only as a band. The composite score refuses to compute while one pillar is unknown, and that refusal is a designed state rather than an error.
- Inputs: _design/elevation-pass/index.html (:root), _design/banking-console/index.html (composition only), DESIGN.md §1/§3/§5/§8a/§9, financial-health-scoring.md "Tier and percentile placement", ui-redesign-v2-research.md §6.
- Changed files: _architecture/requirements/ui-redesign-v2-design-research.md (this section), artifacts.md (one row). No production code. Nothing staged.
- Contract/output: https://claude.ai/artifact/9PLGPtgzz7JZbJhRuc6LUr
- Verification: node syntax check on the page script; the full render path executed under a DOM shim to count figures; the decomposition identity and both TTM reconciliations recomputed in node. No visual check was possible.
- Open risks: sticky two-row table header at density (highest); chrome wrapping at ~400px; small-multiple bar opacities on dark; popover placement near a right edge.
- Next action: an agent with a browser should open the artifact at 400px and at desktop width in both themes and report the header, the chrome row and the seasonality grid.
- Do not revisit: the token set, the percentile construction, and the decision against Sankey — all three were taken as settled and matched rather than re-derived.
```
