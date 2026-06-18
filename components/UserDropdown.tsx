"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LogOut, Menu, Settings, ShieldCheck, UserRound } from "lucide-react";
import NavItems from "@/components/NavItems";
import { User } from "better-auth";
import { signOut } from "@/lib/actions/auth.actions";

const UserDropdown = ({
  user,
  initialStocks,
}: {
  user: User;
  initialStocks: StockWithWatchlistStatus[];
}) => {
  const router = useRouter();

  const handleSignOut = async () => {
    await signOut();
    router.push("/sign-in");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex h-10 items-center gap-3 rounded-md border border-gray-600 bg-gray-800 px-2 text-gray-400 hover:border-yellow-500/50 hover:bg-gray-700 hover:text-yellow-400"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage
              src={
                "https://avatars.githubusercontent.com/u/153423955?s=280&v=4"
              }
            />
            <AvatarFallback className="bg-yellow-500 text-yellow-900 text-sm font-bold">
              {user.name?.[0] ?? "U"}
            </AvatarFallback>
          </Avatar>
          <div className="hidden flex-col items-start md:flex">
            <span className="max-w-28 truncate text-sm font-semibold text-gray-100">
              {user.name}
            </span>
            <span className="text-[11px] text-gray-500">Investor</span>
          </div>
          <Menu className="h-4 w-4 lg:hidden" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-72 border-gray-600 bg-gray-800 p-2 text-gray-400 shadow-2xl">
        <DropdownMenuLabel>
          <div className="relative flex items-center gap-3 rounded-md bg-gray-900/60 p-3">
            <Avatar className="h-10 w-10">
              <AvatarImage
                src={
                  "https://avatars.githubusercontent.com/u/153423955?s=280&v=4"
                }
              />
              <AvatarFallback className="bg-yellow-500 text-yellow-900 text-sm font-bold">
                {user.name?.[0] ?? "U"}
              </AvatarFallback>
            </Avatar>
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-gray-100">
                {user.name}
              </span>
              <span className="truncate text-xs text-gray-500">{user.email}</span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-gray-600" />
        <DropdownMenuItem className="text-sm font-medium text-gray-300 focus:bg-gray-700 focus:text-yellow-400">
          <UserRound className="mr-2 h-4 w-4" />
          Account overview
        </DropdownMenuItem>
        <DropdownMenuItem className="text-sm font-medium text-gray-300 focus:bg-gray-700 focus:text-yellow-400">
          <ShieldCheck className="mr-2 h-4 w-4" />
          Security center
        </DropdownMenuItem>
        <DropdownMenuItem className="text-sm font-medium text-gray-300 focus:bg-gray-700 focus:text-yellow-400">
          <Settings className="mr-2 h-4 w-4" />
          Preferences
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-gray-600" />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="cursor-pointer text-sm font-medium text-gray-100 transition-colors focus:bg-red-500/10 focus:text-red-400"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-gray-600 lg:hidden" />
        <nav className="lg:hidden">
          <NavItems initialStocks={initialStocks} />
        </nav>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserDropdown;
