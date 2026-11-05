/**
 * Application navigation, in one place.
 *
 * Moved out of v1's `lib/constants.ts` (a 410-line grab bag) so the route list
 * lives next to the UI that renders it. Every href here must be a real route:
 * `tests/layout.spec.ts` has no opinion on nav, but a dead sidebar link is the
 * most visible kind of rot, so keep this in step with `app/(root)/`.
 */

import {
  LayoutDashboard,
  History,
  CalendarClock,
  Settings,
  Landmark,
  LineChart,
  PiggyBank,
  Upload,
  Gem,
  CreditCard,
  Building2,
  TrendingUp,
  Banknote,
  ShieldCheck,
  Repeat,
  Gauge,
  Radar,
} from "lucide-react";

/**
 * Sidebar navigation, grouped INDmoney-style. `NAV_ITEMS` (flat) is derived for
 * any consumer that just needs the full list (e.g. mobile menus).
 *
 * Grouping follows DESIGN.md §9c (D.2, binding): "Debt" holds exactly Cards and
 * Loans (Payoff is a tab of `/loans`, not an item); Deposits and Assets sit under
 * "Savings & assets"; Platforms stays under Investments. `/liabilities` is retired
 * and permanently redirects to `/loans` (`next.config.ts`), so it has no entry.
 *
 * §9c also puts three figures in the Debt group header (Total outstanding, Blended
 * rate, Monthly outgo). Total outstanding is rendered (Batch 5): the layout computes
 * it from the card and loan usecases via `src/ui/debt-header.ts`, and `Sidebar`
 * shows it under the Debt label, hidden when unknown. Blended rate and Monthly outgo
 * remain a recorded follow-up.
 *
 * "Planning" is not placed by §9c; it holds the newer screens unchanged so that
 * no destination was dropped by the regroup.
 */
export const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Net Worth", icon: LayoutDashboard },
      { href: "/history", label: "History", icon: CalendarClock },
      { href: "/activity", label: "Activity", icon: History },
    ],
  },
  {
    label: "Cash & spending",
    items: [
      { href: "/accounts", label: "Accounts", icon: Landmark },
      { href: "/transactions", label: "Transactions", icon: History },
      { href: "/budgets", label: "Budgets", icon: PiggyBank },
      { href: "/imports", label: "Import", icon: Upload },
    ],
  },
  {
    label: "Investments",
    items: [
      { href: "/investments", label: "Investments", icon: LineChart },
      { href: "/investments/history", label: "Realised gains", icon: TrendingUp },
      { href: "/platforms", label: "Platforms", icon: Building2 },
    ],
  },
  {
    label: "Savings & assets",
    items: [
      { href: "/deposits", label: "Deposits", icon: PiggyBank },
      { href: "/assets", label: "Assets", icon: Gem },
    ],
  },
  {
    label: "Debt",
    items: [
      { href: "/cards", label: "Cards", icon: CreditCard },
      { href: "/loans", label: "Loans", icon: Landmark },
    ],
  },
  {
    label: "Planning",
    items: [
      { href: "/income", label: "Income", icon: Banknote },
      { href: "/insurance", label: "Insurance", icon: ShieldCheck },
      { href: "/commitments", label: "Commitments", icon: Repeat },
      { href: "/projection", label: "Projection", icon: TrendingUp },
      { href: "/standing", label: "Standing", icon: Gauge },
      { href: "/signals", label: "Signals", icon: Radar },
    ],
  },
  {
    label: "Account",
    items: [
      { href: "/settings", label: "Settings", icon: Settings },
      { href: "/settings/cpi", label: "CPI Urban", icon: LineChart },
      { href: "/settings/allocation", label: "Target allocation", icon: Radar },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

/** Primary destinations for the mobile bottom-nav. */
export const MOBILE_NAV_ITEMS = [
  { href: "/dashboard", label: "Net Worth", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/investments", label: "Invest", icon: LineChart },
  { href: "/history", label: "Monthly", icon: CalendarClock },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;
