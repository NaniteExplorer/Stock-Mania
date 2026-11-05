import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { rupee, type Figure } from "@/core/format";
import { Kpi, KpiStrip, Masthead, Page as PageShell, Panel } from "@/components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FigureCell, TextCell } from "@/components/ui/data-cell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { InstitutionMark } from "@/ui/provider-picker";
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
    <PageShell>
      <Masthead
        title="Loans"
        hero={loans.length > 0 ? rupee(owed) : undefined}
        side={
          loans.length > 0 ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/loans/payoff">Compare payoff plans</Link>
            </Button>
          ) : undefined
        }
      />
      <p className="text-sm text-(--fg-secondary)">
        Schedules are generated from the terms, with the final instalment adjusted so the balance closes at exactly zero.{" "}
        <span className="text-(--fg-muted)">Phase 4</span>
      </p>

      {loans.length > 0 && (
        <KpiStrip>
          <Kpi label="Owed" value={rupee(owed)} detail="From the journal" />
          <Kpi label="Monthly commitment" value={rupee(monthly)} detail="Sum of the instalments" />
          <Kpi label="Loans" value={String(loans.length) as Figure} detail="Open" />
          <Kpi
            label="Interest over the terms"
            value={rupee(Money.total(loans.map((summary) => summary.totalInterest)))}
            detail="If every loan runs to term"
          />
        </KpiStrip>
      )}

      {loans.length === 0 ? (
        <Banner title="No loans yet">
          <p>Add a loan with its principal, rate and term. The EMI, the schedule and — for a flat-rate loan — the rate it really costs are all computed from those three.</p>
        </Banner>
      ) : (
        <Panel title="Your loans" flush>
          <Table aria-label="Loans with instalment, outstanding balance, quoted and effective rates">
              <TableHeader>
                <TableRow>
                  <TableHead>Loan</TableHead>
                  <TableHead className="text-right">Instalment</TableHead>
                  <TableHead className="text-right">Owed</TableHead>
                  <TableHead className="text-right">Scheduled</TableHead>
                  <TableHead className="text-right">Quoted</TableHead>
                  <TableHead className="text-right">Effective</TableHead>
                  <TableHead>Closes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loans.map((summary) => {
                  const flat = summary.loan.terms.interestType === "FLAT";
                  return (
                    <TableRow key={summary.loan.id.value}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <InstitutionMark institution={summary.loan.account.institution} />
                          <div>
                            <Link
                              href={`/loans/${summary.loan.id.value}`}
                              className="font-medium text-(--fg) hover:text-(--accent)"
                            >
                              {summary.loan.displayName}
                            </Link>
                            <p className="text-xs text-(--fg-muted)">
                              {summary.loan.kind.toLowerCase()} · {flat ? "flat rate" : "reducing balance"}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <FigureCell value={summary.instalment} />
                      <FigureCell value={summary.bookedOutstanding} />
                      <FigureCell value={summary.scheduledOutstanding} />
                      <TextCell className="text-right tabular-nums">
                        {summary.loan.terms.annualRate.percent.toFixed(2)}%
                      </TextCell>
                      <TextCell className={flat ? "text-right tabular-nums text-(--warn)" : "text-right tabular-nums"}>
                        {summary.effectiveRate.percent.toFixed(2)}%
                      </TextCell>
                      <TextCell className="tabular-nums">
                        {summary.closesOn ? summary.closesOn.toISO() : "—"}
                      </TextCell>
                    </TableRow>
                  );
                })}
              </TableBody>
          </Table>
        </Panel>
      )}

      <Panel
        title="Add a loan"
        description="A loan disbursed into an account you track raises the debt and the balance together, so net worth is unchanged — borrowing does not make anyone richer."
      >
        <AddLoanForm />
      </Panel>
    </PageShell>
  );
}
