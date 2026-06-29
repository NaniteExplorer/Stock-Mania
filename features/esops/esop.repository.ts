import { connectToDatabase } from "@/core/db/connection";
import { Esop } from "./esop.model";
import type { EsopGrant, CreateEsopInput, UpdateEsopInput } from "./esop.types";

type Row = {
  _id: unknown;
  userId: string;
  company: string;
  grantDate: Date;
  totalOptions: number;
  vestedOptions: number;
  strikePrice: number;
  currentFmv: number;
  createdAt: Date;
  updatedAt: Date;
};

const toEntity = (row: Row): EsopGrant => {
  const perShare = Math.max(row.currentFmv - row.strikePrice, 0);
  return {
    id: String(row._id),
    userId: row.userId,
    company: row.company,
    grantDate: row.grantDate,
    totalOptions: row.totalOptions,
    vestedOptions: row.vestedOptions,
    strikePrice: row.strikePrice,
    currentFmv: row.currentFmv,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    vestedValue: row.vestedOptions * perShare,
    totalValue: row.totalOptions * perShare,
    vestedPercent: row.totalOptions > 0 ? (row.vestedOptions / row.totalOptions) * 100 : 0,
  };
};

const fromInput = (input: UpdateEsopInput) => {
  const out: Record<string, unknown> = {};
  if (input.company !== undefined) out.company = input.company;
  if (input.grantDate !== undefined) out.grantDate = new Date(input.grantDate);
  if (input.totalOptions !== undefined) out.totalOptions = input.totalOptions;
  if (input.vestedOptions !== undefined) out.vestedOptions = input.vestedOptions;
  if (input.strikePrice !== undefined) out.strikePrice = input.strikePrice;
  if (input.currentFmv !== undefined) out.currentFmv = input.currentFmv;
  return out;
};

export interface EsopRepository {
  listByUser(userId: string): Promise<EsopGrant[]>;
  create(userId: string, input: CreateEsopInput): Promise<EsopGrant>;
  update(id: string, userId: string, input: UpdateEsopInput): Promise<void>;
  remove(id: string, userId: string): Promise<void>;
}

class MongoEsopRepository implements EsopRepository {
  async listByUser(userId: string): Promise<EsopGrant[]> {
    await connectToDatabase();
    const rows = await Esop.find({ userId }).sort({ grantDate: -1 }).lean<Row[]>();
    return rows.map(toEntity);
  }

  async create(userId: string, input: CreateEsopInput): Promise<EsopGrant> {
    await connectToDatabase();
    const doc = await Esop.create({ userId, ...fromInput(input) });
    return toEntity(doc.toObject() as Row);
  }

  async update(id: string, userId: string, input: UpdateEsopInput): Promise<void> {
    await connectToDatabase();
    await Esop.updateOne({ _id: id, userId }, { $set: fromInput(input) });
  }

  async remove(id: string, userId: string): Promise<void> {
    await connectToDatabase();
    await Esop.deleteOne({ _id: id, userId });
  }
}

export const esopRepository: EsopRepository = new MongoEsopRepository();
