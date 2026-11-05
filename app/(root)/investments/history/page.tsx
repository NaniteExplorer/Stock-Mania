import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CalendarDate, FinancialYear } from "@/core/time";
import { Percentage } from "@/core/numeric";
import { StatusBadge } from "@/components/ui/status-badge";
import { rupee } from "@/core/format";
import { Page as Shell, Masthead, KpiStrip, Kpi, Panel } from "../../../../components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import { FigureCell, FigureText } from "../../../../components/ui/data-cell";
import { Banner } from "../../../../components/ui/banner";
import { InstitutionMark } from "@/ui/provider-picker";
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
    <Shell>
      <Masthead
        title="Realised gains"
        side={
          <>
            <StatusBadge tone="accent">{scope}</StatusBadge>
            <Link href="/investments" className="ghost-btn h-10 px-4 text-xs">
              Holdings
            </Link>
          </>
        }
      />
      <p className="text-sm text-(--fg-muted)">Profit already taken, by year, category and platform. Settled at the moment of sale, so nothing here depends on a live price.</p>

      {view.total.disposals === 0 ? (
        <Banner title={selected ? `Nothing was sold in ${selected.label}` : "Nothing sold yet"}>
          <p>Realised gain is what a sale actually banked. Record a sale on a holding and it appears here, split into short and long term the way a return needs it.</p>
        </Banner>
      ) : (
        <>
          <KpiStrip>
            <Kpi
              label="Realised"
              value={rupee(view.total.total)}
              detail={`${view.total.disposals} disposal${view.total.disposals === 1 ? "" : "s"} ${scope}`}
            />
            <Kpi
              label="Short term"
              value={rupee(view.total.shortTerm)}
              detail="Held under 365 days, at the tier fixed on the day of sale"
            />
            <Kpi label="Long term" value={rupee(view.total.longTerm)} detail="Held 365 days or more" />
            <Kpi
              label="After charges"
              value={rupee(netOfCharges)}
              detail={`${view.total.charges.toString()} in brokerage and statutory charges`}
            />
          </KpiStrip>

          {view.unattributed > 0 && (
            <Panel title="Disposals with no holding behind them">
              <p className="text-sm text-(--fg-secondary)">
                {view.unattributed} disposal(s) reference an instrument that is no longer readable,
                so they are in the totals above but in none of the breakdowns below. That gap is
                shown rather than hidden — the gain is still taxable, and a breakdown quietly
                missing a slice of the total is the kind of thing nobody notices until a return
                does not add up.
              </p>
            </Panel>
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
              marks
            />
          </div>

          {!selected && view.years.length > 0 && (
            <Panel
              title="By financial year"
              description="The split a return is filed on. The tier was fixed on the day of each sale."
              flush
            >
              <Table>
                <caption className="sr-only">Realised gain by financial year</caption>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-left">Year</TableHead>
                    <TableHead className="text-right">Disposals</TableHead>
                    <TableHead className="text-right">Short term</TableHead>
                    <TableHead className="text-right">Long term</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...view.years].reverse().map((year) => (
                    <TableRow key={year.key}>
                      <TableCell>
                        <Link
                          href={`/investments/history?fy=${encodeURIComponent(year.key)}`}
                          className="text-(--fg) hover:text-brand-400"
                        >
                          {year.key}
                        </Link>
                      </TableCell>
                      <TableCell className="tnum text-right text-(--fg-secondary)">{year.disposals}</TableCell>
                      <FigureCell value={year.shortTerm} tone="change" />
                      <FigureCell value={year.longTerm} tone="change" />
                      <FigureCell value={year.total} tone="change" />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Panel>
          )}

          <Panel
            title="By holding"
            description="Every position that has been sold from, best first. Closed holdings included — an exited position is exactly the one you look back at."
          >
            <Table>
              <caption className="sr-only">Realised gain by holding</caption>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left">Holding</TableHead>
                  <TableHead className="text-right">Disposals</TableHead>
                  <TableHead className="text-right">Proceeds</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Charges</TableHead>
                  <TableHead className="text-right">Realised</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.instruments.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>
                      <Link
                        href={`/investments/${row.key}`}
                        className="text-(--fg) hover:text-brand-400"
                      >
                        {row.label}
                      </Link>
                    </TableCell>
                    <TableCell className="tnum text-right text-(--fg-secondary)">{row.disposals}</TableCell>
                    <FigureCell value={row.proceeds} />
                    <FigureCell value={row.costBasis} />
                    <FigureCell value={row.charges} />
                    <FigureCell value={row.total} tone="change" />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {returnOnCost && (
              <p className="mt-3 text-xs text-(--fg-muted)">
                Over what those units cost, the realised gain is {returnOnCost.toFixed(2)}%. It is
                not an annualised return — a gain taken after six months and one taken after six
                years are both in it, which is why the holding-period split above is the number
                that decides the tax.
              </p>
            )}
          </Panel>
        </>
      )}
    </Shell>
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
  marks = false,
}: {
  title: string;
  subtitle: string;
  rows: readonly RealisedBucket[];
  total: RealisedBucket;
  /** Rows are platforms: show each one's institution mark (DESIGN.md §9). */
  marks?: boolean;
}) {
  return (
    <Panel title={title} description={subtitle}>
      {rows.length === 0 ? (
        <p className="text-sm text-(--fg-muted)">Nothing to break down yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const share = total.total.isZero ? null : Percentage.ratio(row.total, total.total);
            return (
              <li key={row.key}>
                <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-(--fg)">
                    {marks && <InstitutionMark institution={row.label} />}
                    <span>
                      {row.label}
                      <span className="text-xs text-(--fg-disabled)"> · {row.disposals}</span>
                    </span>
                  </span>
                  <FigureText value={row.total} tone="change" />
                </div>
                <div className="flex items-baseline justify-between gap-3 text-xs text-(--fg-muted)">
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
    </Panel>
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
