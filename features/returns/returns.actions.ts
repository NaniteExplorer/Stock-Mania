"use server";

import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { returnsService } from "./returns.service";
import type { PortfolioReturn } from "./returns.types";

const EMPTY: PortfolioReturn = { xirr: null, invested: 0, currentValue: 0, byClass: [], byHolding: [] };

export async function getPortfolioReturns(): Promise<PortfolioReturn> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return EMPTY;
  try {
    return await returnsService.getPortfolioReturns(session.user.id);
  } catch (err) {
    logger.error("getPortfolioReturns failed", err);
    return EMPTY;
  }
}
