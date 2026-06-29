"use server";

import { getCurrentSession } from "@/lib/better-auth/auth";
import { orderService } from "./order.service";
import type { PlaceOrderInput, TradeOrder } from "./order.types";

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<{ success: true; order: TradeOrder } | { success: false; error: string }> {
  const session = await getCurrentSession();
  if (!session?.user) return { success: false, error: "Not authenticated." };

  try {
    const order = await orderService.place(session.user.id, input);
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
