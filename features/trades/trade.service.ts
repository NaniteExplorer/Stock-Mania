import { connectToDatabase } from "@/core/db/connection";
import { Investment } from "@/features/investments/investment.model";
import { taxSettingsService } from "@/features/tax/tax.settings.service";
import { estimateTax } from "@/features/tax/tax.service";
import { taxClassForKind } from "@/features/tax/tax.config";
import { computeFifo, type FifoTrade } from "./fifo";
import { tradeRepository } from "./trade.repository";
import type { CreateTradeInput, Trade } from "./trade.types";

/**
 * The trade ledger is the source of truth. After any change to a holding's
 * trades we recompute its derived Investment position (units, avgCost, realized
 * P&L, charges, holding-since) from the full FIFO history.
 */
async function recomputePosition(
  userId: string,
  symbol: string | null,
  name: string,
  kind: Trade["kind"],
): Promise<void> {
  await connectToDatabase();
  const trades = await tradeRepository.listForHolding(userId, symbol, name);
  const fifoTrades: FifoTrade[] = trades.map((t) => ({
    date: t.date,
    side: t.side,
    quantity: t.quantity,
    pricePerUnit: t.pricePerUnit,
    charges: t.chargesTotal,
  }));
  const fifo = computeFifo(fifoTrades);

  // Estimated tax on each realized (FIFO-matched) sell, summed.
  const config = await taxSettingsService.getConfig(userId);
  const assetClass = taxClassForKind(kind);
  const realizedTax = fifo.realized.reduce(
    (sum, ev) => sum + estimateTax(config, { assetClass, gain: ev.gain, holdingDays: ev.holdingDays }).taxAmount,
    0,
  );

  const filter = symbol ? { userId, symbol: symbol.toUpperCase() } : { userId, name };
  await Investment.updateOne(
    filter,
    {
      $set: {
        name,
        kind,
        units: fifo.openQuantity,
        avgCost: fifo.avgCost,
        holdingSince: fifo.holdingSince,
        realizedGain: fifo.realizedGain,
        realizedTax,
        totalCharges: fifo.totalCharges,
        openBuyCharges: fifo.openBuyCharges,
      },
      // currentPrice is owned by the price feed — seed it on insert only.
      $setOnInsert: {
        userId,
        symbol: symbol ? symbol.toUpperCase() : null,
        currentPrice: fifo.avgCost,
      },
    },
    { upsert: true },
  );
}

export const tradeService = {
  async add(userId: string, input: CreateTradeInput): Promise<{ created: boolean }> {
    const outcome = await tradeRepository.add(userId, input);
    // Recompute regardless — a duplicate is a no-op but keeps the position fresh.
    await recomputePosition(userId, input.symbol ?? null, input.name.trim(), input.kind);
    return { created: outcome === "inserted" };
  },

  listForHolding(userId: string, symbol: string | null, name: string): Promise<Trade[]> {
    return tradeRepository.listForHolding(userId, symbol, name);
  },

  listByUser(userId: string): Promise<Trade[]> {
    return tradeRepository.listByUser(userId);
  },

  async remove(id: string, userId: string, symbol: string | null, name: string, kind: Trade["kind"]): Promise<void> {
    await tradeRepository.remove(id, userId);
    await recomputePosition(userId, symbol, name, kind);
  },
};
