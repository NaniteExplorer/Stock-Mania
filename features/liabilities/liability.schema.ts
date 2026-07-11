import { z } from "zod";

const LIABILITY_TYPES = [
  "HOME_LOAN",
  "CAR_LOAN",
  "PERSONAL_LOAN",
  "EDUCATION_LOAN",
  "CREDIT_CARD",
  "OTHER",
] as const;

export const createLiabilitySchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  lender: z.string().trim().min(1, "Lender is required.").max(120),
  type: z.enum(LIABILITY_TYPES),
  outstanding: z.number().nonnegative("Outstanding cannot be negative.").finite(),
  emi: z.number().nonnegative().finite().nullish(),
  interestRate: z.number().min(0).max(100).nullish(),
});

export const updateLiabilitySchema = createLiabilitySchema.partial();

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Invalid id.");
