import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import { BudgetLedger } from "@/domain/banking";
import { Card, EmptyState, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import BudgetForm, { type CategoryOption } from "./budget-form";

export const metadata: Metadata = { title: "Budgets" };

/** Three months: the one being spent, and the two behind it for context. */
const MONTHS_SHOWN = 3;

/**
 * Budgets, in envelope form.
 *
 * The number that makes this an envelope budget rather than a spending report is
 * `carriedIn`: last month's leftover, or last month's overspend when the category
 * carries over. Both are shown, because "you have ₹257 left" and "you have ₹257
 * left, ₹1,000 of which is this month's and −₹743 came from last month" are
 * different facts and the second is the one that changes behaviour.
 */
export default async function Page() {
  await connection();

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const { banking, repositories } = services();
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const months = Array.from({ length: MONTHS_SHOWN }, (_unused, index) =>
    today.plusMonths(index - (MONTHS_SHOWN - 1)).toMonthKey(),
  );

  const [plan, accounts] = await Promise.all([
    banking.planBudgets.execute({ userId, months }),
    repositories.accounts.list(userId),
  ]);
  if (!plan.ok) throw new Error(plan.error.message);

  const byId = new Map(accounts.map((account) => [account.id.value, account]));
  const current = plan.value.months[plan.value.months.length - 1];
  const options: CategoryOption[] = accounts
    .filter((account) => account.type.isIncomeStatement && account.type.name === "EXPENSE")
    .map((account) => ({ id: account.id.value, label: account.code.toString() }));

  return (
    <>
      <PageHeader
        title="Budgets"
        subtitle="Actual's envelope arithmetic, exactly: a leftover carries forward, and an overspend either follows the category or is charged to the month."
        badge={<Pill tone="brand">Phase 2</Pill>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Budgeted" value={current.totalBudgeted} hint={current.month} />
        <Stat label="To budget" value={current.toBudget} hint="Available less allocated" />
        <Stat
          label="Last month's overspend"
          value={current.lastMonthOverspent}
          hint="Charged to this month"
        />
        <Stat
          label="Envelopes"
          value={<span className="tnum">{current.envelopes.length}</span>}
          hint="Categories with a limit"
        />
      </div>

      {current.warnings.length > 0 && (
        <Card title="Over-allocated" className="mb-6">
          <ul className="space-y-1 text-sm text-amber-500">
            {current.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Card>
      )}

      {plan.value.months.map((month) => (
        <section key={month.month} className="panel mb-6 p-0">
          <div className="flex items-center justify-between border-b border-gray-600 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-100">{month.month}</h2>
            <p className="text-xs text-gray-500">
              to budget <MoneyText value={month.toBudget} tone="neutral" />
            </p>
          </div>

          {month.envelopes.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No budgets for this month"
              body="Set a limit on a category below. A recurring limit applies to every month; a month-specific one overrides it."
            />
          ) : (
            <div className="table-scroll">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Envelopes for {month.month} with budgeted, spent, carried in and left
                </caption>
                <thead>
                  <tr className="border-b border-gray-600">
                    <th scope="col" className="metric-label px-4 py-3 text-left">Category</th>
                    <th scope="col" className="metric-label px-4 py-3 text-right">Budgeted</th>
                    <th scope="col" className="metric-label px-4 py-3 text-right">Spent</th>
                    <th scope="col" className="metric-label px-4 py-3 text-right">Carried in</th>
                    <th scope="col" className="metric-label px-4 py-3 text-right">Left</th>
                    <th scope="col" className="metric-label px-4 py-3 text-right">Used</th>
                  </tr>
                </thead>
                <tbody>
                  {month.envelopes.map((envelope) => {
                    const used = BudgetLedger.utilisationBasisPoints(envelope.spent, envelope.budgeted);
                    return (
                      <tr key={envelope.accountId.value} className="border-b border-gray-600/50 last:border-0">
                        <td className="px-4 py-3 text-gray-100">
                          {byId.get(envelope.accountId.value)?.code.toString() ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <MoneyText value={envelope.budgeted} tone="neutral" />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <MoneyText value={envelope.spent.abs()} tone="neutral" />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <MoneyText value={envelope.carriedIn} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <MoneyText value={envelope.leftover} />
                        </td>
                        <td className="tnum px-4 py-3 text-right text-gray-400">
                          {used === null ? "—" : `${Number(used) / 100}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}

      <Card
        title="Set a budget"
        subtitle="Leave the month blank for a recurring limit. Carry-over makes the category keep its own leftover — and its own overspend."
      >
        <BudgetForm categories={options} defaultMonth={current.month} />
      </Card>
    </>
  );
}
