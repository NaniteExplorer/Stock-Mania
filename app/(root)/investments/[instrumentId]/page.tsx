import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { Quantity } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { InstrumentId } from "@/domain/instruments";
import { LotBook } from "@/domain/lots";
import { CashAsset } from "@/domain/assets";
import { Card, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { currentUserId, services } from "@/infra/container";
import TradeForms from "./trade-forms";

export const metadata: Metadata = { title: "Holding" };

/**
 * One holding: its lots, its history, and what a sale would realise.
 *
 * The **holding-period clock** is the column that matters. Tax on a disposal turns
 * on the days each lot has been held, so a lot 340 days old is a different
 * decision from one 370 days old — and a screen that showed only "units and
 * average cost" hides the single most actionable number a holder has.
 *
 * The method comparison is here for the same reason: FIFO and HIFO on the same
 * sale realise different gains, and the difference is money the user can choose to
 * keep.
 */
export default async function Page({ params }: { params: Promise<{ instrumentId: string }> }) {
  await connection();

  const { instrumentId } = await params;
  const userId = await currentUserId();
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const id = InstrumentId.from(instrumentId);

  const { investing, repositories } = services();
  const instrument = await repositories.instruments.findById(userId, id);
  if (!instrument) notFound();

  const [lots, portfolio, actions, accounts] = await Promise.all([
    repositories.lots.allLots(userId, id),
    investing.valuePortfolio.execute({ userId, asOf: today }),
    investing.corporateActions(userId).listFor(id),
    repositories.accounts.list(userId),
  ]);
  if (!portfolio.ok) throw new Error(portfolio.error.message);

  const position = portfolio.value.valued.find((row) => row.instrumentId.equals(id));
  const openLots = lots.filter((lot) => !lot.isExhausted);
  const open = LotBook.openPosition(openLots, instrument.currency);

  const settlementAccounts = accounts
    .filter((account) => CashAsset.classify(account) !== null)
    .map((account) => ({ id: account.id.value, label: account.displayName }));

  const comparison = open.quantity.isPositive
    ? await investing.compareMethods.execute({
        userId,
        instrumentId: id,
        quantity: open.quantity,
        pricePerUnit: position?.marketValue
          ? open.quantity.perUnit(position.marketValue, "HALF_EVEN")
          : Money.zero(instrument.currency),
        tradedOn: today,
      })
    : null;

  const profile = instrument.taxProfile();

  return (
    <>
      <PageHeader
        title={`${instrument.symbol} — ${instrument.name}`}
        subtitle={`${instrument.kind.replace(/_/g, " ").toLowerCase()} · taxed as ${profile.category
          .replace(/_/g, " ")
          .toLowerCase()}${profile.slabTaxedAlways ? ", at slab whatever the holding period" : ""}`}
        badge={
          profile.lockInMonths ? (
            <Pill tone="brand">{profile.lockInMonths / 12}-year lock-in</Pill>
          ) : (
            <Pill tone="neutral">{instrument.unit.toLowerCase()}</Pill>
          )
        }
        action={
          <Link href="/investments" className="ghost-btn h-10 px-4 text-xs">
            All holdings
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Units held"
          value={<span className="tnum">{open.quantity.toDecimalString()}</span>}
          hint={`${openLots.length} open lot(s)`}
        />
        <Stat label="Invested" value={open.cost.plus(open.charges)} hint="Price plus charges" />
        <Stat
          label="Market value"
          value={position?.marketValue ?? null}
          hint={
            position?.pricedOn
              ? `Priced ${position.pricedOn.toISO()}${position.isStale ? " · stale" : ""}`
              : (position?.unpricedReason ?? "No price")
          }
        />
        <Stat label="Realised" value={position?.realisedGain ?? Money.zero()} hint="Gains already taken" />
      </div>

      <section className="panel mb-6 p-0">
        <div className="flex items-center justify-between border-b border-gray-600 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-100">Lots</h2>
          <p className="text-xs text-gray-500">
            The holding-period clock decides the tax on a sale, so it is per lot.
          </p>
        </div>
        <div className="table-scroll">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Lots with acquisition date, units, cost per unit and days held
            </caption>
            <thead>
              <tr className="border-b border-gray-600">
                <th scope="col" className="metric-label px-4 py-3 text-left">Acquired</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Units</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Remaining</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Cost / unit</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Invested</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Days held</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((lot) => {
                const days = lot.acquiredOn.daysUntil(today);
                const locked = instrument.disposalBlockedOn(lot.acquiredOn, today);
                return (
                  <tr key={lot.id.value} className="border-b border-gray-600/50 last:border-0">
                    <td className="tnum px-4 py-3 text-gray-400">{lot.acquiredOn.toISO()}</td>
                    <td className="tnum px-4 py-3 text-right text-gray-400">
                      {lot.props.originalQuantity.toDecimalString()}
                    </td>
                    <td className="tnum px-4 py-3 text-right text-gray-300">
                      {lot.remaining.toDecimalString()}
                    </td>
                    <td className="px-4 py-3 text-right"><MoneyText value={lot.costPerUnit} tone="neutral" /></td>
                    <td className="px-4 py-3 text-right"><MoneyText value={lot.totalInvested} tone="neutral" /></td>
                    <td className="tnum px-4 py-3 text-right">
                      <span className={days >= 365 ? "text-green-500" : "text-gray-400"}>{days}</span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {lot.isExhausted ? (
                        <span className="text-gray-500">Sold</span>
                      ) : locked ? (
                        <span className="text-amber-500">Locked in</span>
                      ) : days >= 365 ? (
                        <span className="text-green-500">Long term</span>
                      ) : (
                        <span className="text-gray-400">Short term · {365 - days}d to go</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {comparison?.ok && open.quantity.isPositive && (
        <Card
          title="What selling everything today would realise"
          subtitle="The same sale under each method. The difference is the tax you can choose."
          className="mb-6"
        >
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">Realised gain by lot-selection method</caption>
              <thead>
                <tr className="border-b border-gray-600">
                  <th scope="col" className="metric-label px-3 py-2 text-left">Method</th>
                  <th scope="col" className="metric-label px-3 py-2 text-right">Cost basis</th>
                  <th scope="col" className="metric-label px-3 py-2 text-right">Gain</th>
                </tr>
              </thead>
              <tbody>
                {comparison.value.comparison.map((row) => (
                  <tr key={row.method} className="border-b border-gray-600/50 last:border-0">
                    <td className="px-3 py-2 text-gray-300">{row.method.replace(/_/g, " ")}</td>
                    <td className="px-3 py-2 text-right"><MoneyText value={row.costBasis} tone="neutral" /></td>
                    <td className="px-3 py-2 text-right"><MoneyText value={row.gain} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Specific-id behaves as FIFO here because no lots have been nominated — the honest
            answer rather than an omission.
          </p>
        </Card>
      )}

      {actions.length > 0 && (
        <Card title="Corporate actions" subtitle="Applied as events, so each one can be undone." className="mb-6">
          <ul className="space-y-2 text-sm">
            {actions.map((action) => (
              <li key={action.id} className="flex items-baseline justify-between gap-3">
                <span className="text-gray-300">{action.kind.replace(/_/g, " ")}</span>
                <span className="tnum text-xs text-gray-500">
                  ex {action.exDate.toISO()}
                  {action.appliedAt ? " · applied" : " · pending"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Record a trade"
        subtitle="A trade is a ledger transaction first; the lot is derived from it, so the portfolio can always be rebuilt from the journal."
      >
        <TradeForms
          instrumentId={instrumentId}
          accounts={settlementAccounts}
          defaultDate={today.toISO()}
          heldUnits={open.quantity.toDecimalString()}
        />
      </Card>
    </>
  );
}
