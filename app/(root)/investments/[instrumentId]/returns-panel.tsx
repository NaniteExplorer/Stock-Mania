import type { Money } from "@/core/money";
import type { Percentage, Quantity } from "@/core/numeric";
import type { Xirr } from "@/domain/portfolio";
import { FigureText } from "@/components/ui/data-cell";
import { Kpi, KpiStrip, Panel } from "../../../../components/ui/page-shell";
import { percentage, rupee, signed, unknown } from "@/core/format";
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
 *    "worth nothing" is the whole holding. `Kpi` renders it as an explained
 *    unknown, never a formatted zero.
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
    <Panel
      title="Returns over your ledger"
      description={`Money-weighted return and profit and loss for this holding alone, computed from the trades you recorded and valued through the price ladder as of ${returns.asOf}.`}
      actions={
        <span className="text-xs text-(--fg-muted)">
          {priced
            ? `Priced ${returns.pricedOn ?? returns.asOf}${returns.isStale ? " · stale" : ""}`
            : "Unpriced"}
        </span>
      }
    >
      {!priced && (
        <p role="status" className="mb-4 rounded-lg border border-(--warn)/40 bg-(--warn)/[0.06] p-3 text-xs text-(--warn)">
          No price resolved for this holding{returns.unpricedReason ? `: ${returns.unpricedReason}` : "."} Market
         value, unrealised gain and XIRR are left blank rather than shown as zero — an unpriced position is not a
          worthless one, and only you can tell which this is.
        </p>
      )}

      {returns.unconverted && (
        <p role="status" className="mb-4 rounded-lg border border-(--warn)/40 bg-(--warn)/[0.06] p-3 text-xs text-(--warn)">
          Part of this holding could not be converted to the reporting currency, so the portfolio-level figures it
          feeds are partial. The per-holding numbers below are in {returns.currency}.
        </p>
      )}

      <KpiStrip>
        <Kpi label="Invested" value={rupee(returns.costBasis)} detail="Open-lot cost plus charges, exactly as traded" />
        <Kpi
          label="Market value"
          value={returns.marketValue ? rupee(returns.marketValue) : unknown(returns.unpricedReason ?? "No price resolved")}
          detail={priced ? "Latest resolved valuation" : undefined}
        />
        <Kpi
          label="Unrealised gain / loss"
          value={returns.unrealisedGain ? signed(returns.unrealisedGain) : unknown("Needs a priced open position")}
          detail={returns.absoluteReturn ? `${formatPercent(returns.absoluteReturn)} on open cost` : undefined}
        />
        <Kpi
          label="Absolute return"
          value={returns.absoluteReturn ? percentage(returns.absoluteReturn) : unknown("Needs a priced open position")}
          detail="Unrealised gain divided by open-position cost"
        />
      </KpiStrip>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-(--border)/70 p-4">
          <h3 className="text-xs font-medium text-(--fg-muted)">XIRR</h3>
          <div className="mt-1">
            <XirrValue value={returns.xirr} />
          </div>
          <p className="mt-2 text-xs text-(--fg-muted)">
            Annualised and money-weighted, from every cash leg this holding produced plus its closing value.
          </p>
        </div>

        <div className="rounded-lg border border-(--border)/70 p-4">
          <h3 className="text-xs font-medium text-(--fg-muted)">Average buy price, as traded</h3>
          <div className="mt-1 text-xl font-semibold">
            {returns.averageBuyPriceAsTraded ? <FigureText value={returns.averageBuyPriceAsTraded} /> : "—"}
          </div>
          <p className="mt-2 text-xs text-(--fg-muted)">
            Across {returns.boughtQuantityAsTraded.toDecimalString()} units bought; {returns.quantity.toDecimalString()}{" "}
            still held.
          </p>
          {returns.averageBuyPricePerCurrentShare && returns.boughtQuantityInCurrentShares && (
            <div className="mt-2 rounded border border-(--border) px-2 py-1.5 text-xs text-(--fg-secondary)">
              Per current share, after the {returns.splitFactorLabel} you logged:{" "}
              <FigureText value={returns.averageBuyPricePerCurrentShare} className="text-(--fg)" />{" "}
              across {returns.boughtQuantityInCurrentShares.toDecimalString()} shares. That is the figure comparable
              with the adjusted price chart above; the one beside it is what you actually paid. Your cost basis is the
              same money either way — applying the split factor to a series that already carries it is the 40x error
              this pair exists to make impossible.
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 text-xs text-(--fg-muted)">
        Cost basis is taken from the ledger only. Nothing on this panel is derived from the price series, so a
        retroactively restated history cannot move it.
      </p>
    </Panel>
  );
}
