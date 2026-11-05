import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { CashAsset } from "@/domain/assets";
import { HomeLoan } from "@/domain/loans";
import { rupee, type Figure } from "@/core/format";
import { Kpi, KpiStrip, Masthead, Page as PageShell, Panel } from "@/components/ui/page-shell";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FigureCell, TextCell } from "@/components/ui/data-cell";
import { Button } from "@/components/ui/button";
import { InstitutionMark } from "@/ui/provider-picker";
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
    .map((account) => ({ id: account.id.value, label: account.displayName, institution: account.institution }));

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
    <PageShell>
      <Masthead
        title={loan.displayName}
        hero={rupee(booked)}
        side={
          <Button asChild variant="ghost" size="sm">
            <Link href="/loans">All loans</Link>
          </Button>
        }
      />
      <p className="text-sm text-(--fg-secondary)">
        {`${loan.kind.toLowerCase()} loan · ${loan.terms.periods} instalments · ${
          loan.terms.interestType === "FLAT" ? "flat rate" : "reducing balance"
        }`}
        <span className="text-(--fg-muted)"> · {loan.terms.annualRate.percent.toFixed(2)}% quoted</span>
      </p>

      {/* The lender, with its mark: the same row the account detail page draws. */}
      {loan.account.institution && (
        <div className="flex items-center gap-3">
          <InstitutionMark institution={loan.account.institution} />
          <p className="text-sm text-(--fg-secondary)">{loan.account.institution}</p>
        </div>
      )}

      <KpiStrip>
        <Kpi label="Instalment" value={rupee(loan.instalment())} detail="Every period" />
        <Kpi label="Owed" value={rupee(booked)} detail="From the journal" />
        <Kpi label="Interest over the term" value={rupee(schedule.totalInterest)} detail="If it runs to term" />
        <Kpi
          label="Effective rate"
          value={`${comparison.effective.percent.toFixed(2)}%` as Figure}
          detail={
            loan.terms.interestType === "FLAT"
              ? `Quoted ${comparison.quoted.percent.toFixed(2)}% — the real cost is higher`
              : "Same as quoted, on a reducing balance"
          }
        />
      </KpiStrip>

      {loan.terms.interestType === "FLAT" && (
        <Panel title="What a flat rate actually costs">
          <p className="text-sm text-(--fg-secondary)">
            This loan is quoted at {comparison.quoted.percent.toFixed(2)}% flat, which charges interest
            on the whole principal for the whole term regardless of what has been repaid. The
            equivalent reducing-balance rate — the one that produces this same instalment — is{" "}
            <span className="tabular-nums text-(--warn)">{comparison.effective.percent.toFixed(2)}%</span>.
            Both are shown everywhere this loan appears.
          </p>
        </Panel>
      )}

      {deductible && deductible.isPositive && (
        <Panel title="Interest paid, last twelve months">
          <p className="text-sm text-(--fg-secondary)">
            <span className="tabular-nums">{rupee(deductible)}</span> — capped at ₹2,00,000 for a self-occupied
            property under §24(b). The uncapped figure is on the schedule below.
          </p>
        </Panel>
      )}

      <Panel
        title="Amortisation"
        description={`${schedule.rows.length} rows · principal repaid ${rupee(schedule.principalRepaid)} · closes ${
          schedule.closedOn ? schedule.closedOn.toISO() : "—"
        }`}
        flush
      >
        <Table density="compact" aria-label="Amortisation schedule with opening balance, instalment, interest, principal and closing balance">
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Instalment</TableHead>
              <TableHead className="text-right">Interest</TableHead>
              <TableHead className="text-right">Principal</TableHead>
              <TableHead className="text-right">Closing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedule.rows.slice(0, ROWS_SHOWN).map((row, index) => (
              <TableRow key={`${row.period}-${row.on.toISO()}-${index}`}>
                <TextCell className="tabular-nums">{row.period}</TextCell>
                <TextCell className="tabular-nums" secondary={row.note ?? undefined}>
                  {row.on.toISO()}
                </TextCell>
                <FigureCell value={row.opening} />
                <FigureCell value={row.instalment} />
                <FigureCell value={row.interest} />
                <FigureCell value={row.principal} />
                <FigureCell value={row.closing} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
      {schedule.rows.length > ROWS_SHOWN && (
        <p className="text-xs text-(--fg-muted)">
          Showing the first {ROWS_SHOWN} of {schedule.rows.length} rows. The final row adjusts the
          instalment so the balance closes at exactly zero.
        </p>
      )}

      <Panel
        title="Record a payment"
        description="An instalment is split into principal and interest by the schedule, and posted as a transfer plus a charge — the split is never typed by hand."
      >
        <LoanPaymentForms
          loanAccountId={accountId}
          accounts={payFrom}
          defaultPeriod={nextPeriod}
          defaultDate={today.toISO()}
        />
      </Panel>
    </PageShell>
  );
}
