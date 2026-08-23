import type { Metadata } from "next";
import Link from "next/link";
import { CreditCard as CardIcon } from "lucide-react";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Card, EmptyState, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import AddCardForm from "./add-card-form";
import UtilisationGauge from "./utilisation-gauge";

export const metadata: Metadata = { title: "Cards" };

/**
 * Credit cards.
 *
 * "Amount due" is taken from the cycle that has most recently **closed**, not
 * from the running balance: the issuer has not billed what was spent yesterday,
 * and quoting today's debt as the amount due would tell the user to pay money
 * nobody has asked for. Today's debt is shown too, separately, because both are
 * real and they are different numbers.
 */
export default async function Page() {
  await connection();

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const result = await services().cards.list.execute({ userId, asOf: today });
  if (!result.ok) throw new Error(result.error.message);

  const cards = result.value.cards;
  const totalOwed = Money.total(cards.map((summary) => summary.owed));

  return (
    <>
      <PageHeader
        title="Credit cards"
        subtitle="Balances reduce net worth because the account type says so — there is no card special case anywhere in the ledger."
        badge={<Pill tone="brand">Phase 3</Pill>}
      />

      {cards.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total owed" value={totalOwed} hint="Across every card" />
          <Stat
            label="Cards"
            value={<span className="tnum">{cards.length}</span>}
            hint="Open"
          />
          <Stat
            label="Due soonest"
            value={
              <span className="tnum">
                {Math.min(...cards.map((summary) => summary.daysToDue))} days
              </span>
            }
            hint="Until a due date"
          />
          <Stat
            label="Billed last cycle"
            value={cards[0].statement.totalDue}
            hint={cards[0].statement.cycle.label}
          />
        </div>
      )}

      {cards.length === 0 ? (
        <section className="panel mb-6 p-0">
          <EmptyState
            icon={CardIcon}
            title="No cards yet"
            body="Add a card with its statement day, limit and finance rate. Statements are then rebuilt from your postings — including for months before you started."
          />
        </section>
      ) : (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {cards.map((summary) => (
            <Card
              key={summary.card.id.value}
              title={
                <Link href={`/cards/${summary.card.id.value}`} className="hover:text-brand-400">
                  {summary.card.displayName}
                </Link>
              }
              subtitle={summary.card.account.institution ?? undefined}
              kicker={`Statement ${summary.statement.cycle.label}`}
              action={
                <Pill tone={summary.daysToDue <= 3 ? "brand" : "neutral"}>
                  {summary.daysToDue < 0
                    ? `Overdue by ${Math.abs(summary.daysToDue)}d`
                    : `Due in ${summary.daysToDue}d`}
                </Pill>
              }
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="metric-label">Owed today</p>
                  <p className="mt-1 text-2xl font-semibold text-gray-100">
                    <MoneyText value={summary.owed} tone="neutral" />
                  </p>
                  <p className="mt-3 metric-label">Billed last cycle</p>
                  <p className="mt-1 text-sm text-gray-300">
                    <MoneyText value={summary.statement.totalDue} tone="neutral" />
                    <span className="ml-2 text-xs text-gray-500">
                      minimum <MoneyText value={summary.statement.minimumDue} tone="neutral" />
                    </span>
                  </p>
                </div>
                <div>
                  <UtilisationGauge
                    percentText={summary.utilisation.toFixed(1)}
                    percentValue={summary.utilisation.toApproximateNumber()}
                  />
                  <p className="mt-3 metric-label">Available</p>
                  <p className="mt-1 text-sm text-gray-300">
                    <MoneyText value={summary.available} tone="neutral" />
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card
        title="Add a card"
        subtitle="The terms are what every figure is computed from: statement day and grace period generate the cycles, the finance rate prices a revolved balance, and the minimum-due rule is the issuer's."
      >
        <AddCardForm />
      </Card>
    </>
  );
}
