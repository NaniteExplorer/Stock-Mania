import { connectToDatabase } from "@/core/db/connection";
import { Asset } from "./asset.model";
import type { Asset as AssetEntity, CreateAssetInput, UpdateAssetInput, AssetCategory } from "./asset.types";

type Row = {
  _id: unknown;
  userId: string;
  name: string;
  category: AssetCategory;
  value: number;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

const toEntity = (row: Row): AssetEntity => ({
  id: String(row._id),
  userId: row.userId,
  name: row.name,
  category: row.category,
  value: row.value,
  note: row.note ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export interface AssetRepository {
  listByUser(userId: string): Promise<AssetEntity[]>;
  create(userId: string, input: CreateAssetInput): Promise<AssetEntity>;
  update(id: string, userId: string, input: UpdateAssetInput): Promise<void>;
  remove(id: string, userId: string): Promise<void>;
}

class MongoAssetRepository implements AssetRepository {
  async listByUser(userId: string): Promise<AssetEntity[]> {
    await connectToDatabase();
    const rows = await Asset.find({ userId }).sort({ value: -1 }).lean<Row[]>();
    return rows.map(toEntity);
  }

  async create(userId: string, input: CreateAssetInput): Promise<AssetEntity> {
    await connectToDatabase();
    const doc = await Asset.create({
      userId,
      name: input.name,
      category: input.category,
      value: input.value,
      note: input.note ?? null,
    });
    return toEntity(doc.toObject() as Row);
  }

  async update(id: string, userId: string, input: UpdateAssetInput): Promise<void> {
    await connectToDatabase();
    await Asset.updateOne({ _id: id, userId }, { $set: input });
  }

  async remove(id: string, userId: string): Promise<void> {
    await connectToDatabase();
    await Asset.deleteOne({ _id: id, userId });
  }
}

export const assetRepository: AssetRepository = new MongoAssetRepository();
