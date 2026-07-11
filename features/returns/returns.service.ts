import { investmentRepository } from "@/features/investments/investment.repository";
import { tradeRepository, holdingKey } from "@/features/trades/trade.repository";
import type { Investment, InvestmentKind } from "@/features/investments/investment.types";
import type { Trade } from "@/features/trades/trade.types";
import { xirr, type Cashflow } from "./xirr";
import type { AssetClassReturn, HoldingReturn, PortfolioReturn, ReturnMethod } from "./returns.types";

/**
 * Build a holding's cash flows. Ledger-first: BUY = money out (negative), SELL =
 * money in (positive), plus a terminal inflow equal to the current market value
 * of the still-open position. When there are no trades we approximate with a
 * single synthetic buy at the holding-since/created date (SNAPSHOT method) so
 * manual-only holdings still get an annualized figure and contribute to the
 * class/portfolio aggregates.
 */
function holdingFlows(inv: Investment, trades: Trade[]): { flows: Cashflow[]; method: ReturnMethod } {
  const now = new Date();
  const currentValue = inv.currentValue;

  if (trades.length > 0) {
    const flows: Cashflow[] = trades.map((t) => {
      const notional = t.quantity * t.pricePerUnit;
      return {
        date: t.date,
        amount: t.side === "BUY" ? -(notional + t.chargesTotal) : Math.max(0, notional - t.chargesTotal),
      };
    });
    if (inv.units > 1e-9 && currentValue > 0) flows.push({ date: now, amount: currentValue });
    return { flows, method: "LEDGER" };
  }

  // Manual-only: approximate from cost basis at the holding's start date.
  const start = inv.holdingSince ?? inv.createdAt;
  if (inv.invested > 0 && currentValue > 0 && start) {
    return {
      flows: [
        { date: new Date(start), amount: -inv.invested },
        { date: now, amount: currentValue },
      ],
      method: "SNAPSHOT",
    };
  }
  return { flows: [], method: "NONE" };
}

export const returnsService = {
  async getPortfolioReturns(userId: string): Promise<PortfolioReturn> {
    const [investments, allTrades] = await Promise.all([
      investmentRepository.listByUser(userId),
      tradeRepository.listByUser(userId),
    ]);

    // Group trades by holding key once.
    const tradesByHolding = new Map<string, Trade[]>();
    for (const t of allTrades) {
      const key = holdingKey(t.symbol, t.name);
      const list = tradesByHolding.get(key) ?? [];
      list.push(t);
      tradesByHolding.set(key, list);
    }

    const byHolding: HoldingReturn[] = [];
    const classFlows = new Map<InvestmentKind, Cashflow[]>();
    const classTotals = new Map<InvestmentKind, { invested: number; currentValue: number }>();
    const portfolioFlows: Cashflow[] = [];
    let totalInvested = 0;
    let totalCurrent = 0;

    for (const inv of investments) {
      const key = holdingKey(inv.symbol, inv.name);
      const trades = tradesByHolding.get(key) ?? [];
      const { flows, method } = holdingFlows(inv, trades);

      byHolding.push({
        holdingKey: key,
        name: inv.name,
        symbol: inv.symbol,
        kind: inv.kind,
        invested: inv.invested,
        currentValue: inv.currentValue,
        xirr: flows.length >= 2 ? xirr(flows) : null,
        absoluteReturn: inv.invested > 0 ? inv.currentValue / inv.invested - 1 : null,
        method,
      });

      // Aggregate into class + portfolio.
      classFlows.set(inv.kind, [...(classFlows.get(inv.kind) ?? []), ...flows]);
      const ct = classTotals.get(inv.kind) ?? { invested: 0, currentValue: 0 };
      ct.invested += inv.invested;
      ct.currentValue += inv.currentValue;
      classTotals.set(inv.kind, ct);
      portfolioFlows.push(...flows);
      totalInvested += inv.invested;
      totalCurrent += inv.currentValue;
    }

    const byClass: AssetClassReturn[] = [...classTotals.entries()].map(([kind, totals]) => {
      const flows = classFlows.get(kind) ?? [];
      return {
        kind,
        invested: totals.invested,
        currentValue: totals.currentValue,
        xirr: flows.length >= 2 ? xirr(flows) : null,
      };
    });

    return {
      xirr: portfolioFlows.length >= 2 ? xirr(portfolioFlows) : null,
      invested: totalInvested,
      currentValue: totalCurrent,
      byClass: byClass.sort((a, b) => b.currentValue - a.currentValue),
      byHolding: byHolding.sort((a, b) => b.currentValue - a.currentValue),
    };
  },
};
