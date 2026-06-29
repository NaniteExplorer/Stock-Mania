import type { Metadata } from "next";
import { getMyLiabilities } from "@/features/liabilities/liability.actions";
import LiabilitiesManager from "@/components/wealth/LiabilitiesManager";
import { formatINR } from "@/lib/utils";
import { CreditCard } from "lucide-react";

export const metadata: Metadata = { title: "Liabilities" };

export default async function LiabilitiesPage() {
  const liabilities = await getMyLiabilities();
  const total = liabilities.reduce((s, l) => s + l.outstanding, 0);
  const monthlyEmi = liabilities.reduce((s, l) => s + (l.emi ?? 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Liabilities</h1>
        <p className="page-subtitle">Loans &amp; credit cards — subtracted from your net worth.</p>
      </div>

      <div className="networth-hero">
        <div className="flex flex-wrap items-center gap-3">
          <span className="icon-chip h-11 w-11">
            <CreditCard className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-gray-500">Total owed</p>
            <p className="text-3xl font-bold tracking-tight text-red-500 tnum">
              {formatINR(total)}
            </p>
          </div>
          <span className="pill ml-auto">{liabilities.length} liabilities</span>
        </div>
        {monthlyEmi > 0 && (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="stat-tile">
              <p className="text-xs text-gray-500">Total monthly EMI</p>
              <p className="mt-1 text-lg font-bold text-gray-100 tnum">{formatINR(monthlyEmi)}</p>
            </div>
            <div className="stat-tile">
              <p className="text-xs text-gray-500">Liabilities</p>
              <p className="mt-1 text-lg font-bold text-gray-100 tnum">{liabilities.length}</p>
            </div>
          </div>
        )}
      </div>

      <LiabilitiesManager items={liabilities} />
    </div>
  );
}
