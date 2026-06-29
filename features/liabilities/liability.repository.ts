/**
 * Repository layer — the ONLY place that talks to MongoDB for liabilities.
 * Maps raw Mongo rows to clean domain entities so the service and UI never see
 * Mongo internals. Mirrors the accounts repository template.
 */
import { connectToDatabase } from "@/core/db/connection";
import { Liability } from "./liability.model";
import type {
  Liability as LiabilityEntity,
  CreateLiabilityInput,
  UpdateLiabilityInput,
  LiabilityType,
} from "./liability.types";

type Row = {
  _id: unknown;
  userId: string;
  name: string;
  lender: string;
  type: LiabilityType;
  outstanding: number;
  emi: number | null;
  interestRate: number | null;
  createdAt: Date;
  updatedAt: Date;
};

const toEntity = (row: Row): LiabilityEntity => ({
  id: String(row._id),
  userId: row.userId,
  name: row.name,
  lender: row.lender,
  type: row.type,
  outstanding: row.outstanding,
  emi: row.emi ?? null,
  interestRate: row.interestRate ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export interface LiabilityRepository {
  listByUser(userId: string): Promise<LiabilityEntity[]>;
  create(userId: string, input: CreateLiabilityInput): Promise<LiabilityEntity>;
  update(id: string, userId: string, input: UpdateLiabilityInput): Promise<void>;
  remove(id: string, userId: string): Promise<void>;
}

class MongoLiabilityRepository implements LiabilityRepository {
  async listByUser(userId: string): Promise<LiabilityEntity[]> {
    await connectToDatabase();
    const rows = await Liability.find({ userId }).sort({ outstanding: -1 }).lean<Row[]>();
    return rows.map(toEntity);
  }

  async create(userId: string, input: CreateLiabilityInput): Promise<LiabilityEntity> {
    await connectToDatabase();
    const doc = await Liability.create({
      userId,
      name: input.name,
      lender: input.lender ?? "",
      type: input.type,
      outstanding: input.outstanding,
      emi: input.emi ?? null,
      interestRate: input.interestRate ?? null,
    });
    return toEntity(doc.toObject() as Row);
  }

  async update(id: string, userId: string, input: UpdateLiabilityInput): Promise<void> {
    await connectToDatabase();
    await Liability.updateOne({ _id: id, userId }, { $set: input });
  }

  async remove(id: string, userId: string): Promise<void> {
    await connectToDatabase();
    await Liability.deleteOne({ _id: id, userId });
  }
}

export const liabilityRepository: LiabilityRepository = new MongoLiabilityRepository();
