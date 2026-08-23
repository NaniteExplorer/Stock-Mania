import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { CashAsset } from "@/domain/assets";
import { Card, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { currentUserId, services } from "@/infra/container";
import UtilisationGauge from "../utilisation-gauge";
import CycleTimeline from "./cycle-timeline";
import PayCardForm from "./pay-card-form";

export const metadata: Metadata = { title: "Card" };

/**
 * One card.
 *
 * Every statement on this page is **rebuilt from postings**, never read back from
 * a saved copy. That is what makes history answerable for months that predate the
 * app, and it is why the identity `opening + spends + charges − payments − refunds
 * = closing` can be shown as a row of figures that always add up: they are all
 * derived from the same postings.
 */
export default async function Page({ params }: { params: Promise<{ accountId: string }> }) {
  await connection();

  const { accountId } = await params;
  const userId = await currentUserId();
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));

  const { cards, repositories } = services();
  const result = await cards.view.execute({
    userId,
    accountId: AccountId.from(accountId),
    asOf: today,
    cycles: 6,
  });
  if (!result.ok) notFound();

  const detail = result.value;
  const accounts = await repositories.accounts.list(userId);
  const payFrom = accounts
    .filter((account) => CashAsset.classify(account) !== null)
    .map((account) => ({ id: account.id.value, label: account.displayName }));

  const statements = [...detail.statements].reverse();
  const latest = statements.find((statement) => statement.cycle.through.isOnOrBefore(today));
  const daysToDue = latest ? today.daysUntil(latest.cycle.dueOn) : 0;

  return (
    <>
      <PageHeader
        title={detail.card.displayName}
        subtitle={
          detail.card.account.institution
            ? `${detail.card.account.institution} · statement on the ${detail.card.terms.cycle.statementDay}th, ${detail.card.terms.cycle.graceDays} days to pay`
            : `Statement on the ${detail.card.terms.cycle.statementDay}th, ${detail.card.terms.cycle.graceDays} days to pay`
        }
        badge={
          latest ? (
            <Pill tone={daysToDue <= 3 ? "brand" : "neutral"}>
              {daysToDue < 0 ? `Overdue by ${Math.abs(daysToDue)}d` : `Due in ${daysToDue}d`}
            </Pill>
          ) : undefined
        }
        action={
          <Link href="/cards" className="ghost-btn h-10 px-4 text-xs">
            All cards
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Owed today" value={detail.owed} hint="Including this cycle's spending" />
        <Stat
          label="Billed last cycle"
          value={latest?.totalDue ?? null}
          hint={latest ? `Statement ${latest.cycle.label}` : "No statement yet"}
        />
        <Stat
          label="Minimum due"
          value={latest?.minimumDue ?? null}
          hint={`${detail.card.terms.minimumDuePercent.toFixed(0)}% or ${detail.card.terms.minimumDueFloor.toString()}`}
        />
        <Stat label="Available" value={detail.available} hint={`Limit ${detail.card.terms.creditLimit.toString()}`} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card title="Utilisation">
          <UtilisationGauge
            percentText={detail.utilisation.toFixed(1)}
            percentValue={detail.utilisation.toApproximateNumber()}
          />
          <p className="mt-3 text-xs text-gray-500">
            Issuers score sustained use above 30% unfavourably, which is why the band changes there
            rather than at a round number.
          </p>
        </Card>

        <Card title="This cycle" className="lg:col-span-2">
          <CycleTimeline
            from={detail.currentCycle.from.toISO()}
            through={detail.currentCycle.through.toISO()}
            dueOn={detail.currentCycle.dueOn.toISO()}
            today={today.toISO()}
          />
          <p className="mt-3 text-xs text-gray-500">
            Anything bought after the statement date belongs to the next bill. That is why spending
            this month and billed this cycle are different figures, and both are right.
          </p>
        </Card>
      </div>

      <section className="panel mb-6 p-0">
        <div className="flex items-center justify-between border-b border-gray-600 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-100">Statements</h2>
          <p className="text-xs text-gray-500">
            Rebuilt from postings — opening + spends + charges − payments − refunds = closing.
          </p>
        </div>
        <div className="table-scroll">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Statements with opening balance, spends, charges, payments, refunds and closing balance
            </caption>
            <thead>
              <tr className="border-b border-gray-600">
                <th scope="col" className="metric-label px-4 py-3 text-left">Cycle</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Due</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Opening</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Spends</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Charges</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Payments</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Refunds</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Closing</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Minimum</th>
              </tr>
            </thead>
            <tbody>
              {statements.map((statement) => (
                <tr key={statement.cycle.label} className="border-b border-gray-600/50 last:border-0">
                  <td className="px-4 py-3">
                    <p className="text-gray-100">{statement.cycle.label}</p>
                    <p className="tnum text-xs text-gray-500">
                      {statement.cycle.from.toISO()} → {statement.cycle.through.toISO()}
                    </p>
                  </td>
                  <td className="tnum px-4 py-3 text-gray-400">{statement.cycle.dueOn.toISO()}</td>
                  <td className="px-4 py-3 text-right"><MoneyText value={statement.opening} tone="neutral" /></td>
                  <td className="px-4 py-3 text-right"><MoneyText value={statement.spends} tone="neutral" /></td>
                  <td className="px-4 py-3 text-right"><MoneyText value={statement.charges} tone="neutral" /></td>
                  <td className="px-4 py-3 text-right"><MoneyText value={statement.payments} tone="neutral" /></td>
                  <td className="px-4 py-3 text-right"><MoneyText value={statement.refunds} tone="neutral" /></td>
                  <td className="px-4 py-3 text-right"><MoneyText value={statement.closing} tone="neutral" /></td>
                  <td className="px-4 py-3 text-right"><MoneyText value={statement.minimumDue} tone="neutral" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Pay this card"
          subtitle="Recorded as a transfer between two accounts you own — never as an expense, because the spending was already recorded when the card was used."
        >
          <PayCardForm
            cardAccountId={detail.card.id.value}
            accounts={payFrom}
            suggestedAmount={latest?.totalDue.toDecimalString() ?? "0.00"}
            defaultDate={today.toISO()}
          />
        </Card>

        <Card
          title="Reward points"
          subtitle="Earned on spending, valued only when redeemed."
        >
          <p className="text-3xl font-semibold text-gray-100 tnum">
            {detail.points.points.toDecimalString()}
          </p>
          <p className="mt-2 text-xs text-gray-500">
            {detail.card.terms.pointsPerHundred.isZero
              ? "This card earns no points. Set a rate on the card to track them."
              : `${detail.card.terms.pointsPerHundred.toDecimalString()} points per ₹100 spent, over the statements above.`}
          </p>
          <p className="mt-3 text-xs text-gray-500">
            Points are a quantity, not money: the redemption rate is the issuer&rsquo;s to change and
            differs by route, so they never enter net worth.
          </p>
        </Card>
      </div>
    </>
  );
}
