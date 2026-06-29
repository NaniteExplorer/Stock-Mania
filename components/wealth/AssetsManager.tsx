"use client";

import { Gem } from "lucide-react";
import WealthManager, { type WealthField } from "@/components/wealth/WealthManager";
import { createAsset, updateAsset, deleteAsset } from "@/features/assets/asset.actions";
import {
  ASSET_CATEGORY_LABELS,
  type Asset,
  type AssetCategory,
} from "@/features/assets/asset.types";
import { formatINRCompact } from "@/lib/utils";

const fields: WealthField[] = [
  { name: "name", label: "Name", type: "text", required: true, placeholder: "2BHK Apartment", half: true },
  {
    name: "category",
    label: "Category",
    type: "select",
    half: true,
    options: Object.entries(ASSET_CATEGORY_LABELS).map(([value, label]) => ({ value, label })),
  },
  { name: "value", label: "Current value", type: "number", prefix: "₹", step: "0.01", required: true },
  { name: "note", label: "Note", type: "text", placeholder: "Optional details" },
];

export default function AssetsManager({ items }: { items: Asset[] }) {
  return (
    <WealthManager<Asset>
      items={items}
      fields={fields}
      addLabel="Add asset"
      dialogTitle="asset"
      emptyTitle="No assets yet"
      emptyDescription="Add property, gold, vehicles, EPF/PPF/NPS and anything else you own."
      toValues={(a) => ({
        name: a.name,
        category: a.category,
        value: String(a.value),
        note: a.note ?? "",
      })}
      onCreate={(v) =>
        createAsset({
          name: v.name,
          category: v.category as AssetCategory,
          value: Number(v.value) || 0,
          note: v.note || null,
        })
      }
      onUpdate={(id, v) =>
        updateAsset(id, {
          name: v.name,
          category: v.category as AssetCategory,
          value: Number(v.value) || 0,
          note: v.note || null,
        })
      }
      onDelete={deleteAsset}
      renderRow={(a) => (
        <div className="flex items-center gap-3">
          <span className="icon-chip">
            <Gem className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-100">{a.name}</p>
            <p className="truncate text-xs text-gray-500">
              {ASSET_CATEGORY_LABELS[a.category]}
              {a.note ? ` · ${a.note}` : ""}
            </p>
          </div>
          <p className="ml-auto pr-2 text-sm font-bold text-gray-100 tnum">
            {formatINRCompact(a.value)}
          </p>
        </div>
      )}
    />
  );
}
