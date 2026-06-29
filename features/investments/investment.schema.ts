import { z } from "zod";

const INVESTMENT_KINDS = ["STOCK", "ETF", "MUTUAL_FUND", "BOND", "CRYPTO"] as const;

export const createInvestmentSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  symbol: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9.\-:]{1,20}$/, "Invalid symbol.")
    .nullish(),
  kind: z.enum(INVESTMENT_KINDS),
  units: z.number().positive("Units must be greater than zero."),
  avgCost: z.number().nonnegative("Average cost cannot be negative."),
  currentPrice: z.number().nonnegative("Current price cannot be negative."),
});

export const updateInvestmentSchema = createInvestmentSchema.partial();
