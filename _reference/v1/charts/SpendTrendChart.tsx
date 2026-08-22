import type { SpendTrendMonth } from "@/features/transactions/transaction.service";
import { formatINRCompact } from "@/lib/utils";

/**
 * Monthly total-spend bars — one measure (spend), one hue (--chart-1). Bars have
 * rounded tops anchored to the baseline, a recessive baseline, and each bar is
 * directly labeled with its month and amount. No legend (single series).
 */
export default function SpendTrendChart({ months }: { months: SpendTrendMonth[] }) {
  if (months.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-500">No spending in this window yet.</p>;
  }
  const max = Math.max(1, ...months.map((m) => m.total));

  return (
    <div className="table-scroll">
      <div className="flex items-end gap-3" style={{ minHeight: 160 }}>
      {months.map((m) => {
        const heightPct = (m.total / max) * 100;
        return (
          <div key={m.periodKey} className="flex min-w-[48px] flex-1 flex-col items-center gap-2">
            <span className="text-[11px] font-semibold text-gray-300 tnum">{formatINRCompact(m.total)}</span>
            <div className="flex w-full items-end justify-center" style={{ height: 110 }}>
              <div
                className="w-full max-w-[44px] rounded-t"
                style={{ height: `${Math.max(2, heightPct)}%`, background: "var(--chart-1)" }}
                title={`${m.periodKey}: ${formatINRCompact(m.total)}`}
              />
            </div>
            <span className="text-[11px] text-gray-500">{m.periodKey.slice(2)}</span>
          </div>
        );
      })}
      </div>
    </div>
  );
}
