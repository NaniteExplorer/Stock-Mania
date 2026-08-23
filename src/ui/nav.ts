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
  Wallet,
  Gem,
  CreditCard,
} from "lucide-react";

/**
 * Sidebar navigation, grouped INDmoney-style. `NAV_ITEMS` (flat) is derived for
 * any consumer that just needs the full list (e.g. mobile menus).
 */
export const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Net Worth", icon: LayoutDashboard },
      { href: "/history", label: "History", icon: CalendarClock },
    ],
  },
  {
    label: "Wealth",
    items: [
      { href: "/accounts", label: "Accounts", icon: Landmark },
      { href: "/transactions", label: "Transactions", icon: History },
      { href: "/budgets", label: "Budgets", icon: PiggyBank },
      { href: "/imports", label: "Import", icon: Upload },
      { href: "/investments", label: "Investments", icon: LineChart },
      { href: "/assets", label: "Assets", icon: Gem },
      { href: "/cards", label: "Cards", icon: CreditCard },
      { href: "/liabilities", label: "Liabilities", icon: Wallet },
    ],
  },
  {
    label: "Account",
    items: [{ href: "/settings", label: "Settings", icon: Settings }],
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
