# stockMania — Architecture Guide

A quick map so any developer can find their way around. stockMania is a
**Next.js 16 (App Router) + React 19 + Tailwind v4** personal-finance app:
public live-markets pages, and a private **net-worth / wealth-management**
workspace after sign-in.

---

## 1. Folder map

```
app/                      # Next.js App Router (routes only — thin, mostly server components)
  (marketing)/            # PUBLIC: live markets + news landing, marketing header/footer
  (auth)/                 # sign-in / sign-up (redirects to /dashboard when logged in)
  (root)/                 # PRIVATE app shell (sidebar + topbar + mobile nav)
    dashboard/            #   Net-worth overview (the home screen)
    accounts/ investments/ esops/ assets/   # wealth pages (manual data, real DB)
    portfolio/ orders/ signals/ watchlist/ search/ stocks/[symbol]/  # markets
    settings/
  icon.svg                # favicon (auto-detected by Next)
  layout.tsx              # root layout (fonts, ThemeProvider, Toaster)
  globals.css             # THE design system (see §4)

components/
  Logo.tsx                # <Logo/> + <BrandMark/> — single source of brand lockup
  Sidebar / Header / MobileNav   # the app shell
  wealth/                 # net-worth UI: WealthManager (generic CRUD), per-feature managers, AllocationDonut
  ui/                     # shadcn primitives (button, dialog, select, …)
  landing/                # marketing-only components (HeroVisual, MarketingHeader, Footer)

features/<domain>/        # ALL business logic, one folder per domain (see §2)
  accounts/ investments/ esops/ assets/ networth/   # wealth domains (added for the redesign)
  portfolio/ orders/ signals/ alerts/ watchlist/ stocks/ news/ user/   # existing domains

core/                     # cross-cutting infra: db connection, logger, cache, config, messaging, queue
lib/                      # app-wide helpers: utils (money formatting), constants (nav + TV widget configs)
branding/brand.ts         # brand name/tagline/email — single source of truth
```

## 2. Feature-sliced layering (the important bit)

Every domain in `features/<x>/` follows the **same four layers**, top to bottom.
Read them in this order and any feature becomes obvious:

| File | Responsibility | Rule of thumb |
|------|----------------|---------------|
| `<x>.types.ts` | TypeScript shapes + label maps | no logic |
| `<x>.model.ts` | Mongoose schema/model | DB shape only |
| `<x>.repository.ts` | DB reads/writes (CRUD) + row→entity mapping | the **only** layer that touches Mongo |
| `<x>.service.ts` | business logic / aggregation | calls repository, never the DB directly |
| `<x>.actions.ts` | `"use server"` entry points called by React | auth check → service → `revalidatePath` |

**Dependency direction:** `page.tsx → actions → service → repository → model`.
UI never imports a repository; it only calls actions.

Example — Accounts:
`getMyAccounts()` (action, checks session) → `accountService.list()` →
`accountRepository.listByUser()` → `Account` model.

### Adding a new wealth domain
Copy any folder under `features/` (e.g. `assets/`), rename the 5 files, adjust
the fields, then add: a sidebar entry in `lib/constants.ts` (`NAV_GROUPS`), a
page in `app/(root)/<x>/page.tsx`, and a `<X>Manager` in `components/wealth/`.

## 3. Net worth aggregation

`features/networth/networth.service.ts` is read-only: it pulls totals from
`accountService`, `investmentService`, `esopService`, `assetService` **and** the
live broker `portfolioService`, then returns a net-worth figure + allocation
breakdown. It degrades gracefully (broker failure → ₹0, never crashes).
- `getNetWorthSummary()` → small object for the sidebar.
- `getNetWorthOverview()` → full breakdown for the dashboard.

## 4. Design system (global CSS)

All styling lives in **`app/globals.css`** — no scattered style files.
- **Tokens** under `:root` / `.dark` drive everything. Semantic colours are
  re-mapped (`yellow-*`→`--brand`, `green-*`→`--pos`, `red-*`→`--neg`), so the
  whole app re-themes by editing a few variables.
- **Utility classes** (use these instead of re-inventing): `panel`, `panel-hover`,
  `page-title`, `page-subtitle`, `stat-tile`, `icon-chip`, `chip`/`chip-pos`/`chip-neg`,
  `pill`, `side-link`, `networth-hero`, `bottom-nav`, `tnum` (tabular numerals).

## 5. Conventions

- **Money:** integers/floats in INR; format with helpers in `lib/utils.ts`
  (`formatINR`, `formatINRCompact`, `formatSignedPercent`).
- **Server vs client:** pages/layouts are server components; anything interactive
  is a `"use client"` component under `components/`.
- **Mutations:** server actions only, always re-validate (`revalidatePath`) the
  affected routes so the UI refreshes.
