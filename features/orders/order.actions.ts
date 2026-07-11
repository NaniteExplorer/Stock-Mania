"use server";

import { getCurrentSession } from "@/lib/better-auth/auth";
import { orderService } from "./order.service";
import { parseInput } from "@/core/validation/parse";
import { placeOrderSchema } from "./order.schema";
import type { PlaceOrderInput, TradeOrder } from "./order.types";

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<{ success: true; order: TradeOrder } | { success: false; error: string }> {
  const session = await getCurrentSession();
  if (!session?.user) return { success: false, error: "Not authenticated." };

  const parsed = parseInput(placeOrderSchema, input);
  if (!parsed.success) return { success: false, error: parsed.error };

  try {
    const order = await orderService.place(session.user.id, parsed.data);
    return { success: true, order };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to place order.",
    };
  }
}

export async function getOrderHistory(): Promise<TradeOrder[]> {
  const session = await getCurrentSession();
  if (!session?.user) return [];
  return orderService.getHistory(session.user.id);
}
