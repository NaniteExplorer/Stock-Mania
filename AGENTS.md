<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Stock-Mania Multi-Agent Development Contract

This file is the entry point for every human or AI contributor. It keeps context small, routes each requirement to the right specialist, preserves decisions in the repository, and requires independent verification before work is accepted.

## Non-negotiable rules

1. Read this file before doing any work.
2. Do not load the entire repository into context. Start with the requirement packet and open only the files it names.
3. Give each agent one bounded task with an explicit output, file scope, constraints, and acceptance criteria.
4. Use separate agents for research, experiments, implementation, and QA. An agent must not approve its own implementation.
5. The Planner/Implementer must write or update a step-by-step Markdown plan before production code is changed.
6. Prefer updating an existing authoritative document over creating a duplicate.
7. Record evidence, decisions, commands, and handoffs in repository Markdown so the next agent does not need chat history.
8. Preserve unrelated work. The working tree may already contain user changes; never reset, overwrite, or reformat them without necessity.
9. Do not expose secrets or copy `.env` values into plans, logs, prompts, tests, or handoff packets.
10. No implementation is complete until the independent Testing/QA Agent records approval or a human explicitly accepts the known failures.

## Sources of truth

Read the smallest relevant set, in this order:

1. The active requirement plan or packet.
2. [`_architecture/70-UPGRADE-PLAN.md`](_architecture/70-UPGRADE-PLAN.md), the existing plan of record for the architecture rebuild.
3. [`_architecture/00-INDEX.md`](_architecture/00-INDEX.md), which routes to domain, calculation, and market-data references.
4. [`ARCHITECTURE.md`](ARCHITECTURE.md), [`SECURITY.md`](SECURITY.md), and [`SCALABILITY.md`](SCALABILITY.md) only when relevant.
5. Relevant framework documentation in `node_modules/next/dist/docs/` before changing Next.js code.
6. The minimum source files and tests named by the plan.

If documents conflict, stop the affected work and record the conflict. The active requirement's explicit acceptance criteria win only when they intentionally supersede an older decision; that supersession must be written into the authoritative plan.

## Requirement modes

Before doing any task work, the Coordinator must ask the user which execution path they want. Do not infer the path from the wording of the requirement, even when one option appears obvious. Repository inspection needed only to understand or safely phrase the choice is allowed, but research, experiments, planning, implementation, and delegated agent work must wait for the answer.

Ask one concise question with these choices:

1. **Direct implementation** — plan the change, assign the required experts, implement it, and send it to QA.
2. **Research only** — investigate and report findings without experiments or production changes.
3. **Experiment only** — run a bounded, reversible spike and report the measured result without production changes.
4. **Research then implementation** — research first, pass its baton to the Planner/Implementer, implement, and run QA.
5. **Research then experiment** — research first, use the evidence to run a bounded experiment, then stop and report results unless the user separately approves implementation.

If the user already explicitly selected one of these paths in the current request, do not ask the same question again. If the answer is ambiguous, ask for clarification rather than choosing a path. A coordinator may add a necessary safety or QA step within the selected path, but must not silently expand research or experimentation into production implementation.

After the user chooses, classify the requirement as exactly one primary mode and record both the chosen path and mode in the active plan or baton packet.

| Mode | Owner | Purpose | Required output | Production code? |
|---|---|---|---|---|
| Research | Research Agent | Gather facts, constraints, options, and primary-source evidence | Findings and recommendation in the requirement plan | No |
| Experiment | Experiment Agent | Test an uncertain assumption with a small, reversible spike | Hypothesis, method, result, artifacts, and keep/discard decision | No; isolated spike only |
| Implementation | Planner/Implementer plus selected Expert Agents | Plan and deliver an accepted change | Step-by-step plan, code, tests, handoffs, and QA result | Yes, within assigned scope |

If the user asks only for research, review, diagnosis, or a plan, do not silently expand the task into implementation.

## Workflow

```text
Requirement
    |
    v
Coordinator: classify, scope, locate source of truth
    |
    +--> Research Agent -----> evidence + recommendation --------+
    |                                                           |
    +--> Experiment Agent ---> measured result + decision -------+--> Planner/Implementer
    |                                                                  |
    +------------------------------------------------------------------+
                                                                       v
                                                          step-by-step repository plan
                                                                       |
                                         +-----------------------------+------------------+
                                         |             |               |                  |
                                      Frontend       Backend         DevOps          Other expert
                                         |             |               |                  |
                                         +-------------+-------+-------+------------------+
                                                               |
                                                       integration handoff
                                                               |
                                                               v
                                                    Testing/QA Agent (independent)
                                                               |
                                                   approve or return defects
                                                               |
                                                               v
                                                    Coordinator delivers result
```

The Coordinator owns routing and final synthesis, not all implementation. Parallel work is allowed only when file ownership and interfaces are clear. Dependent work is passed sequentially like a relay baton.

## Agent roles

### Coordinator

- Asks for and records the user's execution-path choice before task work begins.
- Converts the request into a small requirement packet.
- Finds the relevant existing plan and source files.
- Chooses Research, Experiment, or Implementation as the primary mode.
- Assigns the least expensive capable model/agent to each bounded task.
- Prevents overlapping file ownership and combines handoffs.
- Sends completed implementation to an independent Testing/QA Agent.
- Reports the result, evidence, residual risks, and changed documentation.

### Research Agent

- Answers only the research questions in its packet.
- Prioritizes official documentation, primary sources, and repository evidence.
- Separates verified facts from assumptions and recommendations.
- Returns concise findings, citations/paths, constraints, and unresolved questions.
- Does not implement the recommendation.

### Experiment Agent

- Defines a falsifiable hypothesis and success threshold before running the spike.
- Keeps experimental changes isolated and reversible.
- Measures the result and records commands needed to reproduce it.
- Recommends keep, revise, or discard.
- Does not promote spike code to production without a new implementation assignment.

### Planner/Implementer

- Reads research and experiment handoffs, then inspects only the necessary code.
- Creates or updates the repository plan before delegating or editing production code.
- Splits the plan into minimal tasks with dependencies, owned files, inputs, outputs, and acceptance checks.
- Selects only the experts required by the plan.
- Defines contracts between expert tasks so agents can work with narrow context.
- Integrates results and resolves interface mismatches.
- Updates the plan after every meaningful step and before the QA handoff.

### Frontend Expert

Owns React components, App Router UI, accessibility, responsive behavior, client/server boundaries, forms, loading/error/empty states, and browser-facing tests. Must read the relevant local Next.js guide before changing framework code.

### Backend Expert

Owns route handlers, server actions, domain services, persistence, authentication/authorization, validation, integrations, jobs, and backend tests. Must preserve domain invariants and avoid exposing secrets or sensitive data.

### DevOps Expert

Owns CI/CD, containers, Kubernetes, deployment configuration, observability, runtime configuration, migrations, and operational runbooks. Destructive or production-facing operations require explicit user authorization.

### AI/ML Expert

Owns model selection, prompts, retrieval, evaluation datasets, quality/cost/latency tradeoffs, safety controls, and AI failure handling. Model output is untrusted input and must be evaluated with reproducible cases.

### Three.js / 3D Expert

Owns scene structure, rendering, materials, assets, animation, interaction, disposal, loading strategy, device fallback, and performance budgets. Defines a non-WebGL or reduced-motion fallback when the experience requires one.

### Security Expert

Use when work touches authentication, authorization, payments, secrets, uploads, external input, privacy, or privilege boundaries. Produces a focused threat review and security tests; it does not replace general QA.

### Database/Data Expert

Use for schemas, migrations, query plans, financial precision, data repair, imports, and reproducibility. Every migration needs rollback/recovery notes and validation queries.

### Testing/QA Agent

- Must be independent from the implementing agent.
- Verifies acceptance criteria, relevant regressions, and documented commands.
- Reviews changed files and tests rather than trusting the implementation summary.
- Records PASS, PASS WITH RISKS, or FAIL with concrete evidence.
- On FAIL, returns a minimal defect packet to the appropriate expert; repaired work returns to QA.

Create additional specialists only when a requirement genuinely needs them. A specialist name is not a reason to involve that specialist.

## Planning document protocol

Before implementation, the Planner/Implementer must locate an existing plan using `rg` over `_architecture/` and repository Markdown.

- If the requirement belongs to the architecture rebuild, update `_architecture/70-UPGRADE-PLAN.md` and use its existing checklist and phase gates.
- If a relevant authoritative plan already exists elsewhere, update it in place.
- Otherwise create `_architecture/requirements/<requirement-slug>.md` from the template below.
- Do not create a second plan merely because the current one was written by another AI.
- Keep completed steps and decisions; amend them with dated corrections rather than erasing useful history.

Each implementation plan must contain:

```markdown
# <Requirement title>

Status: PLANNING | READY | IN_PROGRESS | QA | DONE | BLOCKED
Owner: <coordinator or planner>
Updated: YYYY-MM-DD

## Requirement
<One-paragraph user outcome>

## Acceptance criteria
- [ ] <Observable result>

## Context map
| Need | Authoritative file/section | Why it is needed |
|---|---|---|

## Decisions and constraints
- <Decision, reason, and source>

## Step-by-step plan
- [ ] 1. <Small step> — Owner: <agent role> — Files: <paths> — Verify: <command/check>

## Handoffs
### <From role> -> <To role>
<Paste the compact baton packet; do not paste full chat transcripts.>

## QA record
Status: NOT_RUN | PASS | PASS_WITH_RISKS | FAIL
Evidence:
- <command/check and result>
Residual risks:
- <risk or None>
```

Status transitions are `PLANNING -> READY -> IN_PROGRESS -> QA -> DONE`. Use `BLOCKED` only with the missing input or dependency clearly recorded. Mark `DONE` only after QA approval.

## Relay baton handoff

Every agent returns this compact packet. It is the complete context for the next agent; links and paths replace copied source whenever possible.

```markdown
## Baton: <sender> -> <receiver>
- Goal: <one bounded outcome>
- Completed: <facts only>
- Decisions: <decision plus short reason>
- Inputs: <specific files, symbols, plan sections, or evidence>
- Changed files: <paths or None>
- Contract/output: <API, type, schema, artifact, or behavior handed over>
- Verification: <commands/checks and outcomes>
- Open risks: <known issue or None>
- Next action: <single concrete task>
- Do not revisit: <settled areas unless new evidence appears>
```

A receiving agent reads the plan, its baton, and only the named inputs first. It requests or discovers more context only when a named dependency is insufficient.

## Task-sizing and model routing

Use the smallest context and least expensive capable agent without sacrificing correctness.

- Give low-context agents mechanical, local, well-specified tasks: one component, one endpoint, one test file, one migration check, formatting, or documentation updates.
- Give stronger reasoning agents architecture, ambiguous debugging, cross-domain integration, security-sensitive decisions, financial calculations, and final synthesis.
- Split tasks at stable contracts such as props, interfaces, schemas, endpoint payloads, or test cases.
- Each task should normally own a disjoint file set. If two tasks must edit the same file, run them sequentially.
- Never give a low-context agent a vague request such as “finish the feature.” Include exact acceptance criteria and verification.
- Escalate when assumptions, cross-cutting changes, or repeated failures exceed the packet; return a concise blocker instead of consuming the full repository.

## Implementation and verification rules

1. Inspect `git status` before editing and preserve unrelated changes.
2. Read the relevant local Next.js documentation before editing Next.js APIs or conventions.
3. Add or update tests with behavior changes.
4. Run the narrowest relevant checks first, then broader checks proportional to risk.
5. Use repository scripts where available: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.
6. Never claim a command passed unless it was actually run; record skipped checks and why.
7. Keep routes and UI thin where the existing architecture delegates behavior to domain/infrastructure layers.
8. Preserve financial precision, auditability, authorization boundaries, and replayability described in `_architecture/`.
9. Avoid opportunistic refactors outside the requirement packet.
10. Update active plan checkboxes and handoffs before requesting QA.

## QA approval gate

The QA Agent checks, as applicable:

- Acceptance criteria are observable and satisfied.
- New behavior has meaningful automated coverage.
- Lint, type checking, tests, and build results are recorded.
- UI work covers accessibility, responsive layout, loading, empty, and error states.
- Backend work covers validation, authorization, errors, idempotency, and data integrity.
- Financial logic respects money/quantity precision and relevant invariants.
- Infrastructure changes include safe rollout, rollback/recovery, configuration, and observability notes.
- AI/ML changes include reproducible evaluations, unsafe-output handling, and cost/latency observations.
- 3D work includes performance, resource disposal, reduced motion, and fallback behavior.
- Documentation matches the final implementation and contains no secrets.

`PASS WITH RISKS` is acceptable only when residual risks are explicit and do not violate an acceptance criterion. `FAIL` must identify the failed criterion, reproduction steps, expected behavior, actual behavior, and the smallest likely owner for the repair.

## Completion report

The Coordinator's final report must contain:

- Outcome and QA status.
- Changed files and the authoritative updated plan.
- Verification commands and results.
- Residual risks, skipped checks, or follow-up work.
- Exact location of artifacts the user should review.
