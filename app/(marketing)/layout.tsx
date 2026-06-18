import * as React from "react";
import MarketingHeader from "@/components/landing/MarketingHeader";
import Footer from "@/components/landing/Footer";
import { getCurrentSession } from "@/lib/better-auth/auth";

const MarketingLayout = async ({ children }: { children: React.ReactNode }) => {
  const session = await getCurrentSession();
  const isAuthed = Boolean(session?.user);

  return (
    <div className="aurora-bg min-h-screen text-gray-300">
      <MarketingHeader isAuthed={isAuthed} />
      <main>{children}</main>
      <Footer />
    </div>
  );
};

export default MarketingLayout;
