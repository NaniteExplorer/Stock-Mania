import type { Metadata } from "next";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import { BudgetLedger } from "@/domain/banking";
import type { Money } from "@/core/money";
import { rupee, type Figure } from "@/core/format";
import { Kpi, KpiStrip, Masthead, Page as PageShell, Panel } from "@/components/ui/page-shell";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FigureCell, TextCell } from "@/components/ui/data-cell";
import { Banner } from "@/components/ui/banner";
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
    <PageShell>
      <Masthead title="Budgets" />
      <p className="text-sm text-(--fg-secondary)">
        Actual&apos;s envelope arithmetic, exactly: a leftover carries forward, and an overspend either follows the category or is charged to the month.{" "}
        <span className="text-(--fg-muted)">Phase 2</span>
      </p>

      <KpiStrip>
        <Kpi label="Budgeted" value={rupee(current.totalBudgeted)} detail={current.month} />
        <Kpi label="To budget" value={rupee(current.toBudget)} detail="Available less allocated" />
        <Kpi label="Last month's overspend" value={rupee(current.lastMonthOverspent)} detail="Charged to this month" />
        <Kpi label="Envelopes" value={String(current.envelopes.length) as Figure} detail="Categories with a limit" />
      </KpiStrip>

      {current.warnings.length > 0 && (
        <Panel title="Over-allocated">
          <ul className="space-y-1 text-sm text-(--warn)">
            {current.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Panel>
      )}

      {plan.value.months.map((month) =>
        month.envelopes.length === 0 ? (
          <Panel key={month.month} title={month.month} description={`to budget ${rupee(month.toBudget)}`}>
            <Banner title="No budgets for this month">
              <p>Set a limit on a category below. A recurring limit applies to every month; a month-specific one overrides it.</p>
            </Banner>
          </Panel>
        ) : (
          <Panel key={month.month} title={month.month} description={`to budget ${rupee(month.toBudget)}`} flush>
            <Table aria-label={`Envelopes for ${month.month} with budgeted, spent, carried in and left`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Budgeted</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead className="text-right">Carried in</TableHead>
                  <TableHead className="text-right">Left</TableHead>
                  <TableHead className="text-right">Used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {month.envelopes.map((envelope) => {
                  const used = BudgetLedger.utilisationBasisPoints(envelope.spent, envelope.budgeted);
                  return (
                    <TableRow key={envelope.accountId.value}>
                      <TextCell>{byId.get(envelope.accountId.value)?.code.toString() ?? "—"}</TextCell>
                      <FigureCell value={envelope.budgeted} />
                      <FigureCell value={envelope.spent.abs()} />
                      <FigureCell value={envelope.carriedIn} className={signTone(envelope.carriedIn)} />
                      <FigureCell value={envelope.leftover} className={signTone(envelope.leftover)} />
                      <TextCell className="text-right tabular-nums">
                        {used === null ? "—" : `${Number(used) / 100}%`}
                      </TextCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Panel>
        ),
      )}

      <Panel
        title="Set a budget"
        description="Leave the month blank for a recurring limit. Carry-over makes the category keep its own leftover — and its own overspend."
      >
        <BudgetForm categories={options} defaultMonth={current.month} />
      </Panel>
    </PageShell>
  );
}

/**
 * Library gap (F.7 Recompose A): FigureCell has no gain/loss tone, which the old
 * MoneyText derived from the sign. The tone is applied here with token utilities.
 */
function signTone(value: Money): string | undefined {
  return value.isNegative ? "text-(--loss)" : value.isPositive ? "text-(--gain)" : undefined;
}
