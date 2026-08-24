import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { CashAsset } from "@/domain/assets";
import { HomeLoan } from "@/domain/loans";
import { Card, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { currentUserId, services } from "@/infra/container";
import LoanPaymentForms from "./loan-payment-forms";

export const metadata: Metadata = { title: "Loan" };

/** How many schedule rows to render. A 240-row table needs no pagination; 600 does. */
const ROWS_SHOWN = 60;

/**
 * One loan, with its amortisation schedule.
 *
 * The schedule is generated on every request from the terms and the prepayments —
 * never read back from a saved copy, because a rate revision or a prepayment makes
 * a saved schedule a description of a loan the borrower no longer has.
 *
 * The row marked *adjusted* at the end is the mandatory final-period adjustment:
 * its principal is whatever remains, so the closing balance is exactly zero.
 * Without it, per-period rounding leaves a few paise outstanding forever and the
 * loan never closes.
 */
export default async function Page({ params }: { params: Promise<{ accountId: string }> }) {
  await connection();

  const { accountId } = await params;
  const userId = await currentUserId();
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));

  const { lending, repositories } = services();
  const accounts = await repositories.accounts.list(userId, { includeClosed: true });
  const loans = await repositories.lending.loadLoans(userId, accounts);
  const loan = loans.find((candidate) => candidate.id.value === accountId);
  if (!loan) notFound();

  const schedule = loan.schedule();
  const booked = await repositories.balances.balanceOf(userId, AccountId.from(accountId), today);
  const comparison = loan.quotedVersusEffective();
  const payFrom = accounts
    .filter((account) => CashAsset.classify(account) !== null)
    .map((account) => ({ id: account.id.value, label: account.displayName }));

  // The next unpaid period, so the form defaults to the one the user owes.
  const nextPeriod =
    schedule.rows.find((row) => row.on.isAfter(today) && !row.note?.startsWith("Prepayment"))?.period ??
    schedule.rows[schedule.rows.length - 1]?.period ??
    1;

  const deductible =
    loan instanceof HomeLoan
      ? loan.deductibleInterest(today.startOfMonth().plusMonths(-11), today)
      : null;

  return (
    <>
      <PageHeader
        title={loan.displayName}
        subtitle={`${loan.kind.toLowerCase()} loan · ${loan.terms.periods} instalments · ${
          loan.terms.interestType === "FLAT" ? "flat rate" : "reducing balance"
        }`}
        badge={<Pill tone="brand">{loan.terms.annualRate.percent.toFixed(2)}% quoted</Pill>}
        action={
          <Link href="/loans" className="ghost-btn h-10 px-4 text-xs">
            All loans
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Instalment" value={loan.instalment()} hint="Every period" />
        <Stat label="Owed" value={booked} hint="From the journal" />
        <Stat label="Interest over the term" value={schedule.totalInterest} hint="If it runs to term" />
        <Stat
          label="Effective rate"
          value={<span className="tnum">{comparison.effective.percent.toFixed(2)}%</span>}
          hint={
            loan.terms.interestType === "FLAT"
              ? `Quoted ${comparison.quoted.percent.toFixed(2)}% — the real cost is higher`
              : "Same as quoted, on a reducing balance"
          }
        />
      </div>

      {loan.terms.interestType === "FLAT" && (
        <Card title="What a flat rate actually costs" className="mb-6">
          <p className="text-sm text-gray-300">
            This loan is quoted at {comparison.quoted.percent.toFixed(2)}% flat, which charges interest
            on the whole principal for the whole term regardless of what has been repaid. The
            equivalent reducing-balance rate — the one that produces this same instalment — is{" "}
            <span className="tnum text-amber-500">{comparison.effective.percent.toFixed(2)}%</span>.
            Both are shown everywhere this loan appears.
          </p>
        </Card>
      )}

      {deductible && deductible.isPositive && (
        <Card title="Interest paid, last twelve months" className="mb-6">
          <p className="text-sm text-gray-300">
            <MoneyText value={deductible} tone="neutral" /> — capped at ₹2,00,000 for a self-occupied
            property under §24(b). The uncapped figure is on the schedule below.
          </p>
        </Card>
      )}

      <section className="panel mb-6 p-0">
        <div className="flex items-center justify-between border-b border-gray-600 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-100">Amortisation</h2>
          <p className="text-xs text-gray-500">
            {schedule.rows.length} rows · principal repaid{" "}
            <MoneyText value={schedule.principalRepaid} tone="neutral" /> · closes{" "}
            {schedule.closedOn ? schedule.closedOn.toISO() : "—"}
          </p>
        </div>
        <div className="table-scroll max-h-[32rem] overflow-y-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Amortisation schedule with opening balance, instalment, interest, principal and closing balance
            </caption>
            <thead className="sticky top-0 bg-gray-900">
              <tr className="border-b border-gray-600">
                <th scope="col" className="metric-label px-4 py-3 text-left">#</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Date</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Opening</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Instalment</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Interest</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Principal</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Closing</th>
              </tr>
            </thead>
            <tbody>
              {schedule.rows.slice(0, ROWS_SHOWN).map((row, index) => (
                <tr
                  key={`${row.period}-${row.on.toISO()}-${index}`}
                  className="border-b border-gray-600/50 last:border-0"
                >
                  <td className="tnum px-4 py-2 text-gray-500">{row.period}</td>
                  <td className="tnum px-4 py-2 text-gray-400">
                    {row.on.toISO()}
                    {row.note && <span className="ml-2 text-xs text-brand-400">{row.note}</span>}
                  </td>
                  <td className="px-4 py-2 text-right"><MoneyText value={row.opening} tone="neutral" /></td>
                  <td className="px-4 py-2 text-right"><MoneyText value={row.instalment} tone="neutral" /></td>
                  <td className="px-4 py-2 text-right"><MoneyText value={row.interest} tone="neutral" /></td>
                  <td className="px-4 py-2 text-right"><MoneyText value={row.principal} tone="neutral" /></td>
                  <td className="px-4 py-2 text-right"><MoneyText value={row.closing} tone="neutral" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {schedule.rows.length > ROWS_SHOWN && (
          <p className="px-5 py-3 text-xs text-gray-500">
            Showing the first {ROWS_SHOWN} of {schedule.rows.length} rows. The final row adjusts the
            instalment so the balance closes at exactly zero.
          </p>
        )}
      </section>

      <Card
        title="Record a payment"
        subtitle="An instalment is split into principal and interest by the schedule, and posted as a transfer plus a charge — the split is never typed by hand."
      >
        <LoanPaymentForms
          loanAccountId={accountId}
          accounts={payFrom}
          defaultPeriod={nextPeriod}
          defaultDate={today.toISO()}
        />
      </Card>
    </>
  );
}
