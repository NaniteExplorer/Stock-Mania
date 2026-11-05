import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import { CashAsset } from "@/domain/assets";
import { rupee, unknown } from "@/core/format";
import { Columns, Kpi, KpiStrip, Masthead, Page as PageShell, Panel } from "@/components/ui/page-shell";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FigureCell, TextCell } from "@/components/ui/data-cell";
import { Button } from "@/components/ui/button";
import { InstitutionMark } from "@/ui/provider-picker";
import { currentUserId, services } from "@/infra/container";
import UtilisationGauge from "../utilisation-gauge";
import CycleTimeline from "./cycle-timeline";
import PayCardForm from "./pay-card-form";
import MinimumDueForm from "./minimum-due-form";
import { resolveMinimumDue } from "@/app/card-minimum-due.usecases";

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
    .map((account) => ({ id: account.id.value, label: account.displayName, institution: account.institution }));

  // Each statement's minimum: the owner's typed figure for it, else the card's rule.
  const entered = await cards.minimumDues.load.execute({ userId, accountIds: [detail.card.id.value] });
  if (!entered.ok) throw new Error(entered.error.message);
  const resolved = [...detail.statements].reverse().map((statement) => resolveMinimumDue(statement, detail.card.id.value, entered.value));
  const statements = resolved.map((r) => r.statement);
  const latestResolved = resolved.find((r) => r.statement.cycle.through.isOnOrBefore(today));
  const latest = latestResolved?.statement;
  const ruleText = `${detail.card.terms.minimumDuePercent.toFixed(2)}% of the balance, at least ${detail.card.terms.minimumDueFloor.toString()}`;
  const daysToDue = latest ? today.daysUntil(latest.cycle.dueOn) : 0;

  return (
    <PageShell>
      <Masthead
        title={detail.card.displayName}
        hero={rupee(detail.owed)}
        side={
          <Button asChild variant="ghost" size="sm">
            <Link href="/cards">All cards</Link>
          </Button>
        }
      />
      <p className="text-sm text-(--fg-secondary)">
        {`Statement on the ${detail.card.terms.cycle.statementDay}th, ${detail.card.terms.cycle.graceDays} days to pay`}
        {latest && (
          <span className={daysToDue <= 3 ? "text-(--warn)" : "text-(--fg-muted)"}>
            {" · "}
            {daysToDue < 0 ? `Overdue by ${Math.abs(daysToDue)}d` : `Due in ${daysToDue}d`}
          </span>
        )}
      </p>

      {/* The issuer, with its mark: the same row the account detail page draws. */}
      {detail.card.account.institution && (
        <div className="flex items-center gap-3">
          <InstitutionMark institution={detail.card.account.institution} />
          <p className="text-sm text-(--fg-secondary)">{detail.card.account.institution}</p>
        </div>
      )}

      <KpiStrip>
        <Kpi label="Owed today" value={rupee(detail.owed)} detail="Including this cycle's spending" />
        <Kpi
          label="Billed last cycle"
          value={latest ? rupee(latest.totalDue) : unknown("No statement has closed yet")}
          detail={latest ? `Statement ${latest.cycle.label}` : "No statement yet"}
        />
        <Kpi
          label="Minimum due"
          value={latest ? rupee(latest.minimumDue) : unknown("No statement has closed yet")}
          detail={latestResolved?.entered ? "Typed from your statement" : `Card rule: ${ruleText}`}
        />
        <Kpi label="Available" value={rupee(detail.available)} detail={`Limit ${detail.card.terms.creditLimit.toString()}`} />
      </KpiStrip>

      <Columns>
        <Panel title="Utilisation">
          <UtilisationGauge
            percentText={detail.utilisation.toFixed(1)}
            percentValue={detail.utilisation.toApproximateNumber()}
          />
          <p className="mt-3 text-xs text-(--fg-muted)">
            Issuers score sustained use above 30% unfavourably, which is why the band changes there
            rather than at a round number.
          </p>
        </Panel>

        <Panel title="This cycle">
          <CycleTimeline
            from={detail.currentCycle.from.toISO()}
            through={detail.currentCycle.through.toISO()}
            dueOn={detail.currentCycle.dueOn.toISO()}
            today={today.toISO()}
          />
          <p className="mt-3 text-xs text-(--fg-muted)">
            Anything bought after the statement date belongs to the next bill. That is why spending
            this month and billed this cycle are different figures, and both are right.
          </p>
        </Panel>
      </Columns>

      <Panel
        title="Statements"
        description="Rebuilt from postings — opening + spends + charges − payments − refunds = closing."
        flush
      >
        <Table aria-label="Statements with opening balance, spends, charges, payments, refunds and closing balance">
          <TableHeader>
            <TableRow>
              <TableHead>Cycle</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Opening</TableHead>
              <TableHead className="text-right">Spends</TableHead>
              <TableHead className="text-right">Charges</TableHead>
              <TableHead className="text-right">Payments</TableHead>
              <TableHead className="text-right">Refunds</TableHead>
              <TableHead className="text-right">Closing</TableHead>
              <TableHead className="text-right">Minimum</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {statements.map((statement) => (
              <TableRow key={statement.cycle.label}>
                <TextCell secondary={`${statement.cycle.from.toISO()} → ${statement.cycle.through.toISO()}`}>
                  {statement.cycle.label}
                </TextCell>
                <TextCell className="tabular-nums">{statement.cycle.dueOn.toISO()}</TextCell>
                <FigureCell value={statement.opening} />
                <FigureCell value={statement.spends} />
                <FigureCell value={statement.charges} />
                <FigureCell value={statement.payments} />
                <FigureCell value={statement.refunds} />
                <FigureCell value={statement.closing} />
                <FigureCell value={statement.minimumDue} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>

      {latestResolved && latest ? (
        <Panel
          title="Minimum due"
          description={latestResolved.entered
            ? `Typed from statement ${latest.cycle.label}; it overrides the card rule (${ruleText}) for this statement only.`
            : `Computed from the card rule: ${ruleText}, never above the balance. Type the printed figure if your issuer's differs.`}
        >
          {latestResolved.refused ? <p className="mb-3 text-sm text-(--loss)" role="alert">{latestResolved.refused}</p> : null}
          <MinimumDueForm
            key={`${latest.cycle.through.toISO()}-${latestResolved.entered ? latest.minimumDue.toDecimalString() : "rule"}`}
            cardAccountId={detail.card.id.value}
            statementThrough={latest.cycle.through.toISO()}
            statementLabel={latest.cycle.label}
            entered={latestResolved.entered ? latest.minimumDue.toDecimalString() : null}
          />
        </Panel>
      ) : null}

      <Columns>
        <Panel
          title="Pay this card"
          description="Recorded as a transfer between two accounts you own — never as an expense, because the spending was already recorded when the card was used."
        >
          <PayCardForm
            cardAccountId={detail.card.id.value}
            accounts={payFrom}
            suggestedAmount={latest?.totalDue.toDecimalString() ?? "0.00"}
            defaultDate={today.toISO()}
          />
        </Panel>

        <Panel
          title="Reward points"
          description="Earned on spending, valued only when redeemed."
        >
          <p className="text-3xl font-semibold text-(--fg) tabular-nums">
            {detail.points.points.toDecimalString()}
          </p>
          <p className="mt-2 text-xs text-(--fg-muted)">
            {detail.card.terms.pointsPerHundred.isZero
              ? "This card earns no points. Set a rate on the card to track them."
              : `${detail.card.terms.pointsPerHundred.toDecimalString()} points per ₹100 spent, over the statements above.`}
          </p>
          <p className="mt-3 text-xs text-(--fg-muted)">
            Points are a quantity, not money: the redemption rate is the issuer&rsquo;s to change and
            differs by route, so they never enter net worth.
          </p>
        </Panel>
      </Columns>
    </PageShell>
  );
}
