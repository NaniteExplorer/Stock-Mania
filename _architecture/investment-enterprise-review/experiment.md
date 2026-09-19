# Asset-segregated investment workspace experiment

Date: 2026-09-19
Mode: Experiment
Status: COMPLETE

## Hypothesis

A single shared portfolio shell with specialized Equities, Mutual Funds, Gold, and Fixed Income views can make a zero-subscription investment tracker feel professionally trustworthy without implying uniform or real-time data. The hypothesis is supported if the prototype makes valuation basis, freshness, and the next corrective action discoverable in context while preserving asset-specific lifecycle fields and an honest priced-subtotal state when coverage is incomplete.

## Success threshold

The experiment is a **KEEP** only if deterministic checks establish all of the following:

1. The artifact contains four navigable levels: portfolio overview, category drill-down, holding detail, and data-quality explanation.
2. Equities, Mutual Funds, Gold, and Fixed Income each have a specialized category presentation; Gold separately characterizes Digital, Physical, SGB, and ETF.
3. Every representative holding detail exposes asset type, source or valuation method, an as-of value, and at least one relevant lifecycle field.
4. Current, daily, stale, manual, and unavailable states are visibly named, use text in addition to color, and include a relevant next action where intervention is possible.
5. Incomplete valuation is labelled `Priced subtotal`, never as a complete portfolio total.
6. Every displayed monetary or performance figure is covered by an explicit synthetic-data label.
7. The document has one `h1`, labelled navigation, keyboard-operable native controls, a skip link, visible focus styling, and no duplicate IDs.
8. Responsive CSS includes explicit desktop and mobile behavior at a breakpoint of 720px or narrower, with tables given horizontal overflow rather than forced clipping.
9. The check script exits successfully with at least 30 assertions and confirms the artifact does not import production JavaScript, TypeScript, APIs, or calculation modules.

Any failed condition produces **REVISE**. Missing asset segregation, misleading freshness, a complete-total claim with unavailable data, absent synthetic labelling, or production coupling produces **DISCARD**.

## Method

- Build one reversible local HTML/CSS/JavaScript prototype under this directory only.
- Use fixed synthetic fixtures and display-only values; perform no financial calculations.
- Represent the shared shell and specialized views in one document so structure remains inspectable without a server.
- Add a dependency-free Node.js structural checker for content, accessibility markers, responsive rules, and isolation.
- Run the checker and record the exact result below after construction.

## Results

- Command: `node _architecture/investment-enterprise-review/check.mjs`
- Result: PASS, 52/52 deterministic assertions.
- Covered: required view levels, four asset families, four distinct gold forms, representative holding provenance/lifecycle fields, all five valuation states, priced-subtotal language, synthetic labelling, semantic/accessibility structure, desktop/mobile CSS contracts, and isolation from production modules and network access.
- Repository hygiene: `git diff --check -- _architecture/investment-enterprise-review` passed.
- Browser visual and interaction QA: NOT RUN by instruction. Responsive and accessibility conclusions are structural only, not visual claims.

## Decision

**KEEP as an implementation reference.** The prototype met every predeclared deterministic threshold. It demonstrates that a shared operating shell can preserve consistent navigation and valuation controls while specialized category schemas avoid presenting materially different investments as equivalent.

This decision does not promote prototype code, validate production calculations, establish data licensing, or prove visual behavior in a browser. Any production implementation requires a separate implementation path and independent QA.
