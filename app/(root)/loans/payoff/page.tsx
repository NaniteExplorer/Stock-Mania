import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Card, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { currentUserId, services } from "@/infra/container";

export const metadata: Metadata = { title: "Payoff plans" };

/**
 * Avalanche versus snowball.
 *
 * Both are shown, with the interest each costs and the order each clears debts in,
 * and neither is labelled "recommended". Avalanche always pays less interest —
 * that is arithmetic. Snowball clears a debt sooner, which is a behavioural
 * argument and a real one. Presenting the cost of the choice and letting the user
 * make it is the honest version; picking for them and calling it advice is not.
 *
 * The budget is read from the query string so the comparison is linkable and
 * requires no state: `?budget=60000`.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ budget?: string }>;
}) {
  await connection();

  const { budget } = await searchParams;
  const userId = await currentUserId();
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));

  const monthlyBudget = /^\d+(\.\d{1,2})?$/.test(budget ?? "")
    ? Money.fromRupees(budget as string)
    : null;

  const { lending } = services();
  const result = monthlyBudget
    ? await lending.comparePayoff.execute({ userId, monthlyBudget, asOf: today })
    : null;

  return (
    <>
      <PageHeader
        title="Payoff plans"
        subtitle="Both strategies pay every minimum and throw what is left at one debt. They differ only in which — and in what that costs."
        badge={<Pill tone="brand">Phase 4</Pill>}
        action={
          <Link href="/loans" className="ghost-btn h-10 px-4 text-xs">
            All loans
          </Link>
        }
      />

      <Card title="Monthly budget" subtitle="What you can put toward debt each month, including the minimums." className="mb-6">
        <form className="flex flex-wrap items-end gap-3" action="/loans/payoff" method="get">
          <label className="form-label" htmlFor="budget">
            Amount
          </label>
          <input
            id="budget"
            name="budget"
            className="form-input tnum w-48"
            inputMode="decimal"
            placeholder="60000.00"
            defaultValue={budget ?? ""}
          />
          <button type="submit" className="btn-glow">
            Compare
          </button>
        </form>
      </Card>

      {result && !result.ok && (
        <Card title="That budget will not clear the debts">
          <p className="text-sm text-red-500">{result.error.message}</p>
          <p className="mt-2 text-xs text-gray-500">
            A plan that never closes is not a plan, so it is refused rather than projected out to a
            date that would never arrive.
          </p>
        </Card>
      )}

      {result?.ok && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Avalanche interest"
              value={result.value.avalanche.totalInterest}
              hint={`${result.value.avalanche.monthsToClear} months`}
            />
            <Stat
              label="Snowball interest"
              value={result.value.snowball.totalInterest}
              hint={`${result.value.snowball.monthsToClear} months`}
            />
            <Stat
              label="Avalanche saves"
              value={result.value.interestSavedByAvalanche}
              hint="In interest, over the whole plan"
            />
            <Stat
              label="And finishes"
              value={
                <span className="tnum">
                  {result.value.monthsSavedByAvalanche === 0
                    ? "same month"
                    : `${result.value.monthsSavedByAvalanche} months earlier`}
                </span>
              }
              hint="Snowball clears a debt sooner, though"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {[result.value.avalanche, result.value.snowball].map((plan) => (
              <Card
                key={plan.strategy}
                title={plan.strategy === "AVALANCHE" ? "Avalanche — highest rate first" : "Snowball — smallest balance first"}
                subtitle={
                  plan.strategy === "AVALANCHE"
                    ? "Always the cheaper plan. The first debt cleared may take a long time."
                    : "Costs more interest. The first debt clears sooner, which is why people finish it."
                }
              >
                <p className="metric-label">Order cleared</p>
                <ol className="mt-1 space-y-1 text-sm text-gray-300">
                  {plan.order.map((label, index) => (
                    <li key={`${plan.strategy}-${label}`} className="tnum">
                      {index + 1}. {label}
                    </li>
                  ))}
                </ol>

                <p className="mt-4 metric-label">First twelve months</p>
                <div className="table-scroll mt-1">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      {plan.strategy} plan: monthly total paid and remaining balance
                    </caption>
                    <thead>
                      <tr className="border-b border-gray-600">
                        <th scope="col" className="metric-label px-2 py-2 text-left">Month</th>
                        <th scope="col" className="metric-label px-2 py-2 text-right">Paid</th>
                        <th scope="col" className="metric-label px-2 py-2 text-right">Remaining</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.months.slice(0, 12).map((month) => (
                        <tr key={`${plan.strategy}-${month.month}`} className="border-b border-gray-600/50 last:border-0">
                          <td className="tnum px-2 py-1.5 text-gray-500">{month.month}</td>
                          <td className="px-2 py-1.5 text-right"><MoneyText value={month.totalPaid} tone="neutral" /></td>
                          <td className="px-2 py-1.5 text-right"><MoneyText value={month.remaining} tone="neutral" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}
