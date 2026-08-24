import type { Metadata } from "next";
import { PiggyBank } from "lucide-react";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Card, EmptyState, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
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
    <>
      <PageHeader
        title="Deposits"
        subtitle="FDs, RDs, PPF, EPF and NPS. Every value is computed from the deposit's own terms at read time — there is no accrual job, and so nothing to go stale."
        badge={<Pill tone="brand">Phase 4</Pill>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total value" value={total} hint="Computed today" />
        <Stat
          label="Accrued, unbooked"
          value={accruedTotal}
          hint="Earned but not yet in the journal"
        />
        <Stat label="Deposits" value={<span className="tnum">{positions.length}</span>} hint="Valued" />
        <Stat
          label="Next maturity"
          value={
            maturing.length > 0 ? (
              <span className="tnum">{maturing[0].daysToMaturity} days</span>
            ) : (
              <span className="text-gray-500">—</span>
            )
          }
          hint={maturing.length > 0 ? maturing[0].deposit.displayName : "Nothing maturing"}
        />
      </div>

      {maturing.length > 0 && (
        <Card
          title="Maturity ladder"
          subtitle="When each deposit comes due, and what it will be worth on the day."
          className="mb-6"
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
        </Card>
      )}

      <section className="panel mb-6 p-0">
        {positions.length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            title="No deposits yet"
            body="Add a fixed or recurring deposit, or a PPF, EPF or NPS account. Maturity values are computed from the terms, so they match the certificate."
          />
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Deposits with kind, computed value, booked value and maturity
              </caption>
              <thead>
                <tr className="border-b border-gray-600">
                  <th scope="col" className="metric-label px-4 py-3 text-left">Deposit</th>
                  <th scope="col" className="metric-label px-4 py-3 text-left">Kind</th>
                  <th scope="col" className="metric-label px-4 py-3 text-left">Matures</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Value today</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">In the journal</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Accrued</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => (
                  <tr key={position.deposit.id.value} className="border-b border-gray-600/50 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-100">{position.deposit.displayName}</p>
                      {position.deposit.account.institution && (
                        <p className="text-xs text-gray-500">{position.deposit.account.institution}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{KIND_LABELS[position.deposit.kind]}</td>
                    <td className="tnum px-4 py-3 text-gray-400">
                      {position.maturesOn ? position.maturesOn.toISO() : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MoneyText value={position.value} tone="neutral" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MoneyText value={position.booked} tone="neutral" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MoneyText value={position.unbooked} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {unvalued.length > 0 && (
        <Card
          title="Priced, not accrued"
          subtitle="These hold units of a scheme fund. Their value is units × NAV, and without a NAV there is no value to show."
          className="mb-6"
        >
          <ul className="space-y-1 text-sm text-gray-300">
            {unvalued.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Add a deposit"
        subtitle="The terms are the whole record: a maturity value computed from them matches the bank's certificate, and there is nowhere for a stale balance to live."
      >
        <AddDepositForm />
      </Card>
    </>
  );
}

const KIND_LABELS: Record<string, string> = {
  FIXED_DEPOSIT: "Fixed deposit",
  RECURRING_DEPOSIT: "Recurring deposit",
  PPF: "PPF",
  EPF: "EPF",
  NPS: "NPS",
};
