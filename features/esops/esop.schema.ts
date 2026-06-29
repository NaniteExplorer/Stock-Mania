import { z } from "zod";

export const createEsopSchema = z
  .object({
    company: z.string().trim().min(1, "Company is required.").max(120),
    grantDate: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid grant date."),
    totalOptions: z.number().positive("Total options must be greater than zero."),
    vestedOptions: z.number().nonnegative("Vested options cannot be negative."),
    strikePrice: z.number().nonnegative("Strike price cannot be negative."),
    currentFmv: z.number().nonnegative("Fair market value cannot be negative."),
  })
  .refine((v) => v.vestedOptions <= v.totalOptions, {
    message: "Vested options cannot exceed total options.",
    path: ["vestedOptions"],
  });

// .partial() is not available on a refined object; expose a separate update
// schema so partial updates stay independently validated.
export const updateEsopSchema = z.object({
  company: z.string().trim().min(1).max(120).optional(),
  grantDate: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), "Invalid grant date.")
    .optional(),
  totalOptions: z.number().positive().optional(),
  vestedOptions: z.number().nonnegative().optional(),
  strikePrice: z.number().nonnegative().optional(),
  currentFmv: z.number().nonnegative().optional(),
});
