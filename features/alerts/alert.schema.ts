import { z } from "zod";

export const createAlertSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9.\-:]{1,20}$/, "Invalid symbol."),
    type: z.enum(["PRICE_ABOVE", "PRICE_BELOW"]),
    targetPrice: z.number().positive("Target price must be greater than zero."),
    channel: z.enum(["EMAIL", "WHATSAPP", "BOTH"]),
    // E.164: optional leading +, 8–15 digits.
    whatsappNumber: z
      .string()
      .trim()
      .regex(/^\+?[1-9]\d{7,14}$/, "Enter a valid phone number in E.164 format.")
      .optional(),
  })
  .refine(
    (v) => v.channel === "EMAIL" || Boolean(v.whatsappNumber),
    {
      message: "A WhatsApp number is required for WhatsApp alerts.",
      path: ["whatsappNumber"],
    },
  );
