import Link from "next/link";

export const HOLDING_VIEWS = [
  { id: "summary", label: "Summary" },
  { id: "performance", label: "Performance" },
  { id: "lots-tax", label: "Lots & tax" },
  { id: "activity", label: "Activity" },
  { id: "income-leases", label: "Income & leases" },
  { id: "settings", label: "Settings" },
] as const;

export type HoldingView = (typeof HOLDING_VIEWS)[number]["id"];
export type HoldingViewSearchParams = {
  view?: string | string[];
};

export function normalizeHoldingView(value: string | string[] | undefined): HoldingView {
  const candidate = Array.isArray(value) ? value[0] : value;
  return HOLDING_VIEWS.some((view) => view.id === candidate)
    ? (candidate as HoldingView)
    : "summary";
}

export default function HoldingNav({
  instrumentId,
  activeView,
}: {
  instrumentId: string;
  activeView: HoldingView;
}) {
  return (
    <nav className="mb-6" aria-label="Holding sections">
      <div className="flex flex-wrap gap-2">
        {HOLDING_VIEWS.map((view) => {
          const active = view.id === activeView;
          const href = view.id === "summary"
            ? `/investments/${instrumentId}`
            : `/investments/${instrumentId}?view=${view.id}`;

          return (
            <Link
              key={view.id}
              href={href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "focus-brand rounded-lg border border-brand-500/70 bg-brand-500/10 px-3 py-2 text-xs font-medium text-brand-200"
                  : "focus-brand rounded-lg border border-gray-600 px-3 py-2 text-xs font-medium text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-100"
              }
            >
              {view.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
