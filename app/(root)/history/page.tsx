import type { Metadata } from "next";
import { CalendarClock } from "lucide-react";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate, DateRange, FinancialYear } from "@/core/time";
import { Percentage } from "@/core/numeric";
import { Card, EmptyState, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
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
 * The tax panel is the other half: realised gains for the financial year, with the
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
   * is a ceiling rather than an underestimate — and the panel says which of the
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
    <>
      <PageHeader
        title="History"
        subtitle="Every month derives from the journal. A backdated entry rebuilds its month and every later balance."
        badge={<Pill tone="brand">{financialYear.label}</Pill>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Income" value={totalIncome} hint={`Last ${months} months`} />
        <Stat label="Expenses" value={totalExpense} hint={`Last ${months} months`} />
        <Stat label="Saved" value={totalIncome.minus(totalExpense)} hint="Income less expenses" />
        <Stat
          label="Net worth change"
          value={
            points.length > 1
              ? points[points.length - 1].netWorth.minus(points[0].netWorth)
              : null
          }
          hint="Over the period shown"
        />
      </div>

      <nav className="mb-3 flex gap-2" aria-label="History period">
        {HISTORY_PERIODS.map((period) => (
          <a
            key={period}
            href={`/history?months=${period}`}
            aria-current={period === months ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 text-xs ${period === months ? "border-violet-500 text-violet-300" : "border-gray-600 text-gray-400"}`}
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

      <section className="panel mb-6 p-0">
        {points.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No history yet" body="Record a month of activity and it will appear here." />
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Month-end net worth with the income and expenses of each month
              </caption>
              <thead>
                <tr className="border-b border-gray-600">
                  <th scope="col" className="metric-label px-4 py-3 text-left">Month</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Income</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Expenses</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Saved</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Assets</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Liabilities</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Net worth</th>
                </tr>
              </thead>
              <tbody>
                {[...points].reverse().map((point) => {
                  const flow = flowByMonth.get(point.on.toMonthKey());
                  const saved = flow ? flow.income.minus(flow.expense) : null;
                  return (
                    <tr key={point.on.toISO()} className="border-b border-gray-600/50 last:border-0">
                      <td className="tnum px-4 py-3 text-gray-300">{point.on.toMonthKey()}</td>
                      <td className="px-4 py-3 text-right"><MoneyText value={flow?.income ?? null} tone="neutral" /></td>
                      <td className="px-4 py-3 text-right"><MoneyText value={flow?.expense ?? null} tone="neutral" /></td>
                      <td className="px-4 py-3 text-right"><MoneyText value={saved} /></td>
                      <td className="px-4 py-3 text-right"><MoneyText value={point.assets} tone="neutral" /></td>
                      <td className="px-4 py-3 text-right"><MoneyText value={point.liabilities} tone="neutral" /></td>
                      <td className="px-4 py-3 text-right"><MoneyText value={point.netWorth} tone="neutral" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {tax.ok && (
        <Card
          title={`Realised gains — ${financialYear.label}`}
          subtitle={
            taxSettings.isAssumed
              ? "Every line names its rule. No tax settings are stored for this year, so slab income is computed at 30% — a ceiling. Set your marginal rate on Settings."
              : `Every line names the rule that produced it. Slab income is computed at your stored marginal rate of ${taxSettings.settings.slabRate.toFixed(2)}%.`
          }
        >
          {tax.value.events.length === 0 ? (
            <p className="text-sm text-gray-500">
              Nothing was sold this financial year, so there is no capital gain to report.
            </p>
          ) : (
            <>
              <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                  label="Disposals"
                  value={<span className="tnum">{tax.value.events.length}</span>}
                  hint="Lots consumed"
                />
                <Stat
                  label="Gain"
                  value={Money.total(tax.value.events.map((event) => event.gain))}
                  hint="Before relief"
                />
                <Stat
                  label="Taxable"
                  value={Money.total(tax.value.assessment.lines.map((line) => line.taxableAmount))}
                  hint="After exemptions and set-off"
                />
                <Stat label="Tax" value={tax.value.assessment.totalTax} hint="At the assessed rates" />
              </div>

              <div className="table-scroll">
                <table className="w-full text-sm">
                  <caption className="sr-only">Tax lines with their rule provenance</caption>
                  <thead>
                    <tr className="border-b border-gray-600">
                      <th scope="col" className="metric-label px-3 py-2 text-left">Line</th>
                      <th scope="col" className="metric-label px-3 py-2 text-left">Rule</th>
                      <th scope="col" className="metric-label px-3 py-2 text-left">Bucket</th>
                      <th scope="col" className="metric-label px-3 py-2 text-right">Taxable</th>
                      <th scope="col" className="metric-label px-3 py-2 text-right">Tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tax.value.assessment.lines.map((line, index) => (
                      <tr key={`${line.eventId}-${index}`} className="border-b border-gray-600/50 last:border-0">
                        <td className="px-3 py-2 text-gray-300">{line.label}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">
                          {line.rule}
                          <span className="ml-1 text-gray-600">({line.ruleVersion})</span>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-400">{line.bucket}</td>
                        <td className="px-3 py-2 text-right"><MoneyText value={line.taxableAmount} tone="neutral" /></td>
                        <td className="px-3 py-2 text-right"><MoneyText value={line.tax} tone="neutral" /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {tax.value.assessment.warnings.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-amber-500">
                  {tax.value.assessment.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}

              <p className="mt-3 text-xs text-gray-500">
                Computed at the top slab until a settings screen collects your own rate, so the
                figure is a ceiling rather than an underestimate.
              </p>
            </>
          )}
        </Card>
      )}
    </>
  );
}
