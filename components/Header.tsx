import Link from "next/link";
import UserDropdown from "@/components/UserDropdown";
import { BrandMark } from "@/components/Logo";
import { User } from "better-auth";
import { Plus } from "lucide-react";

/**
 * The app header.
 *
 * v1 also carried a command-palette search, a "Live connections" status pill and
 * a notifications bell. All three are gone rather than disabled: the search
 * queried the deleted `stocks` feature, there are no live connections in v2 (all
 * data is entered or imported), and the bell was never wired to anything. A dead
 * affordance is worse than an absent one.
 *
 * The palette returns in Phase 2 over the transaction register, where it has
 * something real to search — `components/ui/command.tsx` and `cmdk` are kept for it.
 */
const Header = ({ user }: { user: User }) => {
  return (
    <header className="header sticky top-0">
      <div className="flex items-center justify-between gap-4 px-4 py-3 md:px-6 lg:px-8">
        {/* Mobile brand — the sidebar that normally carries it is hidden here. */}
        <Link href="/dashboard" className="lg:hidden">
          <BrandMark logoClassName="h-9 w-9" wordmarkClassName="text-base" />
        </Link>

        <div className="hidden flex-1 lg:block" />

        <div className="flex items-center gap-2">
          <Link
            href="/accounts"
            className="hidden h-9 items-center gap-1.5 rounded-lg bg-brand-500 px-3 text-sm font-semibold text-white transition-colors hover:brightness-110 sm:flex"
          >
            <Plus className="h-4 w-4" />
            Quick add
          </Link>
          <UserDropdown user={user} />
        </div>
      </div>
    </header>
  );
};

export default Header;
