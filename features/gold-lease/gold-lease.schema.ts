import { z } from "zod";

export const createGoldLeaseSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  leasedGrams: z.number().positive("Leased grams must be greater than zero."),
  annualRatePercent: z.number().min(0).max(100),
  startDate: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date."),
  termMonths: z.number().int().min(1).max(600).nullish(),
});
