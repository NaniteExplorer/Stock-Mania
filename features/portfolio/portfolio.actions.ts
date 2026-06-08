"use server";

import { getCurrentSession } from "@/lib/better-auth/auth";
import { portfolioService } from "./portfolio.service";
import type { PortfolioSummary } from "./portfolio.types";

export async function getPortfolio(): Promise<PortfolioSummary | null> {
  const session = await getCurrentSession();
  if (!session?.user) return null;
  return portfolioService.getPortfolio(session.user.id);
}
