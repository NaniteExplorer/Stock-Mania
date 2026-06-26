"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_GROUPS } from "@/lib/constants";
import { BrandMark } from "@/components/Logo";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";

export interface SidebarSummary {
  netWorth: string;
  changeLabel: string;
  positive: boolean;
}

const isActive = (pathname: string, href: string) =>
  href === "/dashboard" ? pathname === "/dashboard" : pathname.startsWith(href);

const Sidebar = ({ summary }: { summary?: SidebarSummary }) => {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-gray-600 bg-sidebar px-3 py-5 lg:flex">
      <Link href="/dashboard" className="px-1">
        <BrandMark logoClassName="h-10 w-10" subtitle="Wealth OS" />
      </Link>

      {summary && (
        <Link
          href="/dashboard"
          className="mt-5 block rounded-2xl border border-gray-600 bg-gray-700/50 p-4 transition-colors hover:border-yellow-500/40"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            Net worth
          </p>
          <p className="mt-1 text-xl font-bold tracking-tight text-gray-100 tnum">
            {summary.netWorth}
          </p>
          <p
            className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold ${
              summary.positive ? "text-green-500" : "text-red-500"
            }`}
          >
            {summary.positive ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            {summary.changeLabel}
          </p>
        </Link>
      )}

      <nav className="mt-2 flex-1 overflow-y-auto scrollbar-hide">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="side-group-label">{group.label}</p>
            <ul className="flex flex-col gap-0.5">
              {group.items.map(({ href, label, icon: Icon }) => (
                <li key={href}>
                  <Link
                    href={href}
                    className={`side-link ${isActive(pathname, href) ? "side-link-active" : ""}`}
                  >
                    <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-3 rounded-xl border border-gray-600 bg-gray-700/40 p-3">
        <p className="text-xs font-semibold text-gray-300">Manual + live</p>
        <p className="mt-1 text-[11px] leading-4 text-gray-500">
          Add accounts, ESOPs &amp; assets manually; markets sync live.
        </p>
      </div>
    </aside>
  );
};

export default Sidebar;
