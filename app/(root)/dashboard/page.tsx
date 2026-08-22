import type { Metadata } from "next";
import Link from "next/link";
import { Landmark, LineChart, Gem, CreditCard, ArrowLeftRight } from "lucide-react";
import { PageHeader, Pill, Stat, MoneyText } from "@/ui/primitives";
import { AllocationChart, NetWorthTrendChart } from "@/ui/chart-placeholders";

export const metadata: Metadata = { title: "Net Worth" };

/**
 * The dashboard.
 *
 * Net worth is the one figure that must never be wrong, so it is derived from
 * postings at request time and stored nowhere. v1 kept a copy on each account and
 * hardcoded three zeros into the total (`dayChange`, `esops`, `brokerage`); this
 * shows an em-dash until the ledger can answer, because an em-dash is honest and
 * a zero is a claim.
 */

const ONBOARD = [
  {
    label: "Add a bank account",
    desc: "Cash, savings and deposits",
    href: "/accounts",
    icon: Landmark,
  },
  {
    label: "Record transactions",
    desc: "Import a statement or enter them",
    href: "/transactions",
    icon: ArrowLeftRight,
  },
  {
    label: "Add investments",
    desc: "Equities, ETFs and funds",
    href: "/investments",
    icon: LineChart,
  },
  {
    label: "Add assets",
    desc: "Property, gold and more",
    href: "/assets",
    icon: Gem,
  },
  {
    label: "Add liabilities",
    desc: "Cards and loans",
    href: "/liabilities",
    icon: CreditCard,
  },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Net worth"
        subtitle="Assets less liabilities, summed from journal postings. There is no second copy of this figure anywhere in the system, so nothing can disagree with it."
        badge={<Pill tone="brand">Phase 1 — engines</Pill>}
      />

      <section className="networth-hero">
        <p className="metric-label">Total net worth</p>
        <p className="mt-2 text-4xl font-bold md:text-5xl">
          <MoneyText value={null} tone="neutral" />
        </p>
        <p className="mt-3 max-w-xl text-sm text-gray-500">
          Derived, never stored. A backdated entry corrects history here rather
          than contradicting it.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Assets" value={null} hint="Sum of asset accounts" />
        <Stat
          label="Liabilities"
          value={null}
          hint="Sum of liability accounts"
        />
        <Stat label="Invested" value={null} hint="Cost plus buy charges" />
        <Stat label="Savings rate" value={null} hint="Income less expenses" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AllocationChart />
        <NetWorthTrendChart />
      </div>

      <section>
        <h2 className="section-kicker mb-3">Get started</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ONBOARD.map(({ label, desc, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="panel panel-hover focus-brand flex items-start gap-3 p-4"
            >
              <span className="icon-chip">
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <span>
                <span className="block text-sm font-semibold text-gray-100">
                  {label}
                </span>
                <span className="block text-xs text-gray-500">{desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
