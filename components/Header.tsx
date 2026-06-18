import Link from "next/link";
import Image from "next/image";
import NavItems from "@/components/NavItems";
import UserDropdown from "@/components/UserDropdown";
import ThemeToggle from "@/components/ThemeToggle";
import SearchCommand from "@/components/SearchCommand";
import { User } from "better-auth";
import { searchStocks } from "@/features/stocks/stocks.actions";
import { Bell, Command, ShieldCheck } from "lucide-react";

const Header = async ({ user }: { user: User }) => {
  const initialStocks = await searchStocks();
  return (
    <header className="sticky top-0 header">
      <div className="container header-wrapper">
        <div className="flex min-w-0 items-center gap-5">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-yellow-500/30 bg-yellow-500/10">
              <Image
                src="/assets/icons/logo.svg"
                alt="stockMania"
                width={25}
                height={25}
                className="cursor-pointer"
              />
            </span>
            <span className="hidden leading-none sm:block">
              <span className="block text-lg font-bold tracking-tight text-gray-100">
                stock<span className="text-yellow-500">Mania</span>
              </span>
              <span className="mt-1 block text-[11px] font-medium uppercase tracking-[0.18em] text-gray-500">
                Wealth OS
              </span>
            </span>
          </Link>

          <div className="hidden items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-400 xl:flex">
            <ShieldCheck className="h-3.5 w-3.5" />
            Market intelligence online
          </div>
        </div>

        <nav className="hidden lg:block">
          <NavItems initialStocks={initialStocks} />
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden md:block">
            <SearchCommand
              renderAs="button"
              label={
                <span className="flex items-center gap-2">
                  Search assets
                  <span className="hidden items-center gap-1 rounded border border-gray-600 bg-gray-900 px-1.5 py-0.5 text-[10px] text-gray-500 lg:flex">
                    <Command className="h-3 w-3" /> K
                  </span>
                </span>
              }
              initialStocks={initialStocks}
            />
          </div>
          <button
            className="hidden h-9 w-9 items-center justify-center rounded-md border border-gray-600 bg-gray-800 text-gray-400 transition-colors hover:border-yellow-500/50 hover:text-yellow-400 sm:flex"
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
          </button>
          <ThemeToggle />
          <UserDropdown user={user} initialStocks={initialStocks} />
        </div>
      </div>
    </header>
  );
};

export default Header;
