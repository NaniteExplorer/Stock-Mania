import type { GoldAnalytics } from "@/app/gold-analytics.usecases";
import { FigureText } from "@/components/ui/data-cell";
import { Kpi, KpiStrip, Panel } from "../../../../components/ui/page-shell";
import { percentage, rupee, unknown, type FigureValue } from "@/core/format";
import type { Xirr } from "@/domain/portfolio";
import { formatPercent } from "@/ui/format";

/** An undefined XIRR is an explained unknown, never 0.00%. */
function xirrFigure(value: Xirr): FigureValue {
  return value.ok ? percentage(value.rate.percent) : unknown(value.because);
}

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
    <Panel
      title="Money-weighted return"
      description={`XIRR on the cash actually paid and received, ACT/365F, closed at the ${rateLabel}. Grams credited by a lease settle no cash account, so they are not a cashflow — they arrive inside the closing value, as grams that cost nothing.`}
      actions={
        <span className="text-xs text-(--fg-muted)">
          {priced ? `Priced ${priced}` : "No price"} · {rateLabel}
        </span>
      }
    >
      <KpiStrip>
        <Kpi
          label="Return p.a. (blended)"
          value={xirrFigure(analytics.xirr)}
          detail={
            analytics.xirr.ok
              ? `${analytics.xirr.flows.length} cashflows · closing value at the ${rateLabel}`
              : "Money-weighted return on cash paid"
          }
        />
        <Kpi
          label="Return p.a. (gold price only)"
          value={xirrFigure(analytics.priceXirr)}
          detail="The same flows closed at the value of the bought grams alone. The gap to the blended figure is the rent the lease paid."
        />
        <Kpi
          label={`Break-even ${rateLabel} / gram`}
          value={
            analytics.breakEvenPricePerGram
              ? rupee(analytics.breakEvenPricePerGram.toMoney())
              : unknown("Needs recorded purchases and grams still held.")
          }
          detail={analytics.breakEvenPricePerGram ? "Cash paid ÷ grams held. Below this a sale loses money." : undefined}
        />
        <Kpi
          label="Benchmark must print"
          value={
            analytics.benchmarkBreakEvenPricePerGram
              ? rupee(analytics.benchmarkBreakEvenPricePerGram.toMoney())
              : unknown("Needs recorded purchases and grams still held.")
          }
          detail={
            analytics.benchmarkBreakEvenPricePerGram
              ? hasSpread
                ? `The published rate has to clear break-even by the ${analytics.sellSpread.toFixed(2)}% spread before a sale does.`
                : "No buy-back spread is recorded, so this equals the break-even rate."
              : undefined
          }
        />
      </KpiStrip>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-(--border) p-4">
          <h3 className="text-sm font-semibold text-(--fg)">Where the return came from</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-(--fg-secondary)">Gold price move</dt>
              <dd className="tnum">
                {analytics.priceProfit ? <FigureText value={analytics.priceProfit} tone="change" /> : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-(--fg-secondary)">Lease interest</dt>
              <dd className="tnum">
                {analytics.leaseProfit ? <FigureText value={analytics.leaseProfit} tone="change" /> : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-(--border) pt-2">
              <dt className="font-medium text-(--fg)">Profit against cash paid</dt>
              <dd className="tnum font-semibold">
                {analytics.totalProfit ? <FigureText value={analytics.totalProfit} tone="change" /> : "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-(--fg-muted)">
            {analytics.leaseShareOfProfit
              ? `${formatPercent(analytics.leaseShareOfProfit)} of the profit is rent, not price.`
              : "The two halves add to the total by construction."}
          </p>
        </div>

        <div className="rounded-lg border border-(--border) p-4">
          <h3 className="text-sm font-semibold text-(--fg)">Costs, shown as they are — negative</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-(--fg-secondary)">
                Buy-back spread
                {hasSpread && (
                  <span className="ml-2 text-xs text-(--fg-muted)">
                    {analytics.sellSpread.toFixed(2)}% under benchmark
                  </span>
                )}
              </dt>
              <dd className="tnum text-(--warn)">
                {hasSpread && analytics.spreadCost
                  ? `−${analytics.spreadCost.toDecimalString()}`
                  : "Not recorded"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-t border-(--border) pt-2">
              <dt className="text-(--fg-secondary)">GST paid on purchases</dt>
              <dd className="tnum text-(--fg-secondary)">
                {analytics.gstPaid ? `−${analytics.gstPaid.toDecimalString()}` : "Not separable"}
              </dd>
            </div>
          </dl>
          {!hasSpread && (
            <p className="mt-2 text-xs text-(--fg-muted)">
              No buy-back spread is recorded for this platform, so every figure above is valued
              at the published benchmark and is optimistic by whatever the platform actually
              discounts. Set the spread on the platform to make these realisable.
            </p>
          )}
          {!analytics.gstPaid && analytics.gstPaidReason && (
            <p className="mt-2 text-xs text-(--fg-muted)">{analytics.gstPaidReason}</p>
          )}
          <p className="mt-3 border-t border-(--border) pt-3 text-xs text-(--fg-muted)">
            The spread is already netted off the profit opposite — it is itemised here so the
            drag is visible, not added a second time.
          </p>
        </div>
      </div>
    </Panel>
  );
}
