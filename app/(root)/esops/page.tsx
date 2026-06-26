import type { Metadata } from "next";
import { getMyEsops } from "@/features/esops/esop.actions";
import EsopsManager from "@/components/wealth/EsopsManager";
import { formatINR } from "@/lib/utils";
import { Building2 } from "lucide-react";

export const metadata: Metadata = { title: "ESOPs" };

export default async function EsopsPage() {
  const grants = await getMyEsops();
  const vestedValue = grants.reduce((s, g) => s + g.vestedValue, 0);
  const totalValue = grants.reduce((s, g) => s + g.totalValue, 0);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">ESOPs</h1>
        <p className="page-subtitle">In-the-money value of your equity grants.</p>
      </div>

      <div className="networth-hero">
        <div className="flex flex-wrap items-center gap-3">
          <span className="icon-chip h-11 w-11">
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-gray-500">Vested value</p>
            <p className="text-3xl font-bold tracking-tight text-gray-100 tnum">
              {formatINR(vestedValue)}
            </p>
          </div>
          <span className="pill ml-auto">{grants.length} grants</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="stat-tile">
            <p className="text-xs text-gray-500">Total grant value (if fully vested)</p>
            <p className="mt-1 text-lg font-bold text-gray-100 tnum">{formatINR(totalValue)}</p>
          </div>
          <div className="stat-tile">
            <p className="text-xs text-gray-500">Counted in net worth</p>
            <p className="mt-1 text-lg font-bold text-gray-100 tnum">{formatINR(vestedValue)}</p>
          </div>
        </div>
      </div>

      <EsopsManager items={grants} />
    </div>
  );
}
