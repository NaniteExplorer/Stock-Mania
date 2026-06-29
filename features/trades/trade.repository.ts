import { createHash } from "node:crypto";
import { connectToDatabase } from "@/core/db/connection";
import { Trade } from "./trade.model";
import type { CreateTradeInput, Trade as TradeEntity } from "./trade.types";

/** Holding identity used to group trades into a position. */
export function holdingKey(symbol: string | null, name: string): string {
  return (symbol?.trim().toUpperCase() || name.trim().toLowerCase());
}

function fingerprint(userId: string, input: CreateTradeInput): string {
  const symbol = (input.symbol?.trim().toUpperCase() || input.name.trim().toLowerCase());
  const date = new Date(input.date).toISOString().slice(0, 10);
  return createHash("sha256")
    .update([userId, symbol, input.side, date, input.quantity, input.pricePerUnit].join("|"))
    .digest("hex");
}

type Row = {
  _id: unknown;
  userId: string;
  symbol: string | null;
  name: string;
  kind: TradeEntity["kind"];
  side: TradeEntity["side"];
  date: Date;
  quantity: number;
  pricePerUnit: number;
  brokerage: number;
  taxes: number;
  other: number;
  currency: string;
  source: TradeEntity["source"];
  createdAt: Date;
  updatedAt: Date;
};

const toEntity = (row: Row): TradeEntity => ({
  id: String(row._id),
  userId: row.userId,
  symbol: row.symbol ?? null,
  name: row.name,
  kind: row.kind,
  side: row.side,
  date: row.date,
  quantity: row.quantity,
  pricePerUnit: row.pricePerUnit,
  charges: { brokerage: row.brokerage ?? 0, taxes: row.taxes ?? 0, other: row.other ?? 0 },
  chargesTotal: (row.brokerage ?? 0) + (row.taxes ?? 0) + (row.other ?? 0),
  currency: row.currency,
  source: row.source,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export const tradeRepository = {
  /** Insert a trade idempotently; returns whether a new row was created. */
  async add(userId: string, input: CreateTradeInput): Promise<"inserted" | "duplicate"> {
    await connectToDatabase();
    const charges = input.charges ?? {};
    const result = await Trade.updateOne(
      { userId, fingerprint: fingerprint(userId, input) },
      {
        $setOnInsert: {
          userId,
          symbol: input.symbol ? input.symbol.toUpperCase() : null,
          name: input.name.trim(),
          kind: input.kind,
          side: input.side,
          date: new Date(input.date),
          quantity: input.quantity,
          pricePerUnit: input.pricePerUnit,
          brokerage: charges.brokerage ?? 0,
          taxes: charges.taxes ?? 0,
          other: charges.other ?? 0,
          currency: (input.currency ?? "INR").toUpperCase(),
          source: input.source ?? "MANUAL",
          fingerprint: fingerprint(userId, input),
        },
      },
      { upsert: true },
    );
    return result.upsertedCount ? "inserted" : "duplicate";
  },

  async listForHolding(userId: string, symbol: string | null, name: string): Promise<TradeEntity[]> {
    await connectToDatabase();
    const key = holdingKey(symbol, name);
    const rows = await Trade.find({
      userId,
      ...(symbol ? { symbol: symbol.toUpperCase() } : { name }),
    }).sort({ date: 1, _id: 1 }).lean<Row[]>();
    // Defensive: only the trades whose key matches (symbol-less holdings by name).
    return rows.map(toEntity).filter((t) => holdingKey(t.symbol, t.name) === key);
  },

  async listByUser(userId: string): Promise<TradeEntity[]> {
    await connectToDatabase();
    const rows = await Trade.find({ userId }).sort({ date: -1, _id: -1 }).limit(1000).lean<Row[]>();
    return rows.map(toEntity);
  },

  async remove(id: string, userId: string): Promise<void> {
    await connectToDatabase();
    await Trade.deleteOne({ _id: id, userId });
  },
};
