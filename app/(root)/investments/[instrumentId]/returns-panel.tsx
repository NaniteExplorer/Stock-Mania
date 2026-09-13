import type { Money } from "@/core/money";
import type { Percentage, Quantity } from "@/core/numeric";
import type { Xirr } from "@/domain/portfolio";
import { MoneyText, Pill, Stat } from "@/ui/primitives";
import { formatPercent } from "@/ui/format";
import { XirrValue } from "./gold-xirr";

/**
 * XIRR and P/L for one holding, over the owner's own ledger.
 *
 * Every number here comes from `ValuePortfolio` and the instrument-scoped XIRR
 * flow builder in `src/app/investing.usecases.ts`, which read the ledger and the
 * price ladder. None of it is recomputed in this file, and that is the point:
 * a panel that does its own arithmetic is a second implementation of the money
 * path, and the two drift.
 *
 * Three refusals, each the same refusal in a different place:
 *
 *  - **An unpriced position renders as unpriced, never as zero.** A market value
 *    of `null` means "no price resolved", and the difference between that and
 *    "worth nothing" is the whole holding. `Stat` renders a `null` Money as a
 *    dash with a label; the hint beside it says why.
 *  - **An undefined XIRR renders its reason.** `XirrValue` already does this and
 *    is reused rather than reimplemented.
 *  - **Cost basis is the ledger's, untouched by any chart.** The average cost
 *    shown is price x quantity *as traded*. Where the owner has logged a split
 *    since, the current-share figure is shown **beside** it, through
 *    `normaliseTrade` on the server (C3) — never instead of it. Two numbers,
 *    labelled, because collapsing them to one is precisely the 40x NVDA error.
 */
export interface HoldingReturns {
  readonly currency: string;
  readonly quantity: Quantity;
  /** Ledger cost of the open lots, price plus charges, as traded. */
  readonly costBasis: Money;
  /** Weighted mean buy price across every recorded buy, exactly as traded. */
  readonly averageBuyPriceAsTraded: Money | null;
  /** Units bought, as traded — the denominator of the figure above. */
  readonly boughtQuantityAsTraded: Quantity;
  /**
   * The same mean expressed per *current* share, through `normaliseTrade`. `null`
   * when no logged split falls after any buy and the two figures are identical.
   */
  readonly averageBuyPricePerCurrentShare: Money | null;
  /** Units bought restated into today's shares. */
  readonly boughtQuantityInCurrentShares: Quantity | null;
  readonly splitFactorLabel: string | null;
  /** `null` means no price resolved — not zero. */
  readonly marketValue: Money | null;
  readonly unrealisedGain: Money | null;
  readonly realisedGain: Money;
  readonly absoluteReturn: Percentage | null;
  readonly xirr: Xirr;
  readonly pricedOn: string | null;
  readonly isStale: boolean;
  readonly unpricedReason: string | null;
  /** True when the portfolio total could not be converted to the reporting currency. */
  readonly unconverted: boolean;
  readonly asOf: string;
}

export default function ReturnsPanel({ returns }: { returns: HoldingReturns }) {
  const priced = returns.marketValue !== null;

  return (
    <section className="panel mb-6 p-5" aria-labelledby="holding-returns-heading">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="holding-returns-heading" className="text-sm font-semibold text-gray-100">
            Returns over your ledger
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-gray-500">
            Money-weighted return and profit and loss for this holding alone, computed from the trades you recorded
            and valued through the price ladder as of {returns.asOf}.
          </p>
        </div>
        <Pill tone="neutral">
          {priced
            ? `Priced ${returns.pricedOn ?? returns.asOf}${returns.isStale ? " · stale" : ""}`
            : "Unpriced"}
        </Pill>
      </div>

      {!priced && (
        <p role="status" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 text-xs text-amber-300">
          No price resolved for this holding{returns.unpricedReason ? `: ${returns.unpricedReason}` : "."} Market
          value, unrealised gain and XIRR are left blank rather than shown as zero — an unpriced position is not a
          worthless one, and only you can tell which this is.
        </p>
      )}

      {returns.unconverted && (
        <p role="status" className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] p-3 text-xs text-amber-300">
          Part of this holding could not be converted to the reporting currency, so the portfolio-level figures it
          feeds are partial. The per-holding numbers below are in {returns.currency}.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Invested" value={returns.costBasis} hint="Open-lot cost plus charges, exactly as traded" />
        <Stat
          label="Market value"
          value={returns.marketValue}
          hint={priced ? "Latest resolved valuation" : (returns.unpricedReason ?? "No price resolved")}
        />
        <Stat
          label="Unrealised gain / loss"
          value={returns.unrealisedGain}
          hint={returns.absoluteReturn ? `${formatPercent(returns.absoluteReturn)} on open cost` : "Needs a priced open position"}
        />
        <Stat label="Realised gain / loss" value={returns.realisedGain} hint="Disposals already recorded" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-600/70 p-4">
          <p className="metric-label">XIRR</p>
          <div className="mt-1">
            <XirrValue value={returns.xirr} />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Annualised and money-weighted, from every cash leg this holding produced plus its closing value.
          </p>
        </div>

        <div className="rounded-lg border border-gray-600/70 p-4">
          <p className="metric-label">Average buy price, as traded</p>
          <div className="mt-1 text-xl font-semibold">
            <MoneyText value={returns.averageBuyPriceAsTraded} tone="neutral" />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Across {returns.boughtQuantityAsTraded.toDecimalString()} units bought; {returns.quantity.toDecimalString()}{" "}
            still held.
          </p>
          {returns.averageBuyPricePerCurrentShare && returns.boughtQuantityInCurrentShares && (
            <div className="mt-2 rounded border border-gray-600 px-2 py-1.5 text-xs text-gray-400">
              Per current share, after the {returns.splitFactorLabel} you logged:{" "}
              <MoneyText value={returns.averageBuyPricePerCurrentShare} tone="neutral" className="text-gray-200" />{" "}
              across {returns.boughtQuantityInCurrentShares.toDecimalString()} shares. That is the figure comparable
              with the adjusted price chart above; the one beside it is what you actually paid. Your cost basis is the
              same money either way — applying the split factor to a series that already carries it is the 40x error
              this pair exists to make impossible.
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-500">
        Cost basis is taken from the ledger only. Nothing on this panel is derived from the price series, so a
        retroactively restated history cannot move it.
      </p>
    </section>
  );
}
