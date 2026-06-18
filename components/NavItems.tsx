"use client";
import { NAV_ITEMS } from "@/lib/constants";
import Link from "next/link";
import { usePathname } from "next/navigation";
import SearchCommand from "@/components/SearchCommand";

const NavItems = ({
  initialStocks,
}: {
  initialStocks: StockWithWatchlistStatus[];
}) => {
  const pathname = usePathname();

  const isActive = (path: string) => {
    if (path === "/dashboard") return pathname === "/dashboard";

    return pathname.startsWith(path);
  };

  return (
    <ul className="flex flex-col gap-1 lg:flex-row lg:items-center lg:rounded-lg lg:border lg:border-gray-600/70 lg:bg-gray-800/60 lg:p-1">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        if (href === "/search")
          return (
            <li key="search-trigger" className="md:hidden">
              <SearchCommand
                renderAs="text"
                label="Search"
                initialStocks={initialStocks}
              />
            </li>
          );

        return (
          <li key={href}>
            <Link
              href={href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors ${
                isActive(href)
                  ? "bg-yellow-500/10 text-yellow-400 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.22)]"
                  : "text-gray-400 hover:bg-gray-700/70 hover:text-gray-100"
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
};
export default NavItems;
