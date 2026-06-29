export type AssetCategory =
  | "REAL_ESTATE"
  | "GOLD"
  | "SILVER"
  | "VEHICLE"
  | "EPF"
  | "PPF"
  | "NPS"
  | "CRYPTO"
  | "OTHER";

export const ASSET_CATEGORY_LABELS: Record<AssetCategory, string> = {
  REAL_ESTATE: "Real estate",
  GOLD: "Gold & jewellery",
  SILVER: "Silver",
  VEHICLE: "Vehicle",
  EPF: "EPF",
  PPF: "PPF",
  NPS: "NPS",
  CRYPTO: "Crypto",
  OTHER: "Other",
};

export interface Asset {
  id: string;
  userId: string;
  name: string;
  category: AssetCategory;
  value: number;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAssetInput {
  name: string;
  category: AssetCategory;
  value: number;
  note?: string | null;
}

export type UpdateAssetInput = Partial<CreateAssetInput>;
