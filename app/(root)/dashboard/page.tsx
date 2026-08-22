import type { Metadata } from "next";
import Link from "next/link";
import {
  Landmark,
  LineChart,
  Gem,
  CreditCard,
  ArrowLeftRight,
  PieChart,
  TrendingUp,
} from "lucide-react";
import { StatRow, PendingStat, EmptyPanel } from "@/ui/placeholder";

export const metadata: Metadata = { title: "Net Worth" };

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
  { label: "Add assets", desc: "Property, gold and more", href: "/assets", icon: Gem },
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
      <section className="networth-hero">
        <p className="metric-label">Total net worth</p>
        <p
          className="tnum mt-2 text-4xl font-bold text-gray-100 md:text-5xl"
          aria-label="no data yet"
        >
          —
        </p>
        <p className="mt-3 max-w-xl text-sm text-gray-500">
          Assets less liabilities, summed from journal postings at today&apos;s date.
          There is no second copy of this figure anywhere in the system, so nothing
          can disagree with it.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <span className="pill pill-brand">Ledger rebuild in progress</span>
          <span className="pill">Phase 1 — engines</span>
        </div>
      </section>

      <StatRow>
        <PendingStat label="Assets" hint="Sum of asset accounts" />
        <PendingStat label="Liabilities" hint="Sum of liability accounts" />
        <PendingStat label="Invested" hint="Cost plus buy charges" />
        <PendingStat label="Savings rate" hint="Income less expenses" />
      </StatRow>

      <div className="grid gap-4 lg:grid-cols-2">
        <EmptyPanel
          icon={PieChart}
          title="Allocation"
          body="How your net worth splits across cash, investments, physical assets and retirement schemes. Needs accounts before it can say anything true."
        />
        <EmptyPanel
          icon={TrendingUp}
          title="Net worth over time"
          body="A monthly series projected from postings. Because it is derived, backdating an entry corrects history rather than contradicting it."
        />
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
                <Icon className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-gray-100">{label}</span>
                <span className="block text-xs text-gray-500">{desc}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
