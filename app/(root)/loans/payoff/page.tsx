import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { rupee, type Figure } from "@/core/format";
import { Columns, Kpi, KpiStrip, Masthead, Page as PageShell, Panel } from "@/components/ui/page-shell";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FigureCell, TextCell } from "@/components/ui/data-cell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    <PageShell>
      <Masthead
        title="Payoff plans"
        side={
          <Button asChild variant="ghost" size="sm">
            <Link href="/loans">All loans</Link>
          </Button>
        }
      />
      <p className="text-sm text-(--fg-secondary)">
        Both strategies pay every minimum and throw what is left at one debt. They differ only in which — and in what that costs.{" "}
        <span className="text-(--fg-muted)">Phase 4</span>
      </p>

      <Panel title="Monthly budget" description="What you can put toward debt each month, including the minimums.">
        <form className="flex flex-wrap items-end gap-3" action="/loans/payoff" method="get">
          <Label htmlFor="budget">Amount</Label>
          <Input
            id="budget"
            name="budget"
            className="w-48 tabular-nums"
            inputMode="decimal"
            placeholder="60000.00"
            defaultValue={budget ?? ""}
          />
          <Button type="submit">Compare</Button>
        </form>
      </Panel>

      {result && !result.ok && (
        <Banner tone="error" title="That budget will not clear the debts">
          <p>{result.error.message}</p>
          <p className="mt-2 text-xs text-(--fg-muted)">
            A plan that never closes is not a plan, so it is refused rather than projected out to a
            date that would never arrive.
          </p>
        </Banner>
      )}

      {result?.ok && (
        <>
          <KpiStrip>
            <Kpi
              label="Avalanche interest"
              value={rupee(result.value.avalanche.totalInterest)}
              detail={`${result.value.avalanche.monthsToClear} months`}
            />
            <Kpi
              label="Snowball interest"
              value={rupee(result.value.snowball.totalInterest)}
              detail={`${result.value.snowball.monthsToClear} months`}
            />
            <Kpi
              label="Avalanche saves"
              value={rupee(result.value.interestSavedByAvalanche)}
              detail="In interest, over the whole plan"
            />
            <Kpi
              label="And finishes"
              value={
                (result.value.monthsSavedByAvalanche === 0
                  ? "same month"
                  : `${result.value.monthsSavedByAvalanche} months earlier`) as Figure
              }
              detail="Snowball clears a debt sooner, though"
            />
          </KpiStrip>

          <Columns>
            <PlanPanel plan={result.value.avalanche} />
            <PlanPanel plan={result.value.snowball} />
          </Columns>
        </>
      )}
    </PageShell>
  );
}

type PayoffPlan = Extract<Awaited<ReturnType<ReturnType<typeof services>["lending"]["comparePayoff"]["execute"]>>, { ok: true }>["value"]["avalanche"];

/** One strategy's plan: the order it clears debts in and its first year. */
function PlanPanel({ plan }: { plan: PayoffPlan }) {
  return (
    <Panel
      title={plan.strategy === "AVALANCHE" ? "Avalanche — highest rate first" : "Snowball — smallest balance first"}
      description={
        plan.strategy === "AVALANCHE"
          ? "Always the cheaper plan. The first debt cleared may take a long time."
          : "Costs more interest. The first debt clears sooner, which is why people finish it."
      }
    >
      <p className="text-xs text-(--fg-muted)">Order cleared</p>
      <ol className="mt-1 space-y-1 text-sm text-(--fg-secondary)">
        {plan.order.map((label, index) => (
          <li key={`${plan.strategy}-${label}`} className="tabular-nums">
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      <p className="mt-4 text-xs text-(--fg-muted)">First twelve months</p>
      <Table density="compact" aria-label={`${plan.strategy} plan: monthly total paid and remaining balance`}>
        <TableHeader>
          <TableRow>
            <TableHead>Month</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead className="text-right">Remaining</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {plan.months.slice(0, 12).map((month) => (
            <TableRow key={`${plan.strategy}-${month.month}`}>
              <TextCell className="tabular-nums">{month.month}</TextCell>
              <FigureCell value={month.totalPaid} />
              <FigureCell value={month.remaining} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Panel>
  );
}
