import type { Metadata } from "next";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate, DateRange, FinancialYear } from "@/core/time";
import { Percentage } from "@/core/numeric";
import { rupee, unknown, type Figure } from "@/core/format";
import { Kpi, KpiStrip, Masthead, Page as PageShell, Panel } from "../../../components/ui/page-shell";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { FigureCell, TextCell, UnknownCell } from "../../../components/ui/data-cell";
import { Banner } from "../../../components/ui/banner";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import NetWorthChart from "./net-worth-chart";

export const metadata: Metadata = { title: "History" };

const HISTORY_PERIODS = [12, 36, 60] as const;

/**
 * Month by month, and the financial year to date.
 *
 * The three statements come from rebuildable journal projections. A backdated
 * transaction changes October's row after invalidating that month and every
 * later cumulative point.
 *
 * The tax section is the other half: realised gains for the financial year, with the
 * rule that produced each line. "Why is this ₹37,500?" has an answer here, and it
 * will still have the same answer in three years when the rates have changed.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ months?: string }>;
}) {
  await connection();

  const requestedMonths = Number.parseInt((await searchParams).months ?? "12", 10);
  const months = HISTORY_PERIODS.includes(requestedMonths as (typeof HISTORY_PERIODS)[number])
    ? requestedMonths
    : 12;

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const financialYear = FinancialYear.containing(today);
  const { reports, repositories } = services();

  /*
   * The user's own circumstances, from `/settings`.
   *
   * When nothing is stored the report still runs — at the top slab, so the figure
   * is a ceiling rather than an underestimate — and the section says which of the
   * two it is looking at. A silently-defaulted 30% would be indistinguishable
   * from a real 30%.
   */
  const storedTax = await repositories.taxSettings.findFor(userId, financialYear);
  const taxSettings = {
    isAssumed: storedTax === null,
    settings: {
      slabRate: storedTax?.marginalSlabRate ?? Percentage.of("30"),
      totalIncome: storedTax?.totalIncome ?? Money.zero(),
      residentStatus: storedTax?.residentStatus ?? ("RESIDENT" as const),
    },
  };

  const [series, flows, tax] = await Promise.all([
    reports.netWorthSeries.execute({ userId, months, asOf: today }),
    repositories.balances.monthlyFlows(
      userId,
      DateRange.of(today.plusMonths(-(months - 1)).startOfMonth(), today),
    ),
    reports.tax.execute({
      userId,
      financialYear,
      settings: taxSettings.settings,
    }),
  ]);
  if (!series.ok) throw new Error(series.error.message);

  const points = series.value.series;
  const flowByMonth = new Map(flows.map((flow) => [flow.month, flow]));
  const totalIncome = Money.total(flows.map((flow) => flow.income));
  const totalExpense = Money.total(flows.map((flow) => flow.expense));

  return (
    <PageShell>
      <Masthead
        title="History"
        side={<span className="text-xs text-(--fg-secondary)">{financialYear.label}</span>}
      />
      <p className="text-sm text-(--fg-secondary)">
        Every month derives from the journal. A backdated entry rebuilds its month and every later balance.
      </p>

      <KpiStrip>
        <Kpi label="Income" value={rupee(totalIncome)} detail={`Last ${months} months`} />
        <Kpi label="Expenses" value={rupee(totalExpense)} detail={`Last ${months} months`} />
        <Kpi label="Saved" value={rupee(totalIncome.minus(totalExpense))} detail="Income less expenses" />
        <Kpi
          label="Net worth change"
          value={
            points.length > 1
              ? rupee(points[points.length - 1].netWorth.minus(points[0].netWorth))
              : unknown("Needs at least two months of history")
          }
          detail="Over the period shown"
        />
      </KpiStrip>

      <nav className="mb-3 flex gap-2" aria-label="History period">
        {HISTORY_PERIODS.map((period) => (
          <a
            key={period}
            href={`/history?months=${period}`}
            aria-current={period === months ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 text-xs ${period === months ? "border-(--accent) text-(--accent)" : "border-(--border) text-(--fg-secondary)"}`}
          >
            {period === 12 ? "1 year" : `${period / 12} years`}
          </a>
        ))}
      </nav>

      {points.length > 0 && (
        <NetWorthChart
          points={points.map((point) => ({
            month: point.on.toMonthKey(),
            netWorthMinor: point.netWorth.toMinorNumber(),
          }))}
        />
      )}

      {points.length === 0 ? (
        <Banner title="No history yet"><p>Record a month of activity and it will appear here.</p></Banner>
      ) : (
        <Panel title="Month by month" flush>
          <Table aria-label="Month-end net worth">
            <TableCaption className="sr-only">
              Month-end net worth with the income and expenses of each month
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">Income</TableHead>
                <TableHead className="text-right">Expenses</TableHead>
                <TableHead className="text-right">Saved</TableHead>
                <TableHead className="text-right">Assets</TableHead>
                <TableHead className="text-right">Liabilities</TableHead>
                <TableHead className="text-right">Net worth</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...points].reverse().map((point) => {
                const month = point.on.toMonthKey();
                const flow = flowByMonth.get(month);
                const saved = flow ? flow.income.minus(flow.expense) : null;
                const noFlow = "No income or expense recorded for this month";
                return (
                  <TableRow key={point.on.toISO()}>
                    <TextCell>{month}</TextCell>
                    {flow ? <FigureCell value={flow.income} /> : <UnknownCell reason={noFlow} reasonId={`history-${month}-income`} />}
                    {flow ? <FigureCell value={flow.expense} /> : <UnknownCell reason={noFlow} reasonId={`history-${month}-expense`} />}
                    {saved ? <FigureCell value={saved} tone="change" /> : <UnknownCell reason={noFlow} reasonId={`history-${month}-saved`} />}
                    <FigureCell value={point.assets} />
                    <FigureCell value={point.liabilities} />
                    <FigureCell value={point.netWorth} />
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      )}

      {tax.ok && (
        <Panel
          title={`Realised gains — ${financialYear.label}`}
          description={
            taxSettings.isAssumed
              ? "Every line names its rule. No tax settings are stored for this year, so slab income is computed at 30% — a ceiling. Set your marginal rate on Settings."
              : `Every line names the rule that produced it. Slab income is computed at your stored marginal rate of ${taxSettings.settings.slabRate.toFixed(2)}%.`
          }
        >
          {tax.value.events.length === 0 ? (
            <p className="text-sm text-(--fg-muted)">
              Nothing was sold this financial year, so there is no capital gain to report.
            </p>
          ) : (
            <>
              <KpiStrip>
                <Kpi label="Disposals" value={String(tax.value.events.length) as Figure} detail="Lots consumed" />
                <Kpi
                  label="Gain"
                  value={rupee(Money.total(tax.value.events.map((event) => event.gain)))}
                  detail="Before relief"
                />
                <Kpi
                  label="Taxable"
                  value={rupee(Money.total(tax.value.assessment.lines.map((line) => line.taxableAmount)))}
                  detail="After exemptions and set-off"
                />
                <Kpi label="Tax" value={rupee(tax.value.assessment.totalTax)} detail="At the assessed rates" />
              </KpiStrip>

              <Table aria-label="Tax lines" density="compact">
                <TableCaption className="sr-only">Tax lines with their rule provenance</TableCaption>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Bucket</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tax.value.assessment.lines.map((line, index) => (
                    <TableRow key={`${line.eventId}-${index}`}>
                      <TextCell>{line.label}</TextCell>
                      <TextCell secondary={`(${line.ruleVersion})`}>{line.rule}</TextCell>
                      <TextCell>{line.bucket}</TextCell>
                      <FigureCell value={line.taxableAmount} />
                      <FigureCell value={line.tax} />
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {tax.value.assessment.warnings.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-(--warn)">
                  {tax.value.assessment.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              <p className="mt-3 text-xs text-(--fg-muted)">
                Computed at the top slab until a settings screen collects your own rate, so the
                figure is a ceiling rather than an underestimate.
              </p>
            </>
          )}
        </Panel>
      )}
    </PageShell>
  );
}
