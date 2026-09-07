"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, BarChart3, BriefcaseBusiness, LayoutDashboard, PlusCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/investments", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/investments/holdings", label: "Holdings", icon: BriefcaseBusiness },
  { href: "/investments/performance", label: "Performance", icon: BarChart3 },
  { href: "/investments/activity", label: "Activity", icon: Activity },
  { href: "/investments/new", label: "Add", icon: PlusCircle },
] as const;

export default function InvestmentNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Investment workspace" className="flex gap-2 overflow-x-auto pb-1">
      {ITEMS.map((item) => {
        const active = "exact" in item ? pathname === item.href : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-brand inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm transition-colors",
              active
                ? "border-brand-500 bg-brand-500/10 text-gray-100"
                : "border-gray-600 text-gray-400 hover:border-gray-500 hover:text-gray-100",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
