import * as React from "react";
import Header from "@/components/Header";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { redirect } from "next/navigation";
import { User } from "better-auth";
import { connection } from "next/server";

const Layout = async ({ children }: { children: React.ReactNode }) => {
  await connection();

  const session = await getCurrentSession();

  if (!session?.user) redirect("/sign-in");
  const user = session.user as User;
  return (
    <main className="min-h-screen text-grey-400">
      <Header user={user} />
      <div className="container py-10">{children}</div>
    </main>
  );
};

export default Layout;
