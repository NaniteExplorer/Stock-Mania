import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { rupee, type Figure } from "@/core/format";
import { Kpi, KpiStrip, Masthead, Page as PageShell, Panel } from "@/components/ui/page-shell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { InstitutionMark } from "@/ui/provider-picker";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import AddCardForm from "./add-card-form";
import { resolveMinimumDue } from "@/app/card-minimum-due.usecases";
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
  const entered = await services().cards.minimumDues.load.execute({ userId, accountIds: cards.map((summary) => summary.card.id.value) });
  if (!entered.ok) throw new Error(entered.error.message);
  const minimumOf = (summary: (typeof cards)[number]) => resolveMinimumDue(summary.statement, summary.card.id.value, entered.value);
  const totalOwed = Money.total(cards.map((summary) => summary.owed));

  return (
    <PageShell>
      <Masthead title="Credit cards" hero={cards.length > 0 ? rupee(totalOwed) : undefined} />
      <p className="text-sm text-(--fg-secondary)">
        Balances reduce net worth because the account type says so — there is no card special case anywhere in the ledger.{" "}
        <span className="text-(--fg-muted)">Phase 3</span>
      </p>

      {cards.length > 0 && (
        <KpiStrip>
          <Kpi label="Total owed" value={rupee(totalOwed)} detail="Across every card" />
          <Kpi label="Cards" value={String(cards.length) as Figure} detail="Open" />
          <Kpi
            label="Due soonest"
            value={`${Math.min(...cards.map((summary) => summary.daysToDue))} days` as Figure}
            detail="Until a due date"
          />
          <Kpi
            label="Billed last cycle"
            value={rupee(cards[0].statement.totalDue)}
            detail={cards[0].statement.cycle.label}
          />
        </KpiStrip>
      )}

      {cards.length === 0 ? (
        <Banner title="No cards yet">
          <p>Add a card with its statement day, limit and finance rate. Statements are then rebuilt from your postings — including for months before you started.</p>
        </Banner>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {cards.map((summary) => (
            <Panel
              key={summary.card.id.value}
              title={summary.card.displayName}
              description={`Statement ${summary.statement.cycle.label} · ${
                summary.daysToDue < 0
                  ? `Overdue by ${Math.abs(summary.daysToDue)}d`
                  : `Due in ${summary.daysToDue}d`
              }`}
              actions={
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/cards/${summary.card.id.value}`}>Open</Link>
                </Button>
              }
            >
              {summary.card.account.institution ? (
                <p className="mb-3 inline-flex items-center gap-2 text-sm text-(--fg-secondary)">
                  <InstitutionMark institution={summary.card.account.institution} />
                  {summary.card.account.institution}
                </p>
              ) : undefined}
              <KpiStrip>
                <Kpi label="Owed today" value={rupee(summary.owed)} />
                <Kpi
                  label="Billed last cycle"
                  value={rupee(summary.statement.totalDue)}
                  detail={(() => {
                    const minimum = minimumOf(summary);
                    return `minimum ${rupee(minimum.statement.minimumDue)} · ${minimum.entered ? "typed from statement" : "card rule"}${minimum.refused ? " (typed figure refused)" : ""}`;
                  })()}
                />
                <Kpi label="Available" value={rupee(summary.available)} />
              </KpiStrip>
              <div className="mt-3">
                <UtilisationGauge
                  percentText={summary.utilisation.toFixed(1)}
                  percentValue={summary.utilisation.toApproximateNumber()}
                />
              </div>
            </Panel>
          ))}
        </div>
      )}

      <Panel
        title="Add a card"
        description="The terms are what every figure is computed from: statement day and grace period generate the cycles, the finance rate prices a revolved balance, and the minimum-due rule is the issuer's."
      >
        <AddCardForm />
      </Panel>
    </PageShell>
  );
}
