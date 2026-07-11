import * as React from "react";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";
import {
  getCurrentSession,
  AuthUnavailableError,
} from "@/lib/better-auth/auth";
import { getNetWorthSummary } from "@/features/networth/networth.actions";
import { redirect } from "next/navigation";
import { User } from "better-auth";
import { connection } from "next/server";
import ServiceUnavailable from "@/components/ServiceUnavailable";

const Layout = async ({ children }: { children: React.ReactNode }) => {
  await connection();

  let session;
  try {
    session = await getCurrentSession();
  } catch (error) {
    // DB outage — show a proper status screen instead of pretending the
    // user is logged out (redirecting to /sign-in would fail there too).
    if (error instanceof AuthUnavailableError) return <ServiceUnavailable />;
    throw error;
  }

  if (!session?.user) redirect("/sign-in");
  const user = session.user as User;

  const summary = await getNetWorthSummary();

  return (
    <div className="flex min-h-screen text-gray-400">
      <Sidebar summary={summary} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} />
        <main className="flex-1 px-4 pb-24 pt-6 md:px-6 md:pb-10 lg:px-8 lg:pb-12">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
      <MobileNav />
    </div>
  );
};

export default Layout;
