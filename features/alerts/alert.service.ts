import { alertRepository } from "./alert.repository";
import { messenger } from "@/core/messaging";
import { config } from "@/core/config/env";
import { logger } from "@/core/logger";
import type { PriceAlert, CreateAlertInput } from "./alert.types";

async function fetchCurrentPrice(symbol: string): Promise<number | null> {
  const { apiKey, baseUrl } = config.finnhub();
  if (!apiKey) return null;
  try {
    const res = await fetch(`${baseUrl}/quote?symbol=${symbol}&token=${apiKey}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { c?: number };
    return data.c ?? null;
  } catch {
    return null;
  }
}

function buildAlertMessage(alert: PriceAlert, currentPrice: number): string {
  const direction = alert.type === "PRICE_ABOVE" ? "above" : "below";
  return [
    `📊 *stockMania Alert*`,
    `Symbol: *${alert.symbol}*`,
    `Current price ₹${currentPrice.toFixed(2)} is ${direction} your target of ₹${alert.targetPrice.toFixed(2)}.`,
    `Open stockMania to review your position.`,
  ].join("\n");
}

export const alertService = {
  async create(userId: string, input: CreateAlertInput): Promise<PriceAlert> {
    return alertRepository.create(userId, input);
  },

  async listForUser(userId: string): Promise<PriceAlert[]> {
    return alertRepository.findByUser(userId);
  },

  async cancel(id: string, userId: string): Promise<void> {
    return alertRepository.cancel(id, userId);
  },

  async checkAndNotify(): Promise<{ checked: number; triggered: number }> {
    const active = await alertRepository.findAllActive();
    if (!active.length) return { checked: 0, triggered: 0 };

    const symbols = [...new Set(active.map((a) => a.symbol))];
    const prices = new Map<string, number>();

    await Promise.all(
      symbols.map(async (sym) => {
        const price = await fetchCurrentPrice(sym);
        if (price !== null) prices.set(sym, price);
      }),
    );

    let triggered = 0;
    await Promise.all(
      active.map(async (alert) => {
        const price = prices.get(alert.symbol);
        if (price === undefined) return;

        const fired =
          (alert.type === "PRICE_ABOVE" && price >= alert.targetPrice) ||
          (alert.type === "PRICE_BELOW" && price <= alert.targetPrice);

        if (!fired) return;
        triggered++;

        await alertRepository.markTriggered(alert.id);

        const message = buildAlertMessage(alert, price);

        if (
          (alert.channel === "WHATSAPP" || alert.channel === "BOTH") &&
          alert.whatsappNumber
        ) {
          await messenger.send(alert.whatsappNumber, message).catch((err) => {
            logger.warn("WhatsApp alert delivery failed", { err, alertId: alert.id });
          });
        }
      }),
    );

    return { checked: active.length, triggered };
  },
};
