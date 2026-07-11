"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu, X, ArrowRight } from "lucide-react";
import { BrandMark } from "@/components/Logo";

const links = [
  { href: "#features", label: "Features" },
  { href: "#assets", label: "Assets" },
  { href: "#intelligence", label: "Intelligence" },
  { href: "#security", label: "Security" },
];

const MarketingHeader = ({ isAuthed }: { isAuthed: boolean }) => {
  const [open, setOpen] = useState(false);
  const primaryHref = isAuthed ? "/dashboard" : "/sign-up";
  const primaryLabel = isAuthed ? "Open dashboard" : "Get started";

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="container">
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-gray-600 bg-gray-800/75 px-4 py-3 shadow-[0_10px_30px_-18px_rgba(16,24,40,0.25)] backdrop-blur-xl">
          <Link href="/" className="shrink-0">
            <BrandMark logoClassName="h-9 w-9" />
          </Link>

          <nav className="hidden items-center gap-1 lg:flex">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="rounded-full px-4 py-2 text-sm font-medium text-gray-400 transition-colors hover:text-gray-100"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            {!isAuthed && (
              <Link
                href="/sign-in"
                className="text-sm font-semibold text-gray-300 transition-colors hover:text-gray-100"
              >
                Sign in
              </Link>
            )}
            <Link href={primaryHref} className="btn-glow !h-10 !px-5">
              {primaryLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          <button
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-gray-600 text-gray-200 lg:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {open && (
          <div className="mt-2 rounded-2xl border border-gray-600 bg-gray-800/97 p-4 backdrop-blur-xl lg:hidden">
            <nav className="flex flex-col">
              {links.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-3 text-sm font-medium text-gray-300 hover:bg-gray-700"
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2">
              {!isAuthed && (
                <Link href="/sign-in" className="ghost-btn w-full">
                  Sign in
                </Link>
              )}
              <Link href={primaryHref} className="btn-glow w-full">
                {primaryLabel}
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default MarketingHeader;
