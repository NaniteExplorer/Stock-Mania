import Link from "next/link";
import { Star } from "lucide-react";
import { connection } from "next/server";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { getWatchListSymbolsByEmail } from "@/lib/actions/watchlist.actions";

const WatchlistPage = async () => {
  await connection();

  const session = await getCurrentSession();
  const symbols = await getWatchListSymbolsByEmail(session?.user?.email ?? "");

  if (!symbols.length) {
    return (
      <section className="watchlist-empty-container">
        <div className="watchlist-empty">
          <Star className="watchlist-star" aria-hidden="true" />
          <h1 className="empty-title">No stocks in your watchlist</h1>
          <p className="empty-description">
            Add stocks from a stock detail page to keep track of them here.
          </p>
          <Link href="/" className="footer-link">
            Back to dashboard
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="watchlist">
      <h1 className="watchlist-title">Watchlist</h1>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {symbols.map((symbol) => (
          <Link
            key={symbol}
            href={`/stocks/${symbol}`}
            className="news-item flex items-center justify-between"
          >
            <span className="text-lg font-semibold text-gray-100">
              {symbol}
            </span>
            <Star className="h-4 w-4 text-yellow-500" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  );
};

export default WatchlistPage;
