import type { GoldAnalytics } from "@/app/gold-analytics.usecases";
import { MoneyText } from "@/ui/primitives";
import { formatPercent } from "@/ui/format";
import { XirrValue } from "./gold-xirr";

/**
 * The annualised return, what it is net of, and the rate the holding has to
 * clear before a sale makes money.
 *
 * Three deliberate refusals live here:
 *
 *   1. An undefined XIRR renders its reason, never `0.00%` — see {@link XirrValue}.
 *   2. GST is **not** shown, because it is not derivable: a trade persists one
 *      fused, tax-inclusive charges figure, so `gstPaid` is always `null` today.
 *      Back-solving 3% would invent a split the user never entered. The reason
 *      is rendered in its place.
 *   3. The buy-back spread is a real, measured cost and appears as an explicit
 *      negative — but in its own group, because it is already netted off inside
 *      the profit above it. Adding the two would count it twice.
 */
export default function GoldReturnsPanel({ analytics }: { analytics: GoldAnalytics }) {
  const hasSpread = !analytics.sellSpread.isZero;
  const priced = analytics.pricedOn?.toISO() ?? null;
  const rateLabel = hasSpread ? "buy-back rate" : "published benchmark";

  return (
    <section className="panel mb-6 p-5" aria-labelledby="gold-returns-heading">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="gold-returns-heading" className="text-sm font-semibold text-gray-100">
            Money-weighted return
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            XIRR on the cash actually paid and received, ACT/365F, closed at the{" "}
            {rateLabel}. Grams credited by a lease settle no cash account, so they are not a
            cashflow — they arrive inside the closing value, as grams that cost nothing.
          </p>
        </div>
        <span className="pill">
          {priced ? `Priced ${priced}` : "No price"} · {rateLabel}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-600 p-4">
          <p className="metric-label">Return p.a. (blended)</p>
          <p className="mt-2 min-h-7">
            <XirrValue value={analytics.xirr} />
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {analytics.xirr.ok
              ? `${analytics.xirr.flows.length} cashflows · closing value at the ${rateLabel}`
              : "Money-weighted return on cash paid"}
          </p>
        </div>
        <div className="rounded-lg border border-gray-600 p-4">
          <p className="metric-label">Return p.a. (gold price only)</p>
          <p className="mt-2 min-h-7">
            <XirrValue value={analytics.priceXirr} />
          </p>
          <p className="mt-1 text-xs text-gray-500">
            The same flows closed at the value of the bought grams alone. The gap to the
            blended figure is the rent the lease paid.
          </p>
        </div>
        <div className="rounded-lg border border-gray-600 p-4">
          <p className="metric-label">Break-even {rateLabel} / gram</p>
          <p className="mt-2 text-xl font-semibold text-gray-100">
            <MoneyText value={analytics.breakEvenPricePerGram?.toMoney() ?? null} tone="neutral" />
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {analytics.breakEvenPricePerGram
              ? "Cash paid ÷ grams held. Below this a sale loses money."
              : "Needs recorded purchases and grams still held."}
          </p>
        </div>
        <div className="rounded-lg border border-gray-600 p-4">
          <p className="metric-label">Benchmark must print</p>
          <p className="mt-2 text-xl font-semibold text-gray-100">
            <MoneyText
              value={analytics.benchmarkBreakEvenPricePerGram?.toMoney() ?? null}
              tone="neutral"
            />
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {analytics.benchmarkBreakEvenPricePerGram
              ? hasSpread
                ? `The published rate has to clear break-even by the ${analytics.sellSpread.toFixed(2)}% spread before a sale does.`
                : "No buy-back spread is recorded, so this equals the break-even rate."
              : "Needs recorded purchases and grams still held."}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-600 p-4">
          <p className="metric-label">Where the return came from</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-gray-400">Gold price move</dt>
              <dd className="tnum">
                <MoneyText value={analytics.priceProfit} />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-gray-400">Lease interest</dt>
              <dd className="tnum">
                <MoneyText value={analytics.leaseProfit} />
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-gray-600 pt-2">
              <dt className="font-medium text-gray-200">Profit against cash paid</dt>
              <dd className="tnum font-semibold">
                <MoneyText value={analytics.totalProfit} />
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-gray-500">
            {analytics.leaseShareOfProfit
              ? `${formatPercent(analytics.leaseShareOfProfit)} of the profit is rent, not price.`
              : "The two halves add to the total by construction."}
          </p>
        </div>

        <div className="rounded-lg border border-gray-600 p-4">
          <p className="metric-label">Costs, shown as they are — negative</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-gray-400">
                Buy-back spread
                {hasSpread && (
                  <span className="ml-2 text-xs text-gray-500">
                    {analytics.sellSpread.toFixed(2)}% under benchmark
                  </span>
                )}
              </dt>
              <dd className="tnum text-amber-500">
                {hasSpread && analytics.spreadCost
                  ? `−${analytics.spreadCost.toDecimalString()}`
                  : "Not recorded"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-gray-600 pt-2">
              <dt className="text-gray-400">GST paid on purchases</dt>
              <dd className="tnum text-gray-400">
                {analytics.gstPaid ? `−${analytics.gstPaid.toDecimalString()}` : "Not separable"}
              </dd>
            </div>
          </dl>
          {!hasSpread && (
            <p className="mt-2 text-xs text-gray-500">
              No buy-back spread is recorded for this platform, so every figure above is valued
              at the published benchmark and is optimistic by whatever the platform actually
              discounts. Set the spread on the platform to make these realisable.
            </p>
          )}
          {!analytics.gstPaid && analytics.gstPaidReason && (
            <p className="mt-2 text-xs text-gray-500">{analytics.gstPaidReason}</p>
          )}
          <p className="mt-3 border-t border-gray-600 pt-3 text-xs text-gray-500">
            The spread is already netted off the profit opposite — it is itemised here so the
            drag is visible, not added a second time.
          </p>
        </div>
      </div>
    </section>
  );
}
