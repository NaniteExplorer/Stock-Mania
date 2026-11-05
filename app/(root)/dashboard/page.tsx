import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { count, rupee } from "@/core/format";
import { CalendarDate, DateRange } from "@/core/time";
import { Kpi, KpiStrip, Masthead, Page as PageShell, Panel } from "../../../components/ui/page-shell";
import { Banner } from "../../../components/ui/banner";
import { FigureText } from "../../../components/ui/data-cell";
import { StatusBadge } from "../../../components/ui/status-badge";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import { NetWorthAgeSection } from "./net-worth-age-section";
import { NetWorthAgeLoading } from "./net-worth-age-view";

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
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ basis?: string }> }) {
  await connection();
  // Real is the default (DESIGN §8); only an explicit "nominal" switches it.
  const requestedBasis = (await searchParams).basis === "nominal" ? "nominal" : "real";

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const { reports, repositories } = services();

  const [statements, series, personal, pendingRows] = await Promise.all([
    reports.statements.execute({
      userId,
      asOf: today,
      period: DateRange.of(today.startOfMonth().plusMonths(-11), today),
    }),
    reports.netWorthSeries.execute({ userId, months: 12, asOf: today }),
    reports.personal.execute({ userId, asOf: today }),
    repositories.imports.pendingRowCounts(userId),
  ]);
  if (!statements.ok) throw new Error(statements.error.message);
  if (!series.ok) throw new Error(series.error.message);
  if (!personal.ok) throw new Error(personal.error.message);

  const sheet = statements.value.balanceSheet;
  const points = series.value.series;
  const previous = points.length > 1 ? points[points.length - 2] : null;
  const change = previous ? sheet.netWorth.minus(previous.netWorth) : null;
  /*
   * Rows staged by an import and never posted.
   *
   * The headline above is summed from the journal and cannot be wrong about what
   * is in it — which is exactly why it needs this. An import left half-reviewed
   * makes a truthful figure answer a different question than the one being asked,
   * and the queue is rarely balanced: leave the outflows unposted and net worth
   * reads high by however much they came to.
   */
  const pendingImportRows = pendingRows.reduce((total, pending) => total + pending.rows, 0);

  const peak = points.reduce(
    (highest, point) => (point.netWorth.isGreaterThan(highest) ? point.netWorth : highest),
    Money.zero(),
  );

  const income = statements.value.incomeStatement;
  const yearRows: { label: string; value: React.ReactNode; rule?: boolean }[] = [
    { label: "Income", value: <FigureText value={income.income.total} /> },
    { label: "Expenses", value: <FigureText value={income.expenses.total} /> },
    { label: "Saved", value: <FigureText value={income.net} tone="change" />, rule: true },
    { label: "Savings rate", value: <span className="tabular-nums">{income.savingsRate ? `${income.savingsRate.toFixed(1)}%` : "—"}</span> },
    { label: "Peak net worth", value: peak.isZero ? "—" : <FigureText value={peak} /> },
  ];

  return (
    <PageShell>
      <Masthead
        title="Net worth"
        subtitle={<>Assets less liabilities, summed from journal postings. There is no second copy of this figure anywhere in the system, so nothing can disagree with it. <StatusBadge tone="accent">Live</StatusBadge></>}
        hero={rupee(sheet.netWorth)}
      />

      {pendingImportRows > 0 && (
        <Banner tone="warning" title="Net worth is missing a part-reviewed import">
          <p>{count(pendingImportRows, "staged row(s)")} have not been posted, so they are not in the figure below.</p>
          <Link href="/imports">Finish the review</Link>
        </Banner>
      )}

      <KpiStrip>
        <Kpi
          label="Net worth"
          value={rupee(sheet.netWorth)}
          detail={change ? <>Change over last month: <FigureText value={change} tone="change" /></> : "Change over last month: —"}
        />
        <Kpi label="Assets" value={rupee(sheet.assets.total)} detail={count(sheet.assets.rows.length, "accounts")} />
        <Kpi label="Liabilities" value={rupee(sheet.liabilities.total)} detail={count(sheet.liabilities.rows.length, "accounts")} />
        <Kpi
          label="Liquid"
          value={rupee(personal.value.liquidNetWorth)}
          detail={
            personal.value.liquidShortfall !== null
              ? `Liquid assets are ${rupee(personal.value.liquidShortfall)} short${personal.value.runwayMonths !== null ? "; no runway" : "; runway unknown"}`
              : personal.value.runwayMonths !== null
                ? `${personal.value.runwayMonths.toFixed(1)} months of runway`
                : "Spendable today"
          }
        />
      </KpiStrip>

      <Suspense fallback={<NetWorthAgeLoading />}>
        <NetWorthAgeSection userId={userId} today={today} requested={requestedBasis} />
      </Suspense>

      <Panel title="Where it is" description="By asset class, from the account subtypes. Liabilities are not netted off.">
        {statements.value.allocation.length === 0 ? (
          <p className="text-sm text-(--fg-muted)">Nothing recorded yet.</p>
        ) : (
          <div className="space-y-3">
            {statements.value.allocation.map((bucket) => (
              <div key={bucket.label}>
                <div className="mb-1 flex items-baseline justify-between text-xs">
                  <span className="text-(--fg-secondary)">{bucket.label}</span>
                  <span className="tabular-nums text-(--fg-muted)">
                    <FigureText value={bucket.value} format="compact" /> · {bucket.weight.toFixed(1)}%
                  </span>
                </div>
                <svg aria-hidden className="block h-2 w-full overflow-hidden rounded-full" preserveAspectRatio="none" viewBox="0 0 100 2">
                  <rect width="100" height="2" fill="var(--border)" />
                  <rect width={Math.min(100, bucket.weight.toApproximateNumber())} height="2" fill="var(--accent)" fillOpacity={0.7} />
                </svg>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="This year" description="Twelve months to today.">
        <dl className="space-y-3 text-sm">
          {yearRows.map((row) => (
            <div key={row.label} className={row.rule ? "flex items-baseline justify-between border-t border-(--border) pt-3" : "flex items-baseline justify-between"}>
              <dt className="text-(--fg-muted)">{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Panel
        title="The books"
        description="Assets − liabilities = equity + (income − expenses). Checked on the same balances the figures above came from."
      >
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {statements.value.identityHolds ? (
            <>
              <StatusBadge tone="gain">B02 holds</StatusBadge>
              <span className="text-(--fg-secondary)">
                The balance sheet and the income statement are the same system.
              </span>
            </>
          ) : (
            <>
              <StatusBadge tone="loss">B02 fails</StatusBadge>
              <span className="text-(--loss)">
                The statements are out by <FigureText value={statements.value.identityDifference} /> — this is a bug
                in the ledger, not a rounding difference, and the figures above should not be
                trusted until it is found.
              </span>
            </>
          )}
        </div>
        <p className="mt-3 text-xs text-(--fg-muted)">
          {series.value.continuityHolds
            ? "Net worth is continuous month to month (B03): every change is explained by the movements in that month."
            : "A month's net worth does not follow from the previous one — usually a backdated entry that a cached figure has not caught up with."}
        </p>
      </Panel>

      <Panel title="Go to">
        <nav aria-label="Sections" className="flex flex-wrap gap-4 text-sm">
          {[
            { label: "Accounts", href: "/accounts" },
            { label: "Transactions", href: "/transactions" },
            { label: "Investments", href: "/investments" },
            { label: "Deposits", href: "/deposits" },
            { label: "Cards", href: "/cards" },
          ].map((item) => (
            <Link key={item.href} href={item.href} className="text-(--accent) hover:underline">
              {item.label}
            </Link>
          ))}
        </nav>
      </Panel>
    </PageShell>
  );
}
