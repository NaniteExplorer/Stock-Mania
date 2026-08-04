import { z } from "zod";

const ACCOUNT_TYPES = [
  "BANK",
  "CASH",
  "WALLET",
  "CREDIT_CARD",
  "FIXED_DEPOSIT",
  "RECURRING_DEPOSIT",
  "PPF",
  "NPS",
  "EPFO",
] as const;

export const createAccountSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  institution: z.string().trim().min(1, "Institution is required.").max(120),
  providerId: z.string().trim().max(120).nullish(),
  currency: z.string().trim().length(3, "Currency must be a 3-letter code.").optional(),
  type: z.enum(ACCOUNT_TYPES),
  balance: z.number().finite("Balance must be a number."),
  last4: z
    .string()
    .regex(/^\d{4}$/, "Last 4 must be 4 digits.")
    .nullish(),
  interestRatePercent: z.number().min(0).max(100).nullish(),
});

export const updateAccountSchema = createAccountSchema.partial();
