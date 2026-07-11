import { z } from "zod";

const money = z.number().finite("Must be a number.");

export const captureSnapshotSchema = z.object({
  asOf: z.coerce.date().optional(),
  source: z.enum(["AUTO", "MANUAL", "IMPORTED", "EDITED"]).optional(),
  overwrite: z.boolean().optional(),
});

const breakdownSchema = z
  .object({
    accounts: money,
    investments: money,
    brokerage: money,
    esops: money,
    assets: money,
    liabilities: money,
    creditCard: money,
  })
  .partial();

export const editSnapshotSchema = z
  .object({
    totalAssets: money.nonnegative().optional(),
    totalLiabilities: money.nonnegative().optional(),
    breakdown: breakdownSchema.optional(),
    note: z.string().trim().max(280).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update.");

// A CSV backfill row after client-side parsing, before persistence.
const csvRowSchema = z.object({
  periodKey: z.string().regex(/^\d{4}-\d{2}$/, "periodKey must be YYYY-MM."),
  capturedAt: z.coerce.date(),
  breakdown: z.object({
    accounts: money,
    investments: money,
    brokerage: money,
    esops: money,
    assets: money,
    liabilities: money,
    creditCard: money,
  }),
  totalAssets: money,
  totalLiabilities: money,
  netWorth: money,
});

export const importSnapshotsSchema = z.object({
  rows: z.array(csvRowSchema).min(1, "No rows to import.").max(600, "Too many rows (max 600)."),
  overwrite: z.boolean().optional(),
});
