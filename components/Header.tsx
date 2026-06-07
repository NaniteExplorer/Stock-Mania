import Link from "next/link";
import Image from "next/image";
import NavItems from "@/components/NavItems";
import UserDropdown from "@/components/UserDropdown";
import ThemeToggle from "@/components/ThemeToggle";
import { User } from "better-auth";
import { searchStocks } from "@/features/stocks/stocks.actions";

const Header = async ({ user }: { user: User }) => {
  const initialStocks = await searchStocks();
  return (
    <header className="sticky top-0 header">
      <div className="container header-wrapper">
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/assets/icons/logo.svg"
            alt="stockMania"
            width={32}
            height={32}
            className="cursor-pointer"
          />
          <span className="text-xl font-bold tracking-tight text-gray-100">
            stock<span className="text-yellow-500">Mania</span>
          </span>
        </Link>
        <nav className="hidden sm:block">
          <NavItems initialStocks={initialStocks} />
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <UserDropdown user={user} initialStocks={initialStocks} />
        </div>
      </div>
    </header>
  );
};

export default Header;
