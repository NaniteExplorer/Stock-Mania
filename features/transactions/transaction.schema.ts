import { z } from "zod";

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Invalid id.");

/** One parsed statement row as sent back from the client preview. */
export const parsedRowSchema = z.object({
  transactionDate: z.string().trim().min(4).max(40),
  description: z.string().trim().min(1).max(500),
  reference: z.string().max(200).nullish(),
  amount: z.number().finite(),
  direction: z.enum(["CREDIT", "DEBIT"]),
  balanceAfter: z.number().finite().nullish(),
  currency: z.string().trim().length(3).optional(),
  occurrence: z.number().int().nonnegative().optional(),
  statementBalance: z.number().finite().optional(),
  statementBalanceDate: z.string().max(40).optional(),
});

export const importStatementSchema = z.object({
  accountId: objectIdSchema,
  fileName: z.string().trim().min(1).max(255),
  rows: z.array(parsedRowSchema).min(1, "No rows to import.").max(10_000),
});

export const setBudgetSchema = z.object({
  category: z.string().trim().min(1).max(60),
  monthlyLimit: z
    .number()
    .finite()
    .min(0, "Budget cannot be negative.")
    .max(1_000_000_000, "Budget is too large."),
});

export const transactionQuerySchema = z.object({
  accountId: objectIdSchema.optional(),
  category: z.string().max(60).optional(),
  direction: z.enum(["CREDIT", "DEBIT", ""]).optional(),
  search: z.string().max(200).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  page: z.number().int().min(1).max(100_000).optional(),
  pageSize: z.number().int().min(1).max(200).optional(),
});
