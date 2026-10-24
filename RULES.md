# Rules

Updated: 2026-10-22
Binding on every agent and every human contributor.

Nothing in this file is up for interpretation. A rule here is not a preference, a
default, or a starting point for discussion. If a rule is wrong, change the rule in a
separate commit with a reason — do not work around it.

---

## 1. Money and precision

1.1 **Money is `Money`** — bigint minor units. Quantity and rates are separate types.
1.2 **No `number` on any money path.** Enforced by types, by lint, and by a schema test.
A float in a financial calculation is a defect regardless of whether a test catches it.
1.3 **Percentages are `Percentage`.** Dates in the ledger are `CalendarDate`. Indian
financial years are `FinancialYear`.
1.4 **Display is `Intl.NumberFormat('en-IN')`** — lakh/crore grouping. Minus is **U+2212**,
not a hyphen.
1.5 **Derived, never stored.** Balances and valuations are computed from postings. A
stored aggregate is a second source of truth and will drift.

## 2. The ledger

2.1 **One multi-commodity double-entry ledger.** A grocery purchase and an equity buy are
the same object: a balanced set of postings.
2.2 **Transactions are append-only.** There is no `update`. Corrections go through
`Transaction.reverse()` and are saved as new rows.
2.3 **Nothing is hard-deleted.** Removal is a tombstone (invariant A03). Undo is
`restore()`, the inverse of `softDelete`.
2.4 **Reversing a reversal is blocked** — it makes the current state unreadable. Undo of
an edit tombstones the reversal *and* the replacement instead.
2.5 **Reconciled postings are immutable** (L10). A mutation that touches one is refused,
**with the reason shown**, never silently dropped.
2.6 **A posting carries a category or an instrument, never both** (L12). Any feature that
seems to need both needs a side table, not a second column.
2.7 **Invariants are enforced in constructors**, not by callers remembering to validate.
An unbalanced transaction cannot be constructed.
2.8 **Every derived number can name the rule or formula that produced it.**

## 3. Honesty of output

3.1 **An em-dash is an admission, a zero is a claim.** A number that cannot be computed
is an em-dash with a reachable reason. Never a zero. Never a silent default.
3.2 **Missing data has three states** — measured, explicitly-declared-absent, unknown —
and they are never collapsed.
3.3 **Every threshold and benchmark carries a primary source and a date**, visible in the
UI. A figure without a source does not ship.
3.4 **Never attribute a position to a regulator that the regulator has not taken.**
Specifically: RBI does not define FOIR; IRDAI has conducted no medical-inflation study;
no SEBI publication on gamification was found.
3.5 **Never state or imply an expected return**, express or implied.
3.6 **A model is labelled a model.** Depreciation rates, projections, percentile bands
above the 90th, and vendor-survey figures are each labelled as what they are.
3.7 **Refusal is a valid, finished outcome.** Refusing to compute, with the cause named,
is always preferable to a number that cannot be defended.

## 4. Data sources

4.1 **No paid APIs, no AI services.** Keyless free sources only.
4.2 **Transaction categorisation uses owner-maintained keywords. Never AI.**
4.3 **Market data is prices only** — never transactions, splits or dividends. The owner
logs those. Beware double split-adjustment.
4.4 **Two providers minimum per data need**, behind a capability-declaring interface.
4.5 **No source is load-bearing.** Every signal degrades gracefully when its source dies,
and source failure is itself a user-visible alert.
4.6 **File parsing is bank-account only.** The four manual domains stay manual.

## 5. Git discipline

5.1 **Never stage. Never commit.** Leave everything unstaged unless the owner explicitly
asks. Check `git status` after any operation that might stage — several do, silently.
5.2 **Preserve unrelated work.** The tree may already hold the owner's changes. Never
reset, overwrite or reformat them.
5.3 **No opportunistic refactors** outside the task packet.
5.4 **Never skip hooks or bypass signing.**

## 6. Secrets

6.1 **Never expose secrets or copy `.env` values** into plans, logs, prompts, tests,
handoff packets or agent briefs.
6.2 **Real financial data stays local.** When diagnosing with real statements, read only
what a diagnostic prints; never copy balances or account numbers into a document or an
agent prompt.

## 7. Two agents, one repository

These are the anti-collision rules. They exist because two agents that are each
individually correct can still produce a broken integration.

7.1 **File ownership is exclusive per task.** If two tasks need the same file they run
sequentially, never in parallel, and `TASKS.md` records the dependency.
7.2 **Contracts land before either side builds.** Types, schemas and function signatures
ship in a task of their own, owned by one agent. The other codes against them and **does
not change them** — a needed change is a new task, not an edit.
7.3 **Neither agent edits the other's completed work** without a task that names the file
and says why.
7.4 **Decisions go to `MEMORY.md` in the same change that settles them**, not into chat.
The other agent cannot read your conversation.
**Use [`CONVERSATION.md`](CONVERSATION.md) to ask the other agent anything**, append-only,
every entry timestamped in UTC. Anything not written there did not happen.
7.5 **No document is rewritten to suit one agent's style.** Update in place; amend with
dated corrections rather than erasing history.
7.6 **A task without an acceptance check is not a task** and must not be started.

7.7 **Compose, never re-author.** Every screen is built from `components/ui/`. A screen
that needs a variant adds it to the library and uses it; it never forks a component into
itself. A raw hex colour, an off-scale control height, or a hand-rolled button in a page
file is a defect regardless of how it looks.

7.8 **A build task conforms to its spec.** UI is specified once (Claude) and built against
that spec (Codex). A build task that finds the spec ambiguous **stops and returns the
question** — it does not decide. An invented answer is how two agents produce two
different products.

7.10 **We run simultaneously.** Claim a task in `CONVERSATION.md` before touching a
file, release it when you stop — including when you pause or get blocked. Re-read that
file immediately before every append; never rewrite it wholesale. A `BLOCKED` unanswered
past 24 hours is escalated to the owner and you move on. Never guess, never idle waiting.

7.9 **The conformance check is the arbiter, not taste.** If something passes review but
fails the check, it is wrong. If it passes the check but is wrong, the check is missing a
rule — add the rule in the same change.

### Routing

| Owner | Takes | Because |
|---|---|---|
| **Claude** | `src/domain/`, financial calculations, tax rules, scoring, projections, React and App Router UI, accessibility, state coverage | Anywhere a wrong answer is a wrong *number* rather than a crash |
| **Codex** | Schema and migrations, repositories and adapters, marshalling-only server actions and route handlers, test scaffolding, cross-file refactors, build and CI | Mechanical breadth and wiring |

Either may do work the other owns **only** when a task explicitly assigns it.

## 8. Architecture — abstraction with teeth

Enterprise-grade here means **the engines do not know what they are processing**. This
is already the architecture's stated position (`00-INDEX.md` decision 2, and the four
class hierarchies in `70-UPGRADE-PLAN.md`); these rules make it checkable rather than
aspirational.

8.1 **Everything is a class answering a small set of polymorphic questions.**
`Transaction` exposes `postings()`, `lotEffects()`, `taxableEvents()`, `cashflows()`.
`Asset` exposes `valueOn()`, `taxProfile()`, `quoteKey()`. The four hierarchies are
`Transaction`, `Asset`, `TaxEngine`, `PriceProvider`.

8.2 **The open–closed test, and it is literal.** *Adding a new asset class, transaction
type, tax rule or price provider must touch exactly one new file and no engine.* If a
new case requires editing a switch, an if-chain, or an engine, **the abstraction is
wrong — fix the abstraction, not the case.** This is the single test that decides whether
a design is accepted.

8.3 **No `instanceof`, no type-tag switching, no `as` downcast in an engine.** A
behavioural difference is a method on the subtype. A discriminated union at a
*persistence* or *parsing* boundary is fine; inside a domain engine it is a defect.

8.4 **Depend on interfaces, not implementations.** Domain code names a port
(`PriceProvider`, `StatementParser`, repositories); infrastructure supplies the adapter;
the composition root is the only place that knows both. **The domain imports nothing
from `src/infra/`** — that import direction is one-way, and a violation is a defect
regardless of convenience.

8.5 **Invariants live in constructors.** An invalid object cannot be constructed — an
unbalanced transaction, a negative quantity, a posting carrying both a category and an
instrument. Validation that a caller must remember to call is not validation.

8.6 **Value objects for every quantity with a unit.** `Money`, `Percentage`,
`Quantity`, `CalendarDate`, `FinancialYear`. A raw `number` crossing a domain boundary
is a defect. Value objects are immutable; an operation returns a new instance.

8.7 **Errors are values on the domain path.** `Result`/`Err`, not exceptions, for
outcomes a caller is expected to handle. Exceptions are for programmer error.

8.8 **One reason to change per class.** A class that both computes a tax figure and
formats it for display is two classes. The giveaway is a name containing "and", or a
file that imports both a formatter and a repository.

8.9 **A new abstraction needs two real implementations or a named second case.**
Abstraction invented for a hypothetical is the failure mode opposite to 8.2, and it
costs as much. An interface with one implementation and no second case in sight is
over-engineering — say so in review and inline it.

8.10 **Engines are pure.** No clock, no randomness, no I/O, no environment inside a
calculation. Time is a parameter (`asOf`), randomness is a seeded generator passed in.
This is what makes a tax report reproducible and a backtest honest — and it is why every
engine is testable without a database.

8.11 **Every derived number names the rule that produced it.** Not a comment — a value
the caller can read and the UI can display. This is 8.10's user-visible half, and it is
what makes a figure defensible rather than merely correct.

## 9. Framework

9.1 **This is not the Next.js in your training data.** Read the relevant guide in
`node_modules/next/dist/docs/` before changing framework code.
9.2 **Routes and UI stay thin.** Behaviour lives in the domain and infrastructure layers.
9.3 **Add or update tests with every behaviour change.**
9.4 **Never claim a command passed unless it was run.** Record skipped checks and why.

## 10. Lane discipline

10.1 **Ask which lane before starting** — research, experiment, implementation, or a
combination. Never infer it from the wording, even when one option looks obvious.
10.2 **Research does not silently become implementation.**
10.3 **No implementation is complete** until an independent QA agent records approval, or
the owner explicitly accepts the known failures.
