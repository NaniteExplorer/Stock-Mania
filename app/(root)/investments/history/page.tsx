import type { Metadata } from "next";
import Link from "next/link";
import { History } from "lucide-react";
import { connection } from "next/server";
import { CalendarDate, FinancialYear } from "@/core/time";
import { Percentage } from "@/core/numeric";
import { Card, EmptyState, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import type { RealisedBucket } from "@/app/realised-history.usecases";
import { currentUserId, ensureSeeded, services } from "@/infra/container";

export const metadata: Metadata = { title: "Realised gains" };

/**
 * What has actually been made, since the beginning and by financial year.
 *
 * The counterpart to the investments screen, and the split between them is the
 * one that matters: that screen shows **unrealised** value, which needs a live
 * price and goes blank when a feed is down. This one shows **realised** gains,
 * which were settled at the moment of sale and need no price at all. A single
 * screen mixing both would go dark on a bad IBJA day and take the tax figures
 * with it.
 *
 * Every number here is read from `lot_matches`, where it was written when the
 * sale happened — including the short/long-term tier, which is deliberately
 * *stored* rather than recomputed so that a budget moving the twelve-month line
 * cannot restate a gain that has already been filed.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  await connection();

  const { fy } = await searchParams;
  const userId = await currentUserId();
  await ensureSeeded(userId);

  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const { investing } = services();

  /*
   * The unfiltered pass comes first and always, because the year selector has to
   * be built from the years that actually have activity in them — offering the
   * user an empty 2019-20 is worse than offering nothing.
   */
  const everything = await investing.realisedHistory.execute({ userId, asOf: today });
  if (!everything.ok) throw new Error(everything.error.message);

  const selected = parseYear(fy);
  const scoped = selected
    ? await investing.realisedHistory.execute({ userId, financialYear: selected, asOf: today })
    : everything;
  if (!scoped.ok) throw new Error(scoped.error.message);

  const view = scoped.value;
  const yearOptions = [...everything.value.years].sort((a, b) => b.key.localeCompare(a.key));
  const scope = selected ? selected.label : "since the beginning";

  const netOfCharges = view.total.total.minus(view.total.charges);
  const returnOnCost = view.total.costBasis.isZero
    ? null
    : Percentage.ratio(view.total.total, view.total.costBasis);

  return (
    <>
      <PageHeader
        title="Realised gains"
        subtitle="Profit already taken, by year, category and platform. Settled at the moment of sale, so nothing here depends on a live price."
        badge={<Pill tone="brand">{scope}</Pill>}
        action={
          <Link href="/investments" className="ghost-btn h-10 px-4 text-xs">
            Holdings
          </Link>
        }
      />

      {view.total.disposals === 0 ? (
        <section className="panel p-0">
          <EmptyState
            icon={History}
            title={selected ? `Nothing was sold in ${selected.label}` : "Nothing sold yet"}
            body="Realised gain is what a sale actually banked. Record a sale on a holding and it appears here, split into short and long term the way a return needs it."
          />
        </section>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Realised"
              value={view.total.total}
              hint={`${view.total.disposals} disposal${view.total.disposals === 1 ? "" : "s"} ${scope}`}
            />
            <Stat
              label="Short term"
              value={view.total.shortTerm}
              hint="Held under 365 days, at the tier fixed on the day of sale"
            />
            <Stat label="Long term" value={view.total.longTerm} hint="Held 365 days or more" />
            <Stat
              label="After charges"
              value={netOfCharges}
              hint={`${view.total.charges.toString()} in brokerage and statutory charges`}
            />
          </div>

          {view.unattributed > 0 && (
            <Card title="Disposals with no holding behind them" className="mb-6">
              <p className="text-sm text-gray-300">
                {view.unattributed} disposal(s) reference an instrument that is no longer readable,
                so they are in the totals above but in none of the breakdowns below. That gap is
                shown rather than hidden — the gain is still taxable, and a breakdown quietly
                missing a slice of the total is the kind of thing nobody notices until a return
                does not add up.
              </p>
            </Card>
          )}

          {yearOptions.length > 1 && (
            <nav className="mb-6 flex flex-wrap gap-2" aria-label="Financial year">
              <Link
                href="/investments/history"
                className={selected ? "ghost-btn h-8 px-3 text-xs" : "primary-btn h-8 px-3 text-xs"}
              >
                All years
              </Link>
              {yearOptions.map((year) => (
                <Link
                  key={year.key}
                  href={`/investments/history?fy=${encodeURIComponent(year.key)}`}
                  className={
                    selected?.label === year.key
                      ? "primary-btn h-8 px-3 text-xs"
                      : "ghost-btn h-8 px-3 text-xs"
                  }
                >
                  {year.key}
                </Link>
              ))}
            </nav>
          )}

          <div className="mb-6 grid gap-4 lg:grid-cols-2">
            <Breakdown
              title="By category"
              subtitle="Digital metals, equity, funds — what each has actually made."
              rows={view.groups}
              total={view.total}
            />
            <Breakdown
              title="By platform"
              subtitle="Which broker, app or vault the profit came from."
              rows={view.platforms}
              total={view.total}
            />
          </div>

          {!selected && view.years.length > 0 && (
            <Card
              title="By financial year"
              subtitle="The split a return is filed on. The tier was fixed on the day of each sale."
              className="mb-6"
            >
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <caption className="sr-only">Realised gain by financial year</caption>
                  <thead>
                    <tr className="border-b border-gray-600">
                      <th scope="col" className="metric-label px-3 py-2 text-left">Year</th>
                      <th scope="col" className="metric-label px-3 py-2 text-right">Disposals</th>
                      <th scope="col" className="metric-label px-3 py-2 text-right">Short term</th>
                      <th scope="col" className="metric-label px-3 py-2 text-right">Long term</th>
                      <th scope="col" className="metric-label px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...view.years].reverse().map((year) => (
                      <tr key={year.key} className="border-b border-gray-600/50 last:border-0">
                        <td className="px-3 py-2">
                          <Link
                            href={`/investments/history?fy=${encodeURIComponent(year.key)}`}
                            className="text-gray-100 hover:text-brand-400"
                          >
                            {year.key}
                          </Link>
                        </td>
                        <td className="tnum px-3 py-2 text-right text-gray-400">{year.disposals}</td>
                        <td className="px-3 py-2 text-right"><MoneyText value={year.shortTerm} /></td>
                        <td className="px-3 py-2 text-right"><MoneyText value={year.longTerm} /></td>
                        <td className="px-3 py-2 text-right"><MoneyText value={year.total} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <Card
            title="By holding"
            subtitle="Every position that has been sold from, best first. Closed holdings included — an exited position is exactly the one you look back at."
          >
            <div className="table-scroll">
              <table className="w-full text-sm">
                <caption className="sr-only">Realised gain by holding</caption>
                <thead>
                  <tr className="border-b border-gray-600">
                    <th scope="col" className="metric-label px-3 py-2 text-left">Holding</th>
                    <th scope="col" className="metric-label px-3 py-2 text-right">Disposals</th>
                    <th scope="col" className="metric-label px-3 py-2 text-right">Proceeds</th>
                    <th scope="col" className="metric-label px-3 py-2 text-right">Cost</th>
                    <th scope="col" className="metric-label px-3 py-2 text-right">Charges</th>
                    <th scope="col" className="metric-label px-3 py-2 text-right">Realised</th>
                  </tr>
                </thead>
                <tbody>
                  {view.instruments.map((row) => (
                    <tr key={row.key} className="border-b border-gray-600/50 last:border-0">
                      <td className="px-3 py-2">
                        <Link
                          href={`/investments/${row.key}`}
                          className="text-gray-100 hover:text-brand-400"
                        >
                          {row.label}
                        </Link>
                      </td>
                      <td className="tnum px-3 py-2 text-right text-gray-400">{row.disposals}</td>
                      <td className="px-3 py-2 text-right"><MoneyText value={row.proceeds} tone="neutral" /></td>
                      <td className="px-3 py-2 text-right"><MoneyText value={row.costBasis} tone="neutral" /></td>
                      <td className="px-3 py-2 text-right"><MoneyText value={row.charges} tone="neutral" /></td>
                      <td className="px-3 py-2 text-right"><MoneyText value={row.total} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {returnOnCost && (
              <p className="mt-3 text-xs text-gray-500">
                Over what those units cost, the realised gain is {returnOnCost.toFixed(2)}%. It is
                not an annualised return — a gain taken after six months and one taken after six
                years are both in it, which is why the holding-period split above is the number
                that decides the tax.
              </p>
            )}
          </Card>
        </>
      )}
    </>
  );
}

/**
 * One breakdown table.
 *
 * The share column is of the **total realised**, and it is suppressed when that
 * total is zero rather than showing a division by nothing — a portfolio that has
 * broken even overall still has categories that made and lost money, and their
 * "share" of zero is not a meaningful number.
 */
function Breakdown({
  title,
  subtitle,
  rows,
  total,
}: {
  title: string;
  subtitle: string;
  rows: readonly RealisedBucket[];
  total: RealisedBucket;
}) {
  return (
    <Card title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing to break down yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const share = total.total.isZero ? null : Percentage.ratio(row.total, total.total);
            return (
              <li key={row.key}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-gray-200">
                    {row.label}
                    <span className="text-xs text-gray-600"> · {row.disposals}</span>
                  </span>
                  <MoneyText value={row.total} />
                </div>
                <div className="flex items-baseline justify-between gap-3 text-xs text-gray-500">
                  <span>
                    {row.shortTerm.isZero ? null : <>short {row.shortTerm.toString()} </>}
                    {row.longTerm.isZero ? null : <>long {row.longTerm.toString()}</>}
                  </span>
                  {share && <span className="tnum">{share.toFixed(1)}%</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** A malformed `?fy=` is ignored rather than thrown on: it is a URL, not a form. */
function parseYear(value: string | undefined): FinancialYear | null {
  if (!value) return null;
  try {
    return FinancialYear.parse(value);
  } catch {
    return null;
  }
}
