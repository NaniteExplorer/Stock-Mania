import { connectToDatabase } from "@/core/db/connection";
import { Investment } from "./investment.model";
import type {
  Investment as InvestmentEntity,
  CreateInvestmentInput,
  UpdateInvestmentInput,
  InvestmentKind,
} from "./investment.types";

type Row = {
  _id: unknown;
  userId: string;
  name: string;
  symbol: string | null;
  kind: InvestmentKind;
  units: number;
  avgCost: number;
  currentPrice: number;
  createdAt: Date;
  updatedAt: Date;
};

const toEntity = (row: Row): InvestmentEntity => {
  const invested = row.units * row.avgCost;
  const currentValue = row.units * row.currentPrice;
  const pnl = currentValue - invested;
  const pnlPercent = invested > 0 ? (pnl / invested) * 100 : 0;
  return {
    id: String(row._id),
    userId: row.userId,
    name: row.name,
    symbol: row.symbol ?? null,
    kind: row.kind,
    units: row.units,
    avgCost: row.avgCost,
    currentPrice: row.currentPrice,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    invested,
    currentValue,
    pnl,
    pnlPercent,
  };
};

export interface InvestmentRepository {
  listByUser(userId: string): Promise<InvestmentEntity[]>;
  create(userId: string, input: CreateInvestmentInput): Promise<InvestmentEntity>;
  update(id: string, userId: string, input: UpdateInvestmentInput): Promise<void>;
  remove(id: string, userId: string): Promise<void>;
}

class MongoInvestmentRepository implements InvestmentRepository {
  async listByUser(userId: string): Promise<InvestmentEntity[]> {
    await connectToDatabase();
    const rows = await Investment.find({ userId }).sort({ createdAt: -1 }).lean<Row[]>();
    return rows.map(toEntity);
  }

  async create(userId: string, input: CreateInvestmentInput): Promise<InvestmentEntity> {
    await connectToDatabase();
    const doc = await Investment.create({
      userId,
      name: input.name,
      symbol: input.symbol ?? null,
      kind: input.kind,
      units: input.units,
      avgCost: input.avgCost,
      currentPrice: input.currentPrice,
    });
    return toEntity(doc.toObject() as Row);
  }

  async update(id: string, userId: string, input: UpdateInvestmentInput): Promise<void> {
    await connectToDatabase();
    await Investment.updateOne({ _id: id, userId }, { $set: input });
  }

  async remove(id: string, userId: string): Promise<void> {
    await connectToDatabase();
    await Investment.deleteOne({ _id: id, userId });
  }
}

export const investmentRepository: InvestmentRepository = new MongoInvestmentRepository();
