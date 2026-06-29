import Link from "next/link";
import { Star } from "lucide-react";
import { connection } from "next/server";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { getWatchListSymbolsByEmail } from "@/features/watchlist/watchlist.actions";

const WatchlistPage = async () => {
  await connection();

  const session = await getCurrentSession();
  const symbols = await getWatchListSymbolsByEmail(session?.user?.email ?? "");

  if (!symbols.length) {
    return (
      <section className="cockpit-panel mx-auto mt-10 flex max-w-2xl flex-col items-center px-6 py-16 text-center">
        <div className="watchlist-empty">
          <Star className="watchlist-star" aria-hidden="true" />
          <h1 className="empty-title">No stocks in your watchlist</h1>
          <p className="empty-description">
            Add stocks from a stock detail page to keep track of them here.
          </p>
          <Link href="/search" className="yellow-btn inline-flex items-center px-5">
            Discover stocks
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Watchlist</h1>
        <p className="page-subtitle">Stocks you&apos;re keeping an eye on.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {symbols.map((symbol) => (
          <Link
            key={symbol}
            href={`/stocks/${symbol}`}
            className="cockpit-panel panel-hover group flex items-center justify-between p-5"
          >
            <span className="text-lg font-semibold text-gray-100">
              {symbol}
            </span>
            <span className="flex items-center gap-2 text-xs text-gray-500"><span className="h-1.5 w-1.5 rounded-full bg-green-500" />Watching <Star className="h-4 w-4 text-yellow-500 transition-transform group-hover:scale-110" aria-hidden="true" /></span>
          </Link>
        ))}
      </div>
    </section>
  );
};

export default WatchlistPage;
