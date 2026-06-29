"use server";

import { revalidatePath } from "next/cache";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { investmentService } from "@/features/investments/investment.service";
import { priceService } from "./price.service";
import type { RefreshResult } from "./price.types";

/**
 * Refresh `currentPrice` (in INR) for the signed-in user's manual investments
 * using public price feeds. Read-only against external services; only the user's
 * own investment rows are written.
 */
export async function refreshInvestmentPrices(): Promise<
  RefreshResult & { success: boolean; error?: string }
> {
  const session = await getCurrentSession();
  if (!session?.user?.id) {
    return { success: false, error: "You must be signed in.", updated: 0, failed: 0, skipped: 0 };
  }

  try {
    const userId = session.user.id;
    const investments = await investmentService.list(userId);
    const fxCache = new Map<string, number>();

    let updated = 0;
    let failed = 0;
    let skipped = 0;

    for (const inv of investments) {
      if (!inv.symbol) {
        skipped++;
        continue;
      }
      const price = await priceService.getInrPrice(inv, fxCache);
      if (price == null) {
        failed++;
        continue;
      }
      await investmentService.update(inv.id, userId, {
        currentPrice: Number(price.toFixed(4)),
      });
      updated++;
    }

    revalidatePath("/investments");
    revalidatePath("/dashboard");
    return { success: true, updated, failed, skipped };
  } catch (err) {
    logger.error("refreshInvestmentPrices failed", err);
    return { success: false, error: "Couldn't refresh prices.", updated: 0, failed: 0, skipped: 0 };
  }
}
