import Link from "next/link";
import { Search } from "lucide-react";
import { Currency, Money } from "@/core/money";
import { groupLabel, groupOfKind, kindLabel } from "@/domain/asset-groups";
import type { InstrumentKind } from "@/domain/instruments";
import type { InvestmentWorkspacePosition } from "@/app/investing.usecases";
import { formatMoney } from "@/ui/format";

export type HoldingStatusFilter = "" | "priced" | "stale" | "unpriced" | "fx-unavailable";

const STATUS_OPTIONS: readonly { value: HoldingStatusFilter; label: string }[] = [
  { value: "", label: "All price states" },
  { value: "priced", label: "Priced" },
  { value: "stale", label: "Stale" },
  { value: "unpriced", label: "Unpriced" },
  { value: "fx-unavailable", label: "FX unavailable" },
];

export default function HoldingsTable({
  positions,
  query,
  status,
  kind,
}: {
  positions: readonly InvestmentWorkspacePosition[];
  query: string;
  status: HoldingStatusFilter;
  kind: string;
}) {
  const rows = filterHoldings(positions, { query, status, kind });
  const kinds = uniqueKinds(positions);

  return (
    <section className="panel p-0" aria-labelledby="holdings-table-title">
      <div className="border-b border-gray-600 px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="holdings-table-title" className="text-base font-semibold text-gray-100">Holding records</h2>
            <p className="mt-1 text-sm text-gray-500">
              {rows.length} of {positions.length} holding{positions.length === 1 ? "" : "s"} shown.
            </p>
          </div>
          {(query || status || kind) && (
            <Link href="/investments/holdings" className="ghost-btn h-9 px-3 text-xs">
              Clear filters
            </Link>
          )}
        </div>

        <form className="grid gap-2 md:grid-cols-[minmax(16rem,1fr)_12rem_14rem_auto]" action="/investments/holdings">
          <label className="relative">
            <span className="sr-only">Search holdings</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden />
            <input
              name="q"
              type="search"
              defaultValue={query}
              className="form-input h-10 w-full pl-9 text-xs"
              placeholder="Search symbol, name or currency"
            />
          </label>
          <label>
            <span className="sr-only">Price status</span>
            <select name="status" defaultValue={status} className="form-input h-10 w-full py-1 text-xs">
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Investment type</span>
            <select name="kind" defaultValue={kind} className="form-input h-10 w-full py-1 text-xs">
              <option value="">All investment types</option>
              {kinds.map((item) => (
                <option key={item.kind} value={item.kind}>{item.label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary-btn h-10 px-4 text-xs">Apply</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="icon-chip mb-4 h-12 w-12">
            <Search className="h-5 w-5" aria-hidden />
          </span>
          <p className="mb-2 text-lg font-semibold text-gray-100">No holdings match</p>
          <p className="max-w-md text-sm text-gray-500">
            Adjust the search or filter. The underlying records are unchanged.
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="w-full text-sm">
            <caption className="sr-only">Investment holdings with units, value, realised and price status</caption>
            <thead className="sticky top-0 z-10 bg-gray-800">
              <tr className="border-b border-gray-600">
                <th scope="col" className="metric-label px-4 py-3 text-left">Holding</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Type</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Units</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Invested</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Market value</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Realised</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Price state</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((position) => (
                <tr key={position.instrumentId} className="border-b border-gray-600/50 last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/investments/${position.instrumentId}`} className="font-medium text-gray-100 hover:text-brand-400">
                      {position.symbol}
                    </Link>
                    <p className="text-xs text-gray-500">{position.name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-lg border border-gray-600 px-2 py-1 text-xs text-gray-300">
                      {kindLabel(position.kind, position.nativeCurrency)}
                    </span>
                    <p className="mt-1 text-xs text-gray-500">{groupLabel(groupOfKind(position.kind))}</p>
                  </td>
                  <td className="tnum px-4 py-3 text-right text-gray-300">{position.quantity}</td>
                  <td className="px-4 py-3 text-right">{formatAmount(position.costBasis)}</td>
                  <td className="px-4 py-3 text-right">{formatAmount(position.marketValue)}</td>
                  <td className="px-4 py-3 text-right">{formatAmount(position.realisedGain)}</td>
                  <td className="px-4 py-3 text-xs">
                    <PriceState position={position} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function filterHoldings(
  positions: readonly InvestmentWorkspacePosition[],
  filters: { query: string; status: HoldingStatusFilter; kind: string },
): InvestmentWorkspacePosition[] {
  const query = filters.query.trim().toLowerCase();
  return positions.filter((position) => {
    const matchesQuery =
      query.length === 0 ||
      [position.symbol, position.name, position.nativeCurrency].some((value) =>
        value.toLowerCase().includes(query),
      );
    const matchesKind = !filters.kind || position.kind === filters.kind;
    const matchesStatus =
      filters.status === "" ||
      (filters.status === "priced" && position.marketValue !== null && !position.isStale) ||
      (filters.status === "stale" && position.isStale) ||
      (filters.status === "unpriced" && marketValueStatus(position) === "NATIVE_PRICE_UNAVAILABLE") ||
      (filters.status === "fx-unavailable" &&
        marketValueStatus(position) === "REPORTING_CURRENCY_CONVERSION_UNAVAILABLE");
    return matchesQuery && matchesKind && matchesStatus;
  });
}

function PriceState({ position }: { position: InvestmentWorkspacePosition }) {
  const status = marketValueStatus(position);
  if (status === "NATIVE_PRICE_UNAVAILABLE") {
    return (
      <span className="text-amber-500">
        Native price unavailable
        <span className="block text-gray-500">{position.unavailableReason ?? "No price resolved"}</span>
      </span>
    );
  }
  if (status === "REPORTING_CURRENCY_CONVERSION_UNAVAILABLE") {
    return (
      <span className="text-amber-500">
        FX conversion unavailable
        <span className="block text-gray-500">
          Native {position.nativeCurrency} price observed{position.pricedOn ? ` on ${position.pricedOn}` : ""}.
        </span>
      </span>
    );
  }
  if (position.isStale) {
    return (
      <span className="text-amber-500">
        Stale
        <span className="block text-gray-500">{position.pricedOn ?? "date unavailable"}</span>
      </span>
    );
  }
  return <span className="text-gray-500">{position.pricedOn ?? "priced"}</span>;
}

function marketValueStatus(
  position: InvestmentWorkspacePosition,
): NonNullable<InvestmentWorkspacePosition["marketValueStatus"]> {
  return position.marketValueStatus ?? (position.marketValue ? "AVAILABLE" : "NATIVE_PRICE_UNAVAILABLE");
}

function formatAmount(value: { amount: string; currency: string } | null) {
  if (!value) return <span className="tnum text-gray-500" aria-label="unavailable">-</span>;
  return (
    <span className="tnum text-gray-200">
      {formatMoney(Money.fromRupees(value.amount, Currency.of(value.currency)))}
    </span>
  );
}

function uniqueKinds(positions: readonly InvestmentWorkspacePosition[]) {
  const rows = new Map<InstrumentKind, string>();
  for (const position of positions) rows.set(position.kind, kindLabel(position.kind, position.nativeCurrency));
  return [...rows.entries()].map(([kind, label]) => ({ kind, label })).sort((a, b) => a.label.localeCompare(b.label));
}
