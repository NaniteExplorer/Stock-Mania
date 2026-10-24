# `_design/` — the mockups, as source

Updated: 2026-10-24

**Why this folder exists.** The v2 mockups are published Claude artifacts — private
pages on claude.ai. Claude can open them; **Codex cannot.** If the artifacts were the
handoff medium, one agent would be building from the real design and the other from a
prose description of it, and the two would diverge within a handful of screens.

So every artifact's **published source is mirrored here as a plain file**. Codex reads
HTML and CSS perfectly well — better, in fact, than it reads a description of them. The
exact token values, the exact control heights, the exact markup for every state are all
in these files, as text, in the repo.

| Folder | Artifact | Read it for |
|---|---|---|
| `control-bench/` | Control Bench | **The component library — start here.** Nine sections, every component in every state, both themes. This is the authority |
| `institutional-shell/` | Institutional Shell | App frame, navigation, page chrome, the dashboard |
| `banking-console/` | Banking Console | Accounts, statements, savings analytics. **Pre-dates the corrected token set — see the caveat below** |
| `statement-intake/` | Statement Intake | Import, parse review, balance reconciliation |
| `investments/` | Investments | Holdings, trades, lots, performance |
| `assets-debt-platforms/` | Assets, Debt & Platforms | Physical assets, loans, cards, platforms |
| `public-surfaces/` | Public Surfaces | Marketing, auth, unauthenticated pages |
| `mutation-model/` | Mutation Model | Edit / undo / redo / remove. `app.js` holds the working interaction logic |
| `elevation-pass/` | Elevation Pass | **The current visual direction.** Four screens with a Before/After toggle; the After tokens supersede the Institutional Shell's scales |

## How to use these files

**Read the CSS, not the prose.** The `:root` block in `control-bench/index.html` is the
real token set. If `DESIGN.md` and this file disagree on a value, **this file is right
and `DESIGN.md` is to be corrected** — the written document is a summary of these, and a
summary can drift.

**Scope correction (2026-10-24):** Control Bench governs component geometry and
corrected colours. The Elevation Pass `.stage[data-mode="after"]` governs its newer
page typography, spacing and structural border application, superseding Institutional
Shell scales only. D.1.s must integrate that direction into DESIGN.md before F.0;
the existence of the mockup does not complete the spec or resolve accessibility debt.

**Compose from `components/ui/`, never from these.** These are the reference, not a
source to copy-paste from. Phase F builds the component library once, from this
reference; every screen then composes from the library. Lifting markup out of a mockup
into a page file is exactly the drift the conformance check (task F.6) exists to catch.

**These are snapshots, not live.** They were pulled on 2026-10-23 at the versions noted
below. If an artifact is republished, **re-pull it** — do not hand-edit a file here, and
do not assume it is current.

| Folder | Version pulled | Bytes |
|---|---|---|
| `control-bench/` | 1792513763-fa39 | 195,569 |
| `institutional-shell/` | 1792524038-4abe | 83,993 |
| `banking-console/` | 1792524388-4569 | 174,615 |
| `statement-intake/` | 1792605146-2291 | 166,006 |
| `investments/` | 1792524378-fe9c | 159,291 |
| `assets-debt-platforms/` | 1792524243-7c4c | 145,836 |
| `public-surfaces/` | 1792524216-05b3 | 136,402 |
| `mutation-model/` | 1792606493-8bdc | 28,269 + 90,889 |
| `elevation-pass/` | 1792778862-328f | 48,056 |

Re-pull with the Artifact tool, `action: "read"`, the artifact URL from
[`../artifacts.md`](../artifacts.md), `path: "index.html"`, and this folder as `out_dir`.

## Caveats you must know before building from these

1. **`banking-console/` ships the pre-correction token set.** No `--border-control`, and
   `--border-strong` still failing 3:1. Build its *composition* from this file; take its
   *tokens* from `control-bench/`. Task D.1.b refits it.
2. **No artifact has been inspected visually.** No agent had a browser. Narrow widths,
   chart label crowding and dark-theme rendering are unverified by eye across all of
   them. Task D.3 covers this and is owned by a human or an agent with a browser.
3. **The elevation mockup has landed; its written specification is pending** (D.1.s).
   The 2026-10-23 handoff in CONVERSATION.md requires the After scales to be folded
   into DESIGN.md. **Do not start F.0 until D.1.s lands**; DOC-R1 only clarifies precedence.
4. **The debt-aggregates navigation placement is inconsistent between artifacts** and is
   unreconciled (task D.2). Do not pick one by eye — wait for the decision.
5. The sample figures in these mockups are the authoritative ones and they reconcile
   exactly. Do not substitute invented numbers when building.
