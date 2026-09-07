import type { ReactNode } from "react";
import InvestmentNav from "./investment-nav";

export default function InvestmentsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <InvestmentNav />
      {children}
    </div>
  );
}
