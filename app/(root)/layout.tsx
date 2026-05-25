import * as React from "react";
import Header from "@/components/Header";
import { auth } from "@/lib/better-auth/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { User } from "better-auth";

const Layout = async ({ children }: { children: React.ReactNode }) => {
  const authInstance = await auth();
  const session = await authInstance.api.getSession({
    headers: await headers(),
  });

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
