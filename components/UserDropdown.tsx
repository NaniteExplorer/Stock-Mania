"use client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { LogOut, Settings, ShieldCheck, UserRound } from "lucide-react";
import { User } from "better-auth";
import { signOut } from "@/lib/actions/auth.actions";

const UserDropdown = ({ user }: { user: User }) => {
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
          className="flex h-10 items-center gap-2.5 rounded-xl border border-gray-600 bg-gray-800 px-1.5 pr-2 text-gray-400 hover:border-yellow-500/50 hover:bg-gray-700 hover:text-yellow-400 sm:px-2"
        >
          <Avatar className="h-7 w-7">
            <AvatarImage
              src={
                "https://avatars.githubusercontent.com/u/153423955?s=280&v=4"
              }
            />
            <AvatarFallback className="bg-yellow-500 text-sm font-bold text-white">
              {user.name?.[0] ?? "U"}
            </AvatarFallback>
          </Avatar>
          <div className="hidden flex-col items-start md:flex">
            <span className="max-w-28 truncate text-sm font-semibold text-gray-100">
              {user.name}
            </span>
            <span className="text-[11px] text-gray-500">Investor</span>
          </div>
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
              <AvatarFallback className="bg-yellow-500 text-sm font-bold text-white">
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
        <DropdownMenuItem asChild className="text-sm font-medium text-gray-300 focus:bg-gray-700 focus:text-yellow-400">
          <Link href="/dashboard">
            <UserRound className="mr-2 h-4 w-4" />
            Net worth overview
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="text-sm font-medium text-gray-300 focus:bg-gray-700 focus:text-yellow-400">
          <Link href="/settings">
            <ShieldCheck className="mr-2 h-4 w-4" />
            Security &amp; brokers
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="text-sm font-medium text-gray-300 focus:bg-gray-700 focus:text-yellow-400">
          <Link href="/settings">
            <Settings className="mr-2 h-4 w-4" />
            Preferences
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-gray-600" />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="cursor-pointer text-sm font-medium text-gray-100 transition-colors focus:bg-red-500/10 focus:text-red-400"
        >
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default UserDropdown;
