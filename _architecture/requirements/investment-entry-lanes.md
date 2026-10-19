# Segregated investment entry lanes (market / digital metals / manual)

Status: QA
Owner: Coordinator + Planner/Implementer
Updated: 2026-09-20

Execution path chosen by the user: **4 — research then implementation**.
Primary mode: **Implementation** (preceded by a Research pass).

## Requirement

`/investments/new` presents one undifferentiated trade form whose only entry
point is a catalogue search for listed instruments. Digital gold cannot be
bought there at all, and the fact that the same metal at two platforms is two
holdings is invisible. The user wants the screen reorganised so that each asset
family is chosen deliberately and gets the fields it actually has.

## Research findings (2026-09-20)

- `MANUAL_KINDS` (`record-investment-form.tsx:31-44`) omits `DIGITAL_GOLD`,
  `DIGITAL_SILVER`, `DIGITAL_PLATINUM`; the catalogue has no metal type
  (`src/domain/instrument-catalog.ts:20-28`). **So there is no UI path to a
  digital-metal holding from this page**, even though `entrySchema`'s
  `KIND_VALUES` already accepts the three kinds.
- `app/(root)/investments/add-instrument-form.tsx` is a kind-complete creator
  (including metal purity) but is **imported nowhere**; it only creates the
  instrument, not the purchase.
- `MetalHoldingForm` on the holding page records grams as *total invested* with
  charges subtracted out of it — an opening-position shape, not a trade.
- `identityMode: "MANUAL"` forces `quoteRef: null`, so metals recorded through
  the manual tier would never price. Metals need their purity slug
  (`GOLD999` / `GOLD995` / `SILVER999` / `PLATINUM999`) as the quote key.
- `AddInstrument` keys idempotency on (symbol, platform) and auto-qualifies a
  clashing symbol (`GOLD999` -> `GOLD999.SAFEGOLD`) while pinning `quoteRef` to
  the bare symbol — so the metal lane must submit the **bare purity slug** as
  the symbol and let the use case qualify it per platform.
  **Correction, 2026-09-20 (QA):** this was only true for the *first* buy on a
  second platform. `AddInstrument` looked the bare symbol up alone, found the
  first platform's row, saw a different institution and minted a new qualified
  symbol on *every* subsequent call — `GOLD999.TANISHQ`, `.2`, `.3` — fragmenting
  the cost base and making the grams unsellable. Fixed in
  `src/app/investing.usecases.ts` (`resolveSymbol` walks the ladder for the
  matching platform row and the first free slot together) and pinned by
  `tests/metal-platform-holdings.spec.ts`.
- Charge estimation is equity-only by design (`investment-charge-estimate.ts:52`),
  so the metals lane must not imply an automatic schedule.
- UI conventions: no Tabs primitive; the repo's canonical segmented pattern is
  server-rendered `?param=` links with `aria-current="page"`
  (`[instrumentId]/holding-nav.tsx`). Forms are `useActionState` clients using
  `Field` from `@/ui/primitives` and the `form-input` / `btn-glow` utilities.

## Acceptance criteria

- [x] `/investments/new` opens on a lane chooser; the lane is in the URL.
- [x] Digital gold / silver / platinum can be bought and sold from the UI, with
      grams, price per gram, purity, platform and a settlement account.
- [x] The metal holding is live-priced (quote key = purity slug), never `null`.
- [x] Buying the same metal on two platforms yields two holdings.
- [x] Equity-only controls (segment, charge estimate) stay out of the metal lane.
- [x] Manual entry is a first-class lane rather than a fallback inside a combobox.
- [x] `npm run lint`, `npm run typecheck`, `npm test` pass.

## Step-by-step plan

- [x] 1. Pure lane/identity helpers — Files: `app/(root)/investments/new/metal-identity.ts`
- [x] 2. Server: `identityMode: "METAL"` + purity-whitelisted `quoteRef` — Files: `app/(root)/investments/catalog-actions.ts`
- [x] 3. Metal entry form — Files: `app/(root)/investments/new/record-metal-form.tsx`
- [x] 4. Lane nav + page branch — Files: `app/(root)/investments/new/{entry-lane-nav.tsx,page.tsx}`
- [x] 5. `lane` prop on the market form so manual is its own lane — Files: `app/(root)/investments/new/record-investment-form.tsx`
- [x] 6. Tests — Files: `tests/investment-metal-entry.spec.ts`
- [x] 7. QA repair: platform-aware symbol resolution — Files: `src/app/investing.usecases.ts`, `tests/metal-platform-holdings.spec.ts`
- [x] 8. Drop the funding account from the metals lane — Files: `app/(root)/investments/catalog-actions.ts`, `app/(root)/investments/new/record-metal-form.tsx`

## Decisions and constraints

- Lanes are routed (`?lane=market|metal|manual`), not client state: it matches
  `holding-nav.tsx`, is deep-linkable from the gold pages, and switching lanes
  should discard a half-typed entry for a different asset family anyway.
- The metal lane goes through `recordInvestmentEntryAction`, not
  `addInstrumentAction` + `recordMetalHoldingAction`, so a purchase is one
  atomic step with the same cash-settlement and charge semantics as a trade.
  `MetalHoldingForm` stays as the opening-position path and is unchanged.
- Symbol submitted is the bare purity slug; platform qualification is the use
  case's job.
- `quoteRef` is whitelisted server-side against the purity enum — the client
  cannot invent a quote key (C10).
- **The metals lane asks for no funding account** (user decision, 2026-09-20).
  Metal is normally bought with a tap in a bullion app, from money that was
  never a row here, so the question had no honest answer. The cash leg posts to
  `Equity: Opening Balances` — the same counter-account the holding page's
  opening-position form uses — rather than being dropped, because a holding with
  nothing on the other side unbalances the ledger and inflates net worth by the
  price of every purchase. The concern was raised and the user confirmed the
  removal; the consequence is stated on the form itself: **a metal purchase does
  not reduce any cash balance**, so a payment that did leave a tracked account
  must be recorded separately or the rupees are counted twice. Every other lane
  still requires the account (`resolveSettlement`, `catalog-actions.ts`).

## Runtime defects found in use (2026-09-20)

1. **A rate per gram could not be entered.** `13932.777` was refused by the
   rupees-and-paise regex, and correctly so: a trade price is `Money`, which is
   paise. A bullion receipt states a rupee total and the grams it bought, and the
   rate between them routinely runs past two decimals. Fixed by inverting the
   input — the metals lane asks for the **receipt total** and derives the rate
   (`metalPricing` in `new/metal-identity.ts`, `resolvePricing` in
   `catalog-actions.ts`), the same way the holding page's opening-position form
   already did. Charges come out of a purchase total and back into a sale total,
   so the cash impact equals the number on the receipt in both directions.
2. **`IllegalTransactionError` (L06) on every account-free metal buy.** Posting
   the cash leg to `Equity: Opening Balances` through `RecordBuy` is not a row in
   the legality matrix — a purchase moves cash out of an account, and opening
   balances are not one. The ledger was right to refuse. Account-free metal
   purchases now book an `OPENING_BALANCE` journal plus a hand-opened lot, which
   is what "these grams entered the books from outside them" actually is.
   A metal **sale** still requires a destination account: there is no inverse of
   an opening position, so that asymmetry is deliberate and is visible in the
   form (the field appears only when Side is Sell).

3. **Every metals submission bounced on `totalAmount`.** The field was wired
   correctly and reached the action; the value itself failed the money format,
   and the refusal said only "Enter rupees and paise", which did not distinguish
   an empty field from a wrongly-shaped one — most likely a per-gram rate
   (three decimals) typed into a field that now wants the rupee total. Three
   changes: pasted figures are tidied before validation (thousands separators,
   a rupee sign, a trailing "g"), the refusals name the number they want, and
   the form no longer submits at all while the figures do not price, so a doomed
   POST is replaced by an inline reason.

## QA record

Status: PASS (after repair)
Round 1 (independent QA agent): **FAIL** — see the correction above; also found
that `identityMode=MANUAL` with a metal `kind` was still accepted server-side,
and that the first test pass asserted on source text rather than behaviour.

Repairs:
- `src/app/investing.usecases.ts` — `resolveSymbol` replaces `freeSymbol`.
- `app/(root)/investments/catalog-actions.ts` — the MANUAL branch now refuses
  digital metals, so a direct POST cannot store one with `quoteRef: null`.
- `tests/metal-platform-holdings.spec.ts` — behavioural: buy, buy again, sell,
  across two platforms, against real migrations.
- Metal-sale `deductibleCharges` default (the whole charge total) is now stated
  in the form rather than left implicit.

Evidence:
- `npm run typecheck` — clean.
- `npm run lint` — 0 errors (46 pre-existing warnings, none in the new files).
- `npm test` — 74/74 spec files passed, including the receipt arithmetic
  (0.3481g for INR 5,000 with INR 150 GST -> INR 13,932.78/g, cash impact
  INR -5,000.00) and the L06 legality rule that forced the opening-position path.
- `npm run build` — succeeded; `/investments/new` builds as a dynamic route.

Residual risks:
- The metal lane's charge fields are typed from the receipt; no automatic
  schedule exists for bullion platforms and none is guessed.
- `AddInstrument` still opens a ledger account before the trade is attempted, so
  a refused trade leaves an empty holding account behind. Pre-existing, not
  introduced here, and out of this requirement's scope.
