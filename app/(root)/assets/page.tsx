import type { Metadata } from "next";
import { getMyAssets } from "@/features/assets/asset.actions";
import AssetsManager from "@/components/wealth/AssetsManager";
import { ASSET_CATEGORY_LABELS } from "@/features/assets/asset.types";
import { formatINR, formatINRCompact } from "@/lib/utils";
import { Gem } from "lucide-react";

export const metadata: Metadata = { title: "Assets" };

export default async function AssetsPage() {
  const assets = await getMyAssets();
  const total = assets.reduce((s, a) => s + a.value, 0);

  const byCategory = assets.reduce<Record<string, number>>((acc, a) => {
    acc[a.category] = (acc[a.category] ?? 0) + a.value;
    return acc;
  }, {});
  const topCategories = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Assets</h1>
        <p className="page-subtitle">Property, gold, vehicles, EPF/PPF/NPS &amp; more.</p>
      </div>

      <div className="networth-hero">
        <div className="flex flex-wrap items-center gap-3">
          <span className="icon-chip h-11 w-11">
            <Gem className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-gray-500">Total assets</p>
            <p className="text-3xl font-bold tracking-tight text-gray-100 tnum">
              {formatINR(total)}
            </p>
          </div>
          <span className="pill ml-auto">{assets.length} assets</span>
        </div>
        {topCategories.length > 0 && (
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {topCategories.map(([cat, val]) => (
              <div key={cat} className="stat-tile">
                <p className="text-xs text-gray-500">{ASSET_CATEGORY_LABELS[cat as keyof typeof ASSET_CATEGORY_LABELS]}</p>
                <p className="mt-1 text-lg font-bold text-gray-100 tnum">{formatINRCompact(val)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <AssetsManager items={assets} />
    </div>
  );
}
