import { z } from "zod";

const ASSET_CATEGORIES = [
  "REAL_ESTATE",
  "GOLD",
  "SILVER",
  "VEHICLE",
  "EPF",
  "PPF",
  "NPS",
  "CRYPTO",
  "OTHER",
] as const;

export const createAssetSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  category: z.enum(ASSET_CATEGORIES),
  value: z.number().nonnegative("Value cannot be negative."),
  note: z.string().trim().max(500).nullish(),
});

export const updateAssetSchema = createAssetSchema.partial();
