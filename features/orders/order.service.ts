import { orderRepository } from "./order.repository";
import { getAuthenticatedKite } from "./zerodha.client";
import { placeAlpacaOrder } from "./alpaca.client";
import { eventBus } from "@/core/queue/event-bus";
import { isUSExchange } from "./order.types";
import type { PlaceOrderInput, TradeOrder, OrderBroker } from "./order.types";
import { logger } from "@/core/logger";

export const orderService = {
  async place(userId: string, input: PlaceOrderInput): Promise<TradeOrder> {
    const broker: OrderBroker = isUSExchange(input.exchange) ? "ALPACA" : "ZERODHA";

    const order = await orderRepository.create({
      userId,
      symbol: input.symbol,
      exchange: input.exchange,
      broker,
      side: input.side,
      orderType: input.orderType,
      product: input.product,
      quantity: input.quantity,
      price: input.price ?? null,
      status: "PENDING",
      brokerId: null,
      errorMessage: null,
    });

    let brokerId: string;

    try {
      if (broker === "ALPACA") {
        brokerId = await placeAlpacaOrder(input);
      } else {
        const kite = await getAuthenticatedKite(userId);
        const response = await kite.placeOrder("regular", {
          tradingsymbol: input.symbol,
          exchange: input.exchange,
          transaction_type: input.side,
          quantity: input.quantity,
          product: input.product,
          order_type: input.orderType,
          price: input.orderType === "LIMIT" ? input.price : undefined,
        });
        brokerId = String(response.order_id);
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      await orderRepository.updateStatus(order.id, "REJECTED", undefined, message);
      throw new Error(`Order rejected: ${message}`);
    }

    // The broker is now the source of truth. A local persistence or event-bus
    // failure must never relabel an accepted broker order as REJECTED.
    try {
      await orderRepository.updateStatus(order.id, "PLACED", brokerId);
    } catch (err) {
      logger.error("Broker accepted order but local status update failed", {
        orderId: order.id,
        brokerId,
        broker,
        err,
      });
    }

    try {
      await eventBus.publish({
        name: "trade/order.placed",
        data: {
          orderId: order.id,
          userId,
          symbol: input.symbol,
          side: input.side,
          quantity: input.quantity,
          brokerId,
          broker,
        },
      });
    } catch (err) {
      logger.error("Order placed but event publication failed", {
        orderId: order.id,
        brokerId,
        broker,
        err,
      });
    }

    return { ...order, status: "PLACED", brokerId };
  },

  async getHistory(userId: string): Promise<TradeOrder[]> {
    return orderRepository.findByUser(userId);
  },
};
