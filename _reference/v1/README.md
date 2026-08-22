# Frozen v1 source — porting reference only

These files are the parts of v1 worth carrying into v2. They are copied here verbatim
so that deleting `features/`, `core/` and `lib/` does not force a `git show` every time
a phase needs to port one of them.

**Rules**

1. **Never imported.** This directory is excluded from `tsconfig.json` and ignored by
   ESLint, so nothing here typechecks, lints, or ships. An import from `_reference/`
   is always a mistake.
2. **Never edited.** It is a snapshot. Fix things in `src/`, not here.
3. **Delete a file the moment its logic lands in `src/`.** An empty `_reference/` is
   the goal state; a stale one is a second source of truth.

**Contents and where each one lands**

| File | Ports into | Phase |
| --- | --- | --- |
| `fifo.ts` | `src/domain/lots.ts` as the `Fifo` strategy, in `Money`/`Quantity` | 5 |
| `tax-engine/` (7 files) | `src/domain/tax.ts` — shape kept, `CapitalGainsRule` split, `LossRule` replaced | 1c |
| `statement-parser.ts` | `src/app/banking.usecases.ts`, amounts retyped to `Money` | 2 |
| `categorizer.ts` | `src/app/banking.usecases.ts` — keyword rules only, no AI | 2 |
| `transaction.categories.ts` | category metadata for the banking UI | 2 |
| `xirr.ts` | `src/domain/portfolio.ts`, rebuilt per `30-CALCULATIONS.md` §4.1 | 5 |
| `period.ts` | `src/core/time.ts` helpers, if anything survives `DateRange` | 2 |
| `currencies.ts` | `src/core/money.ts` currency table | as needed |
| `financial-providers.ts` | `src/ui/providers.ts` (bank/broker logo metadata) | 1 (step 2) |
| `charts/` (3 files) | `src/ui/charts.tsx` — salvage geometry, discard the CSS techniques | 1g |

Everything else from v1 was deleted outright and lives only in git history:

```
git show 2aba024:features/orders/order.service.ts     # or any other path
git checkout 2aba024 -- features/                     # if ever genuinely needed
```
