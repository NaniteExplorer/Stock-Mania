import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight, CreditCard, Gem, Landmark, LineChart } from "lucide-react";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import { Card, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { currentUserId, ensureSeeded, services } from "@/infra/container";

export const metadata: Metadata = { title: "Net Worth" };

/**
 * The dashboard.
 *
 * Net worth is derived from postings at request time and stored nowhere, so there
 * is no second copy to disagree with it. The figure that makes that claim checkable
 * is on this page too: **B02**, the accounting identity, evaluated on the same
 * balances the numbers above it came from. When it holds, the balance sheet and
 * the income statement are the same system; when it does not, the page says so
 * rather than showing a total that cannot be right.
 *
 * v1 hardcoded three zeros into this total (`dayChange`, `esops`, `brokerage`).
 * Anything not yet derivable here renders as an em-dash, because a zero is a claim
 * and an em-dash is an admission.
 */
export default async function DashboardPage() {
  await connection();

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const { reports } = services();

  const [statements, series, personal] = await Promise.all([
    reports.statements.execute({
      userId,
      asOf: today,
      period: DateRange.of(today.startOfMonth().plusMonths(-11), today),
    }),
    reports.netWorthSeries.execute({ userId, months: 12, asOf: today }),
    reports.personal.execute({ userId, asOf: today }),
  ]);
  if (!statements.ok) throw new Error(statements.error.message);
  if (!series.ok) throw new Error(series.error.message);
  if (!personal.ok) throw new Error(personal.error.message);

  const sheet = statements.value.balanceSheet;
  const points = series.value.series;
  const previous = points.length > 1 ? points[points.length - 2] : null;
  const change = previous ? sheet.netWorth.minus(previous.netWorth) : null;
  const peak = points.reduce(
    (highest, point) => (point.netWorth.isGreaterThan(highest) ? point.netWorth : highest),
    Money.zero(),
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Net worth"
        subtitle="Assets less liabilities, summed from journal postings. There is no second copy of this figure anywhere in the system, so nothing can disagree with it."
        badge={<Pill tone="brand">Live</Pill>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Net worth" value={sheet.netWorth} size="lg" delta={change} hint="Change over last month" />
        <Stat label="Assets" value={sheet.assets.total} hint={`${sheet.assets.rows.length} accounts`} />
        <Stat label="Liabilities" value={sheet.liabilities.total} hint={`${sheet.liabilities.rows.length} accounts`} />
        <Stat
          label="Liquid"
          value={personal.value.liquidNetWorth}
          hint={
            personal.value.runwayMonths
              ? `${personal.value.runwayMonths.toFixed(1)} months of runway`
              : "Spendable today"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Where it is"
          subtitle="By asset class, from the account subtypes. Liabilities are not netted off."
          className="lg:col-span-2"
        >
          {statements.value.allocation.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing recorded yet.</p>
          ) : (
            <div className="space-y-3">
              {statements.value.allocation.map((bucket) => (
                <div key={bucket.label}>
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className="text-gray-300">{bucket.label}</span>
                    <span className="tnum text-gray-500">
                      <MoneyText value={bucket.value} display="compact" tone="neutral" /> ·{" "}
                      {bucket.weight.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gray-600">
                    <div
                      className="h-2 rounded-full bg-brand-500/70"
                      style={{ width: `${Math.min(100, bucket.weight.toApproximateNumber())}%` }}
                      aria-hidden
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="This year" subtitle="Twelve months to today.">
          <div className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="metric-label">Income</span>
              <MoneyText value={statements.value.incomeStatement.income.total} tone="neutral" />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="metric-label">Expenses</span>
              <MoneyText value={statements.value.incomeStatement.expenses.total} tone="neutral" />
            </div>
            <div className="flex items-baseline justify-between border-t border-gray-600 pt-3">
              <span className="metric-label">Saved</span>
              <MoneyText value={statements.value.incomeStatement.net} />
            </div>
            <div className="flex items-baseline justify-between">
              <span className="metric-label">Savings rate</span>
              <span className="tnum text-gray-300">
                {statements.value.incomeStatement.savingsRate
                  ? `${statements.value.incomeStatement.savingsRate.toFixed(1)}%`
                  : "—"}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="metric-label">Peak net worth</span>
              <MoneyText value={peak.isZero ? null : peak} tone="neutral" />
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="The books"
        subtitle="Assets − liabilities = equity + (income − expenses). Checked on the same balances the figures above came from."
      >
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {statements.value.identityHolds ? (
            <>
              <Pill tone="brand">B02 holds</Pill>
              <span className="text-gray-400">
                The balance sheet and the income statement are the same system.
              </span>
            </>
          ) : (
            <>
              <Pill tone="neutral">B02 fails</Pill>
              <span className="text-red-500">
                The statements are out by{" "}
                <MoneyText value={statements.value.identityDifference} tone="neg" /> — this is a bug
                in the ledger, not a rounding difference, and the figures above should not be
                trusted until it is found.
              </span>
            </>
          )}
        </div>
        <p className="mt-3 text-xs text-gray-500">
          {series.value.continuityHolds
            ? "Net worth is continuous month to month (B03): every change is explained by the movements in that month."
            : "A month's net worth does not follow from the previous one — usually a backdated entry that a cached figure has not caught up with."}
        </p>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "Accounts", href: "/accounts", icon: Landmark },
          { label: "Transactions", href: "/transactions", icon: ArrowLeftRight },
          { label: "Investments", href: "/investments", icon: LineChart },
          { label: "Deposits", href: "/deposits", icon: Gem },
          { label: "Cards", href: "/cards", icon: CreditCard },
        ].map((item) => (
          <Link key={item.href} href={item.href} className="panel panel-hover p-4">
            <span className="icon-chip mb-3 h-9 w-9">
              <item.icon className="h-4 w-4" aria-hidden />
            </span>
            <p className="text-sm font-medium text-gray-100">{item.label}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
