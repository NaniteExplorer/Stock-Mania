import type { LucideIcon } from "lucide-react";

/**
 * Interim page scaffolding.
 *
 * Phase 1 rebuilds the engines and deliberately changes no screen, so these
 * pages have a real shell and no data yet. Two rules keep that honest:
 *
 *  - a figure with no data renders an em-dash, never `₹0`. A zero is a claim
 *    about someone's money; an em-dash is an admission that we do not know yet.
 *  - every page states which phase brings its data, so the screen reads as
 *    deliberate rather than broken.
 *
 * Replaced by `src/ui/primitives.tsx` + real queries as each slice lands.
 */

export function PageHeader({
  title,
  subtitle,
  phase,
  action,
}: {
  title: string;
  subtitle: string;
  phase?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle max-w-2xl">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2">
        {phase && <span className="pill pill-brand">{phase}</span>}
        {action}
      </div>
    </div>
  );
}

/** A KPI tile whose value is not yet derivable. */
export function PendingStat({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="stat-tile">
      <p className="metric-label">{label}</p>
      <p className="tnum mt-2 text-2xl font-semibold text-gray-100" aria-label="no data yet">
        —
      </p>
      <p className="mt-1 text-xs text-gray-500">{hint}</p>
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
  );
}

/** The primary surface: a panel with an honest empty state. */
export function EmptyPanel({
  icon: Icon,
  title,
  body,
  columns,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  columns?: readonly string[];
}) {
  return (
    <section className="panel p-0">
      {columns && columns.length > 0 && (
        <div className="table-scroll border-b border-gray-600">
          <table className="w-full text-sm">
            <caption className="sr-only">{title}</caption>
            <thead>
              <tr>
                {columns.map((c, i) => (
                  <th
                    key={c}
                    scope="col"
                    className={`metric-label whitespace-nowrap px-4 py-3 ${
                      i === 0 ? "text-left" : "text-right"
                    }`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
      )}
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <span className="icon-chip mb-4 h-12 w-12">
          <Icon className="h-5 w-5" />
        </span>
        <p className="mb-2 text-lg font-semibold text-gray-100">{title}</p>
        <p className="max-w-md text-sm text-gray-500">{body}</p>
      </div>
    </section>
  );
}
