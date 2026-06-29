import { z } from "zod";

const INVESTMENT_KINDS = ["STOCK", "ETF", "MUTUAL_FUND", "BOND", "CRYPTO", "DIGITAL_GOLD"] as const;

export const createTradeSchema = z.object({
  symbol: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9.\-:]{1,20}$/, "Invalid symbol.")
    .nullish(),
  name: z.string().trim().min(1, "Name is required.").max(120),
  kind: z.enum(INVESTMENT_KINDS),
  side: z.enum(["BUY", "SELL"]),
  date: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Invalid date."),
  quantity: z.number().positive("Quantity must be greater than zero."),
  pricePerUnit: z.number().nonnegative("Price cannot be negative."),
  charges: z
    .object({
      brokerage: z.number().nonnegative().optional(),
      taxes: z.number().nonnegative().optional(),
      other: z.number().nonnegative().optional(),
    })
    .optional(),
  currency: z.string().trim().length(3).optional(),
  source: z.enum(["MANUAL", "IMPORT", "DRIVE"]).optional(),
});
