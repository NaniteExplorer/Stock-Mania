import type { Metadata } from "next";
import Link from "next/link";
import { Coins, LineChart } from "lucide-react";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { allocation } from "@/domain/portfolio";
import { Card, EmptyState, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import AddInstrumentForm from "./add-instrument-form";
import { LeaseRowActions, OpenLeaseForm, type LeasableHolding } from "./lease-forms";

export const metadata: Metadata = { title: "Investments" };

/**
 * The portfolio.
 *
 * Three things this screen refuses to do, each of which the v1 version did:
 *
 *   - **Show ₹0 for an unpriced holding.** A position with no quote shows an
 *     em-dash and is named in its own panel; the portfolio total goes blank rather
 *     than being quietly light.
 *   - **Hide a stale price.** A four-day-old close during a market holiday is
 *     fine and during an outage is not, and only the user knows which — so the age
 *     is on the row.
 *   - **Report a return without saying which.** XIRR is money-weighted and moves
 *     with the size of contributions; absolute return counts what has already been
 *     taken out. Both are labelled.
 */
export default async function Page() {
  await connection();

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const { investing } = services();

  const portfolio = await investing.valuePortfolio.execute({ userId, asOf: today });
  if (!portfolio.ok) throw new Error(portfolio.error.message);

  const positions = portfolio.value.valued;
  const returns =
    positions.length > 0
      ? await investing.returns.execute({ userId, asOf: today })
      : null;

  /*
   * Leases sit on this screen rather than their own, because leased gold is still
   * in the holdings table above — a lease changes liquidity, not ownership, so
   * splitting them apart would invite reading the two totals as separate money.
   */
  const leases = await services().leasing.list.execute({ userId, asOf: today });
  if (!leases.ok) throw new Error(leases.error.message);
  const leasing = leases.value;

  const leasable: LeasableHolding[] = positions
    .filter((position) => position.instrument.unit === "GRAM")
    .map((position) => ({
      id: position.instrumentId.value,
      label: position.label,
      held: position.quantity.toDecimalString(),
    }));

  const slices = allocation(
    positions
      .filter((position) => position.marketValue !== null)
      .map((position) => ({ label: position.label, value: position.marketValue! })),
  );

  return (
    <>
      <PageHeader
        title="Investments"
        subtitle="Every holding is an account in the ledger, so the portfolio and net worth are the same number computed once."
        badge={<Pill tone="brand">Phase 5</Pill>}
      />

      {positions.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Invested" value={portfolio.value.totalCost} hint="Cost basis, charges included" />
          <Stat
            label="Market value"
            value={portfolio.value.totalMarketValue}
            hint={
              portfolio.value.unpricedPositions.length > 0
                ? `${portfolio.value.unpricedPositions.length} holding(s) unpriced`
                : "At the latest resolved price"
            }
          />
          <Stat
            label="Unrealised"
            value={portfolio.value.unrealisedGain}
            hint="Market value less cost"
          />
          <Stat label="Realised" value={portfolio.value.realisedGain} hint="Gains already taken" />
        </div>
      )}

      {portfolio.value.unpricedPositions.length > 0 && (
        <Card title="No price could be resolved" className="mb-6">
          <p className="text-sm text-gray-300">
            {portfolio.value.unpricedPositions.join(", ")} — these are excluded from the market-value
            total, which is why it is blank rather than lower than it should be.
          </p>
        </Card>
      )}

      <section className="panel mb-6 p-0">
        {positions.length === 0 ? (
          <EmptyState
            icon={LineChart}
            title="No holdings yet"
            body="Add an instrument, then record what you bought. Cost basis, realised gains and returns are computed from those trades — there is nothing else to keep in step."
          />
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Holdings with quantity, average cost, market value and unrealised gain
              </caption>
              <thead>
                <tr className="border-b border-gray-600">
                  <th scope="col" className="metric-label px-4 py-3 text-left">Holding</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Units</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Avg cost</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Invested</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Value</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Unrealised</th>
                  <th scope="col" className="metric-label px-4 py-3 text-left">Priced</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((position) => {
                  const unrealised = position.marketValue
                    ? position.marketValue.minus(position.costBasis)
                    : null;
                  return (
                    <tr key={position.instrumentId.value} className="border-b border-gray-600/50 last:border-0">
                      <td className="px-4 py-3">
                        <Link
                          href={`/investments/${position.instrumentId.value}`}
                          className="font-medium text-gray-100 hover:text-brand-400"
                        >
                          {position.label}
                        </Link>
                        <p className="text-xs text-gray-500">{position.instrument.name}</p>
                      </td>
                      <td className="tnum px-4 py-3 text-right text-gray-300">
                        {position.quantity.toDecimalString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <MoneyText value={position.averageCostPerUnit} tone="neutral" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <MoneyText value={position.costBasis} tone="neutral" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <MoneyText value={position.marketValue} tone="neutral" />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <MoneyText value={unrealised} />
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {position.pricedOn ? (
                          <span className={position.isStale ? "text-amber-500" : "text-gray-500"}>
                            {position.pricedOn.toISO()}
                            {position.isStale ? " · stale" : ""}
                          </span>
                        ) : (
                          <span className="text-gray-500">{position.unpricedReason ?? "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {(leasing.rows.length > 0 || leasable.length > 0) && (
        <section className="mb-6">
          <PageHeader
            title="Gold on lease"
            subtitle="Interest is paid in grams on completed months, so everything here is grams until the last step."
            badge={<Pill tone="brand">Phase 9</Pill>}
          />

          {leasing.rows.length > 0 && (
            <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="On lease"
                value={<span className="tnum">{leasing.portfolio.leasedGrams.toDecimalString()}g</span>}
                hint={`${leasing.unleasedGrams.toDecimalString()}g unleased in the wallet`}
              />
              <Stat
                label="Interest earned"
                value={<span className="tnum">{leasing.portfolio.grossInterestGrams.toDecimalString()}g</span>}
                hint={`less ${leasing.portfolio.tdsGrams.toDecimalString()}g TDS withheld`}
              />
              <Stat
                label="Net to holdings"
                value={<span className="tnum">{leasing.portfolio.netInterestGrams.toDecimalString()}g</span>}
                hint={
                  leasing.portfolio.unpostedGrams.isZero
                    ? "All booked to the ledger"
                    : `${leasing.portfolio.unpostedGrams.toDecimalString()}g not yet booked`
                }
              />
              <Stat
                label="Value today"
                value={leasing.portfolio.value}
                hint={
                  leasing.portfolio.value
                    ? "Principal plus net interest, at today's gram price"
                    : (leasing.unpricedReason ?? "No price resolved")
                }
              />
            </div>
          )}

          {leasing.overLeased && (
            <Card title="More grams on lease than held" className="mb-4">
              <p className="text-sm text-gray-300">
                The active leases put out more gold than the open lots hold. Either a lease was
                entered against gold that was never bought, or gold was sold while still on lease —
                worth resolving before the next accrual, because the interest is computed on the
                leased quantity.
              </p>
            </Card>
          )}

          {leasing.portfolio.matured.length > 0 && (
            <Card title="Past their closing date" className="mb-4">
              <p className="text-sm text-gray-300">
                {leasing.portfolio.matured.join(", ")} — interest has stopped accruing on these.
                Close them so the grams stop showing as on lease.
              </p>
            </Card>
          )}

          <div className="panel p-0">
            {leasing.rows.length === 0 ? (
              <EmptyState
                icon={Coins}
                title="No leases yet"
                body="Put some of your digital gold out on lease below. Nothing is posted when a lease opens — the gold is still yours, in the same account, at the same value."
              />
            ) : (
              <div className="table-scroll">
                <table className="w-full text-sm">
                  <caption className="sr-only">
                    Gold leases with grams outstanding, interest accrued, TDS withheld and value
                  </caption>
                  <thead>
                    <tr className="border-b border-gray-600">
                      <th scope="col" className="metric-label px-4 py-3 text-left">Lease</th>
                      <th scope="col" className="metric-label px-4 py-3 text-right">Grams</th>
                      <th scope="col" className="metric-label px-4 py-3 text-right">Rate</th>
                      <th scope="col" className="metric-label px-4 py-3 text-right">Months</th>
                      <th scope="col" className="metric-label px-4 py-3 text-right">Interest</th>
                      <th scope="col" className="metric-label px-4 py-3 text-right">TDS</th>
                      <th scope="col" className="metric-label px-4 py-3 text-right">Total grams</th>
                      <th scope="col" className="metric-label px-4 py-3 text-right">Value</th>
                      <th scope="col" className="metric-label px-4 py-3 text-left">Do</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leasing.rows.map((row) => (
                      <tr key={row.lease.id.value} className="border-b border-gray-600/50 last:border-0">
                        <td className="px-4 py-3">
                          <span className="font-medium text-gray-100">{row.lease.reference}</span>
                          <p className="text-xs text-gray-500">
                            {row.lease.props.platform} · {row.lease.props.startOn.toISO()} →{" "}
                            {row.lease.props.closesOn.toISO()}
                            {row.lease.status !== "ACTIVE" && ` · ${row.lease.status.toLowerCase()}`}
                            {row.isMatured && row.lease.status === "ACTIVE" && " · matured"}
                          </p>
                        </td>
                        <td className="tnum px-4 py-3 text-right text-gray-300">
                          {row.lease.quantity.toDecimalString()}
                        </td>
                        <td className="tnum px-4 py-3 text-right text-gray-400">
                          {row.lease.props.annualRate.toFixed(2)}%
                        </td>
                        <td className="tnum px-4 py-3 text-right text-gray-400">
                          {row.accrual.monthsCompleted} / {row.lease.termMonths}
                        </td>
                        <td className="tnum px-4 py-3 text-right text-gray-300">
                          {row.accrual.gross.toDecimalString()}
                        </td>
                        <td className="tnum px-4 py-3 text-right text-gray-400">
                          {row.accrual.tds.toDecimalString()}
                        </td>
                        <td className="tnum px-4 py-3 text-right text-gray-100">
                          {row.totalGrams.toDecimalString()}
                          {!row.unpostedGrams.isZero && (
                            <span className="ml-1 text-xs text-amber-500" title="Earned but not yet booked">
                              +{row.unpostedGrams.toDecimalString()} unbooked
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <MoneyText value={row.value} tone="neutral" />
                        </td>
                        <td className="px-4 py-3">
                          <LeaseRowActions
                            leaseId={row.lease.id.value}
                            reference={row.lease.reference}
                            defaultDate={today.toISO()}
                            isActive={row.lease.status === "ACTIVE"}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {leasing.returnOnCost && (
            <p className="mt-3 text-xs text-gray-500">
              Over what the gold cost: {leasing.returnOnCost.profit.toString()} (
              {leasing.returnOnCost.percent.toFixed(2)}%). Interest in grams and a gram price that
              moves are two different gains; this figure contains both.
            </p>
          )}

          <Card
            className="mt-4"
            title="Put gold out on lease"
            subtitle="Nothing is posted when a lease opens — leasing changes liquidity, not ownership. The interest posts as grams when you accrue it."
          >
            <OpenLeaseForm holdings={leasable} defaultDate={today.toISO()} />
          </Card>
        </section>
      )}

      {returns?.ok && (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <Card
            title="Returns"
            subtitle="Money-weighted, over the actual cashflows in the ledger."
          >
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="metric-label">XIRR</p>
                <p className="tnum mt-1 text-2xl font-semibold text-gray-100">
                  {returns.value.xirr.ok
                    ? `${returns.value.xirr.rate.percent.toFixed(2)}%`
                    : "—"}
                </p>
                {!returns.value.xirr.ok && (
                  <p className="mt-1 max-w-xs text-xs text-gray-500">{returns.value.xirr.because}</p>
                )}
              </div>
              <div>
                <p className="metric-label">Absolute</p>
                <p className="tnum mt-1 text-2xl font-semibold text-gray-100">
                  {returns.value.absoluteReturn
                    ? `${returns.value.absoluteReturn.toFixed(2)}%`
                    : "—"}
                </p>
                <p className="mt-1 text-xs text-gray-500">Value plus withdrawals, over invested</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-gray-600 pt-4 text-sm">
              <div>
                <p className="metric-label">Invested</p>
                <MoneyText value={returns.value.invested} tone="neutral" />
              </div>
              <div>
                <p className="metric-label">Taken out</p>
                <MoneyText value={returns.value.withdrawn} tone="neutral" />
              </div>
            </div>
            <p className="mt-3 text-xs text-gray-500">
              XIRR is money-weighted: a large contribution just before a rise flatters it, which is
              why the absolute figure sits beside it rather than instead of it.
            </p>
          </Card>

          <Card title="Allocation" subtitle="By market value, of the priced holdings.">
            {slices.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing priced yet.</p>
            ) : (
              <div className="space-y-3">
                {slices.map((slice) => (
                  <div key={slice.label}>
                    <div className="mb-1 flex items-baseline justify-between text-xs">
                      <span className="text-gray-300">{slice.label}</span>
                      <span className="tnum text-gray-500">{slice.weight.toFixed(1)}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-600">
                      <div
                        className="h-2 rounded-full bg-brand-500/70"
                        style={{ width: `${Math.min(100, slice.weight.toApproximateNumber())}%` }}
                        aria-hidden
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <Card
        title="Add an instrument"
        subtitle="Each one gets its own account under Assets:Investments, so a holding's value is a ledger balance rather than a second copy of one."
      >
        <AddInstrumentForm />
      </Card>
    </>
  );
}
