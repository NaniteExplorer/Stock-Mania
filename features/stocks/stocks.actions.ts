"use server";

import { searchStocks as searchStocksService } from "@/features/stocks/stocks.service";

/**
 * Server Action wrapper for stock search — the public entry point used by
 * Server Components (Header) and Client Components (SearchCommand).
 */
export async function searchStocks(
  query?: string,
): Promise<StockWithWatchlistStatus[]> {
  return searchStocksService(query);
}
