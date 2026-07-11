import Link from "next/link";
import UserDropdown from "@/components/UserDropdown";
import SearchCommand from "@/components/SearchCommand";
import { BrandMark } from "@/components/Logo";
import { User } from "better-auth";
import { searchStocks } from "@/features/stocks/stocks.actions";
import { Bell, Command, Plus, Radio } from "lucide-react";

const Header = async ({ user }: { user: User }) => {
  const initialStocks = await searchStocks();
  return (
    <header className="header sticky top-0">
      <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-6 lg:px-8">
        {/* Mobile brand (sidebar is hidden on mobile) */}
        <Link href="/dashboard" className="lg:hidden">
          <BrandMark logoClassName="h-9 w-9" wordmarkClassName="text-base" />
        </Link>

        {/* Desktop search */}
        <div className="hidden flex-1 lg:block">
          <SearchCommand
            renderAs="button"
            label={
              <span className="flex w-full max-w-md items-center justify-between gap-2 text-gray-500">
                <span className="flex items-center gap-2">Search stocks, assets…</span>
                <span className="flex items-center gap-1 rounded border border-gray-600 bg-gray-900 px-1.5 py-0.5 text-[10px]">
                  <Command className="h-3 w-3" /> K
                </span>
              </span>
            }
            initialStocks={initialStocks}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="data-status hidden xl:inline-flex">
            <Radio className="h-3 w-3" /> Live connections
          </span>
          <div className="lg:hidden">
            <SearchCommand renderAs="text" label="Search" initialStocks={initialStocks} />
          </div>
          <Link
            href="/accounts"
            className="hidden h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white transition-colors hover:brightness-110 sm:flex"
          >
            <Plus className="h-4 w-4" />
            Quick add
          </Link>
          <button
            className="hidden h-9 w-9 items-center justify-center rounded-lg border border-gray-600 bg-gray-800 text-gray-400 transition-colors hover:border-brand-500/50 hover:text-brand-400 sm:flex"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
          </button>
          <UserDropdown user={user} />
        </div>
      </div>
    </header>
  );
};

export default Header;
