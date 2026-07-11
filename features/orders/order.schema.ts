import { z } from "zod";

export const placeOrderSchema = z.object({
  symbol: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9.\-:&]{1,20}$/, "Invalid symbol."),
  exchange: z.enum(["NSE", "BSE", "NFO", "MCX", "NYSE", "NASDAQ", "ARCA"]),
  side: z.enum(["BUY", "SELL"]),
  orderType: z.enum(["MARKET", "LIMIT"]),
  product: z.enum(["CNC", "MIS", "NRML"]),
  quantity: z.number().int().positive("Quantity must be a positive integer.").max(1_000_000),
  price: z.number().positive().finite().optional(),
});
