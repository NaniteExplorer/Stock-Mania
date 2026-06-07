import Link from "next/link";
import { TrendingUp } from "lucide-react";
import type { Metadata } from "next";
import SearchCommand from "@/components/SearchCommand";
import { searchStocks } from "@/features/stocks/stocks.actions";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage() {
  const initialStocks = await searchStocks();

  return (
    <section className="watchlist">
      <div className="flex items-center justify-between gap-4">
        <h1 className="watchlist-title">Search stocks</h1>
        <SearchCommand
          renderAs="button"
          label="Search stocks"
          initialStocks={initialStocks}
        />
      </div>

      {initialStocks.length === 0 ? (
        <p className="empty-description mt-6">
          No stocks to show right now. Try searching above.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {initialStocks.map((stock) => (
            <Link
              key={stock.symbol}
              href={`/stocks/${stock.symbol}`}
              className="news-item flex items-center gap-3"
            >
              <TrendingUp
                className="h-5 w-5 text-yellow-500"
                aria-hidden="true"
              />
              <div className="flex-1">
                <div className="search-item-name">{stock.name}</div>
                <div className="text-sm text-gray-500">
                  {stock.symbol} | {stock.exchange} | {stock.type}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
