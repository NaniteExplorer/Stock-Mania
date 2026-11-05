import * as React from "react";
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import MobileNav from "@/components/MobileNav";
import { getCurrentSession, AuthUnavailableError } from "@/infra/auth/session";
import { redirect } from "next/navigation";
import { User } from "better-auth";
import { connection } from "next/server";
import ServiceUnavailable from "@/components/ServiceUnavailable";
import { CalendarDate } from "@/core/time";
import { currentUserId, services } from "@/infra/container";
import { debtHeaderFigures, type DebtHeaderFigures } from "@/ui/debt-header";

/** §9c Debt header: from the existing card and loan usecases; any failure hides it. */
async function loadDebtHeader(): Promise<DebtHeaderFigures | null> {
  try {
    const userId = await currentUserId();
    const asOf = CalendarDate.parse(new Date().toISOString().slice(0, 10));
    const [cards, loans] = await Promise.all([
      services().cards.list.execute({ userId, asOf }),
      services().lending.listLoans.execute({ userId, asOf }),
    ]);
    return debtHeaderFigures(
      cards.ok ? cards.value.cards.map((summary) => summary.owed) : null,
      loans.ok ? loans.value.loans.map((summary) => summary.bookedOutstanding) : null,
      loans.ok
        ? loans.value.loans.map((summary) => ({
            outstanding: summary.bookedOutstanding,
            annualRate: summary.loan.terms.annualRate.percent,
            instalment: summary.instalment,
          }))
        : null,
    );
  } catch {
    return null;
  }
}

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
  const debt = await loadDebtHeader();

  return (
    <div className="flex min-h-screen text-gray-400">
      <Sidebar debt={debt} />
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
