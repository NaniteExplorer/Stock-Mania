/**
 * Pure FIFO cost-basis engine. No I/O — given a holding's trades it returns the
 * open lots and the realized (matched) sell events, so realized/unrealized P&L
 * and per-lot holding periods (for tax tiers) can be computed deterministically.
 *
 * Conventions:
 *  - BUY charges are capitalized into cost basis (allocated proportionally when a
 *    lot is partially sold).
 *  - SELL charges reduce proceeds (allocated proportionally across the sold qty).
 *  - avgCost reported is the price-only weighted average (excludes charges) to
 *    match the existing Investment semantics; charges are surfaced separately.
 */

export type TradeSide = "BUY" | "SELL";

export interface FifoTrade {
  date: Date;
  side: TradeSide;
  quantity: number;
  pricePerUnit: number;
  /** Total charges (brokerage + taxes + other) for the whole trade. */
  charges: number;
}

export interface RealizedEvent {
  sellDate: Date;
  buyDate: Date;
  quantity: number;
  /** qty × buy price + proportional buy charges. */
  costBasis: number;
  /** qty × sell price − proportional sell charges. */
  proceeds: number;
  holdingDays: number;
  /** proceeds − costBasis (pre-tax). */
  gain: number;
}

export interface FifoResult {
  openQuantity: number;
  /** Σ remaining qty × buy price (price only, excludes charges). */
  openCostExclCharges: number;
  /** Σ remaining proportional buy charges still sitting in open lots. */
  openBuyCharges: number;
  /** Price-only weighted average cost of open lots (0 when flat). */
  avgCost: number;
  /** Earliest open-lot date — the holding-period clock for what's still held. */
  holdingSince: Date | null;
  realized: RealizedEvent[];
  realizedGain: number;
  /** All-time charges across every buy and sell. */
  totalCharges: number;
}

interface Lot {
  date: Date;
  remaining: number;
  pricePerUnit: number;
  /** Per-unit buy charge, so partial sells consume charges proportionally. */
  chargePerUnit: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Compute FIFO open lots + realized events for one holding's trade history. */
export function computeFifo(trades: FifoTrade[]): FifoResult {
  // Stable chronological order; on the same day, process BUY before SELL.
  const ordered = [...trades].sort((a, b) => {
    const d = a.date.getTime() - b.date.getTime();
    if (d !== 0) return d;
    return a.side === b.side ? 0 : a.side === "BUY" ? -1 : 1;
  });

  const lots: Lot[] = [];
  const realized: RealizedEvent[] = [];
  let totalCharges = 0;

  for (const trade of ordered) {
    totalCharges += trade.charges;
    const qty = Math.abs(trade.quantity);
    if (qty === 0) continue;

    if (trade.side === "BUY") {
      lots.push({
        date: trade.date,
        remaining: qty,
        pricePerUnit: trade.pricePerUnit,
        chargePerUnit: qty > 0 ? trade.charges / qty : 0,
      });
      continue;
    }

    // SELL — match against the oldest lots first.
    let toSell = qty;
    const sellChargePerUnit = qty > 0 ? trade.charges / qty : 0;
    while (toSell > 0 && lots.length > 0) {
      const lot = lots[0];
      const take = Math.min(toSell, lot.remaining);
      const costBasis = take * lot.pricePerUnit + take * lot.chargePerUnit;
      const proceeds = take * trade.pricePerUnit - take * sellChargePerUnit;
      const holdingDays = Math.max(0, Math.round((trade.date.getTime() - lot.date.getTime()) / DAY_MS));
      realized.push({
        sellDate: trade.date,
        buyDate: lot.date,
        quantity: take,
        costBasis,
        proceeds,
        holdingDays,
        gain: proceeds - costBasis,
      });
      lot.remaining -= take;
      toSell -= take;
      if (lot.remaining <= 1e-9) lots.shift();
    }
    // Oversell (more sold than held) is ignored beyond available lots — the
    // ledger is the source of truth and shouldn't allow it; we don't fabricate.
  }

  const openQuantity = lots.reduce((s, l) => s + l.remaining, 0);
  const openCostExclCharges = lots.reduce((s, l) => s + l.remaining * l.pricePerUnit, 0);
  const openBuyCharges = lots.reduce((s, l) => s + l.remaining * l.chargePerUnit, 0);

  return {
    openQuantity,
    openCostExclCharges,
    openBuyCharges,
    avgCost: openQuantity > 1e-9 ? openCostExclCharges / openQuantity : 0,
    holdingSince: lots.length ? lots[0].date : null,
    realized,
    realizedGain: realized.reduce((s, r) => s + r.gain, 0),
    totalCharges,
  };
}
