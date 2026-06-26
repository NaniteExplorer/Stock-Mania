"use server";

import { getCurrentSession } from "@/lib/better-auth/auth";
import { logger } from "@/core/logger";
import { networthService } from "./networth.service";
import { formatINRCompact, formatSignedPercent } from "@/lib/utils";
import type { NetWorthOverview, NetWorthSummary } from "./networth.types";

const EMPTY_OVERVIEW: NetWorthOverview = {
  netWorth: 0,
  dayChange: 0,
  dayChangePercent: 0,
  allocation: [],
  totals: { accounts: 0, investments: 0, brokerage: 0, esops: 0, assets: 0 },
  counts: { accounts: 0, investments: 0, esops: 0, assets: 0 },
  hasData: false,
};

export async function getNetWorthOverview(): Promise<NetWorthOverview> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return EMPTY_OVERVIEW;
  try {
    return await networthService.getOverview(session.user.id);
  } catch (err) {
    logger.error("getNetWorthOverview failed", err);
    return EMPTY_OVERVIEW;
  }
}

export async function getNetWorthSummary(): Promise<NetWorthSummary | undefined> {
  const session = await getCurrentSession();
  if (!session?.user?.id) return undefined;
  try {
    const o = await networthService.getOverview(session.user.id);
    if (!o.hasData) return undefined;
    return {
      netWorth: formatINRCompact(o.netWorth),
      changeLabel: `${formatSignedPercent(o.dayChangePercent)} today`,
      positive: o.dayChange >= 0,
    };
  } catch (err) {
    logger.error("getNetWorthSummary failed", err);
    return undefined;
  }
}
