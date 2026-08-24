import type { Metadata } from "next";
import Link from "next/link";
import { Landmark } from "lucide-react";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Card, EmptyState, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import AddLoanForm from "./add-loan-form";

export const metadata: Metadata = { title: "Loans" };

/**
 * Loans.
 *
 * The **effective** rate sits beside the quoted one on every row, not only on flat
 * loans. On a reducing-balance loan the two are the same and the column is dull;
 * on a flat-rate loan it is roughly double, and putting it in the same place every
 * time is what makes the difference legible rather than something the user has to
 * know to look for.
 */
export default async function Page() {
  await connection();

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const result = await services().lending.listLoans.execute({ userId, asOf: today });
  if (!result.ok) throw new Error(result.error.message);

  const loans = result.value.loans;
  const owed = Money.total(loans.map((summary) => summary.bookedOutstanding));
  const monthly = Money.total(loans.map((summary) => summary.instalment));

  return (
    <>
      <PageHeader
        title="Loans"
        subtitle="Schedules are generated from the terms, with the final instalment adjusted so the balance closes at exactly zero."
        badge={<Pill tone="brand">Phase 4</Pill>}
        action={
          loans.length > 0 ? (
            <Link href="/loans/payoff" className="ghost-btn h-10 px-4 text-xs">
              Compare payoff plans
            </Link>
          ) : undefined
        }
      />

      {loans.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Owed" value={owed} hint="From the journal" />
          <Stat label="Monthly commitment" value={monthly} hint="Sum of the instalments" />
          <Stat label="Loans" value={<span className="tnum">{loans.length}</span>} hint="Open" />
          <Stat
            label="Interest over the terms"
            value={Money.total(loans.map((summary) => summary.totalInterest))}
            hint="If every loan runs to term"
          />
        </div>
      )}

      <section className="panel mb-6 p-0">
        {loans.length === 0 ? (
          <EmptyState
            icon={Landmark}
            title="No loans yet"
            body="Add a loan with its principal, rate and term. The EMI, the schedule and — for a flat-rate loan — the rate it really costs are all computed from those three."
          />
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Loans with instalment, outstanding balance, quoted and effective rates
              </caption>
              <thead>
                <tr className="border-b border-gray-600">
                  <th scope="col" className="metric-label px-4 py-3 text-left">Loan</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Instalment</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Owed</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Scheduled</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Quoted</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Effective</th>
                  <th scope="col" className="metric-label px-4 py-3 text-left">Closes</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((summary) => {
                  const flat = summary.loan.terms.interestType === "FLAT";
                  return (
                    <tr key={summary.loan.id.value} className="border-b border-gray-600/50 last:border-0">
                      <td className="px-4 py-3">
                        <Link
                          href={`/loans/${summary.loan.id.value}`}
                          className="font-medium text-gray-100 hover:text-brand-400"
                        >
                          {summary.loan.displayName}
                        </Link>
                        <p className="text-xs text-gray-500">
                          {summary.loan.kind.toLowerCase()} · {flat ? "flat rate" : "reducing balance"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-right"><MoneyText value={summary.instalment} tone="neutral" /></td>
                      <td className="px-4 py-3 text-right"><MoneyText value={summary.bookedOutstanding} tone="neutral" /></td>
                      <td className="px-4 py-3 text-right"><MoneyText value={summary.scheduledOutstanding} tone="neutral" /></td>
                      <td className="tnum px-4 py-3 text-right text-gray-400">
                        {summary.loan.terms.annualRate.percent.toFixed(2)}%
                      </td>
                      <td className="tnum px-4 py-3 text-right">
                        <span className={flat ? "text-amber-500" : "text-gray-400"}>
                          {summary.effectiveRate.percent.toFixed(2)}%
                        </span>
                      </td>
                      <td className="tnum px-4 py-3 text-gray-400">
                        {summary.closesOn ? summary.closesOn.toISO() : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Card
        title="Add a loan"
        subtitle="A loan disbursed into an account you track raises the debt and the balance together, so net worth is unchanged — borrowing does not make anyone richer."
      >
        <AddLoanForm />
      </Card>
    </>
  );
}
