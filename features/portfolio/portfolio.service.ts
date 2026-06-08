import { getAuthenticatedKite, isConnected as isZerodhaConnected } from "@/features/orders/zerodha.client";
import { getAlpacaPositions, isAlpacaConfigured } from "@/features/orders/alpaca.client";
import { cache } from "@/core/cache";
import type { Holding, Position, PortfolioSummary } from "./portfolio.types";
import type { ZerodhaHolding, ZerodhaPosition } from "@/features/orders/zerodha.client";

function fromZerodhaHolding(h: ZerodhaHolding): Holding {
  const totalValue = h.last_price * h.quantity;
  const investedValue = h.average_price * h.quantity;
  return {
    symbol: h.tradingsymbol,
    exchange: h.exchange,
    quantity: h.quantity,
    avgPrice: h.average_price,
    currentPrice: h.last_price,
    pnl: h.pnl,
    pnlPercent: investedValue > 0 ? (h.pnl / investedValue) * 100 : 0,
    dayChange: h.day_change,
    dayChangePercent: h.day_change_percentage,
    totalValue,
    investedValue,
    broker: "ZERODHA",
  };
}

function fromZerodhaPosition(p: ZerodhaPosition): Position {
  return {
    symbol: p.tradingsymbol,
    exchange: p.exchange,
    product: p.product,
    quantity: Math.abs(p.quantity),
    avgPrice: p.average_price,
    currentPrice: p.last_price,
    pnl: p.pnl,
    unrealised: p.unrealised,
    realised: p.realised,
    side: p.quantity >= 0 ? "LONG" : "SHORT",
    broker: "ZERODHA",
  };
}

export const portfolioService = {
  async getPortfolio(userId: string): Promise<PortfolioSummary> {
    const [zerodhaOk, alpacaOk] = await Promise.all([
      isZerodhaConnected(userId),
      Promise.resolve(isAlpacaConfigured()),
    ]);

    const holdings: Holding[] = [];
    const positions: Position[] = [];

    if (zerodhaOk) {
      try {
        const kite = await getAuthenticatedKite(userId);

        // Cache holdings 60s per user — avoids hammering Zerodha API on every page load.
        const [rawHoldings, rawPositions] = await Promise.all([
          cache.wrap<ZerodhaHolding[]>(
            `zerodha:holdings:${userId}`,
            60,
            () => kite.getHoldings(),
          ),
          cache.wrap<{ net: ZerodhaPosition[]; day: ZerodhaPosition[] }>(
            `zerodha:positions:${userId}`,
            30,
            () => kite.getPositions(),
          ),
        ]);

        holdings.push(...rawHoldings.map(fromZerodhaHolding));
        positions.push(
          ...rawPositions.net
            .filter((p) => p.quantity !== 0)
            .map(fromZerodhaPosition),
        );
      } catch {
        // token expired or API error — return empty rather than crash
      }
    }

    if (alpacaOk) {
      try {
        const alpacaPositions = await cache.wrap<Position[]>(
          `alpaca:positions`,
          60,
          () => getAlpacaPositions(),
        );
        positions.push(...alpacaPositions);
      } catch {
        // Alpaca unavailable
      }
    }

    const totalInvested = holdings.reduce((s, h) => s + h.investedValue, 0);
    const currentValue = holdings.reduce((s, h) => s + h.totalValue, 0);
    const totalPnl = holdings.reduce((s, h) => s + h.pnl, 0);
    const dayPnl = holdings.reduce((s, h) => s + h.dayChange * h.quantity, 0);

    return {
      holdings,
      positions,
      totalInvested,
      currentValue,
      totalPnl,
      totalPnlPercent: totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0,
      dayPnl,
      zerodhaConnected: zerodhaOk,
      alpacaConnected: alpacaOk,
    };
  },
};
