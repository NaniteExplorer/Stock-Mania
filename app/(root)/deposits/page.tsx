import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { rupee, unknown, type Figure } from "@/core/format";
import { Kpi, KpiStrip, Masthead, Page as PageShell, Panel } from "@/components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionCell, FigureCell, TextCell } from "@/components/ui/data-cell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { InstitutionMark } from "@/ui/provider-picker";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import MaturityLadder from "./maturity-ladder";
import AddDepositForm from "./add-deposit-form";

export const metadata: Metadata = { title: "Deposits" };

/**
 * Deposits and retirement schemes.
 *
 * Two figures per deposit, deliberately: what it is **worth**, computed from its
 * terms, and what the **journal has recorded**. They differ by the interest that
 * has accrued and not yet been credited, which is a real fact about a real deposit
 * rather than a discrepancy — and naming it is what stops someone "fixing" the
 * ledger to match, or the value to match the ledger.
 *
 * NPS appears in its own list. It is priced from a NAV rather than accrued, so
 * without a NAV there is no value, and showing a zero would be a claim.
 */
export default async function Page() {
  await connection();

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const result = await services().lending.listDeposits.execute({ userId, asOf: today });
  if (!result.ok) throw new Error(result.error.message);

  const { positions, total, unvalued } = result.value;
  const accruedTotal = Money.total(positions.map((position) => position.unbooked));
  const maturing = positions
    .filter((position) => position.maturesOn !== null)
    .sort((a, b) => a.maturesOn!.compareTo(b.maturesOn!));

  return (
    <PageShell>
      <Masthead title="Deposits" hero={rupee(total)} />
      <p className="text-sm text-(--fg-secondary)">
        FDs, RDs, PPF, EPF and NPS. Every value is computed from the deposit&apos;s own terms at read time — there is no accrual job, and so nothing to go stale.{" "}
        <span className="text-(--fg-muted)">Phase 4</span>
      </p>

      <KpiStrip>
        <Kpi label="Total value" value={rupee(total)} detail="Computed today" />
        <Kpi label="Accrued, unbooked" value={rupee(accruedTotal)} detail="Earned but not yet in the journal" />
        <Kpi label="Deposits" value={String(positions.length) as Figure} detail="Valued" />
        <Kpi
          label="Next maturity"
          value={
            maturing.length > 0
              ? (`${maturing[0].daysToMaturity} days` as Figure)
              : unknown("No deposit has a maturity date")
          }
          detail={maturing.length > 0 ? maturing[0].deposit.displayName : "Nothing maturing"}
        />
      </KpiStrip>

      {maturing.length > 0 && (
        <Panel
          title="Maturity ladder"
          description="When each deposit comes due, and what it will be worth on the day."
        >
          <MaturityLadder
            rungs={maturing.map((position) => ({
              label: position.deposit.displayName,
              maturesOn: position.maturesOn!.toISO(),
              days: position.daysToMaturity ?? 0,
              value: position.value.toDecimalString(),
            }))}
            today={today.toISO()}
          />
        </Panel>
      )}

      {positions.length === 0 ? (
        <Banner title="No deposits yet">
          <p>Add a fixed or recurring deposit, or a PPF, EPF or NPS account. Maturity values are computed from the terms, so they match the certificate.</p>
        </Banner>
      ) : (
        <Panel title="Your deposits" flush>
          <Table aria-label="Deposits with kind, computed value, booked value and maturity">
            <TableHeader>
              <TableRow>
                <TableHead>Deposit</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Matures</TableHead>
                <TableHead className="text-right">Value today</TableHead>
                <TableHead className="text-right">In the journal</TableHead>
                <TableHead className="text-right">Accrued</TableHead>
                <TableHead className="text-right">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {positions.map((position) => (
                <TableRow key={position.deposit.id.value}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <InstitutionMark institution={position.deposit.account.institution} />
                      <div>
                        <p className="font-medium text-(--fg)">{position.deposit.displayName}</p>
                        {position.deposit.account.institution && (
                          <p className="text-xs text-(--fg-muted)">{position.deposit.account.institution}</p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TextCell>{KIND_LABELS[position.deposit.kind]}</TextCell>
                  <TextCell className="tabular-nums">
                    {position.maturesOn ? position.maturesOn.toISO() : "—"}
                  </TextCell>
                  <FigureCell value={position.value} />
                  <FigureCell value={position.booked} />
                  <FigureCell value={position.unbooked} className={signTone(position.unbooked)} />
                  <ActionCell className="text-right">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/accounts/${position.deposit.account.id.value}`}>
                        Close or correct
                      </Link>
                    </Button>
                  </ActionCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}

      {unvalued.length > 0 && (
        <Panel
          title="Priced, not accrued"
          description="These hold units of a scheme fund. Their value is units × NAV, and without a NAV there is no value to show."
        >
          <ul className="space-y-1 text-sm text-(--fg-secondary)">
            {unvalued.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="Add a deposit"
        description="Enter your bank's own ROI for an FD or RD. EPF uses financial-year rates; NPS uses scheme units × NAV, not an assumed ROI. The terms are the record, so computed maturity can match the certificate."
      >
        <AddDepositForm />
      </Panel>
    </PageShell>
  );
}

/** Library gap (F.7 Recompose A): FigureCell has no gain/loss tone; applied here with tokens. */
function signTone(value: Money): string | undefined {
  return value.isNegative ? "text-(--loss)" : value.isPositive ? "text-(--gain)" : undefined;
}

const KIND_LABELS: Record<string, string> = {
  FIXED_DEPOSIT: "Fixed deposit",
  RECURRING_DEPOSIT: "Recurring deposit",
  PPF: "PPF",
  EPF: "EPF",
  NPS: "NPS",
};
