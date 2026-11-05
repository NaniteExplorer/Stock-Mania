import Link from "next/link";
import { Search } from "lucide-react";
import { Currency, Money } from "@/core/money";
import { groupLabel, kindLabel } from "@/domain/asset-groups";
import type { InstrumentKind } from "@/domain/instruments";
import type { InvestmentWorkspacePosition } from "@/app/investing.usecases";
import { formatMoney } from "@/ui/format";
import { InstitutionMark } from "@/ui/provider-picker";
import { Panel } from "../../../../components/ui/page-shell";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import { Input } from "../../../../components/ui/input";
import { NativeSelect } from "../../../../components/ui/native-select";
import { Banner } from "../../../../components/ui/banner";

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
    <Panel
      title="Holding records"
      description={`${rows.length} of ${positions.length} holding${positions.length === 1 ? "" : "s"} shown.`}
      actions={(query || status || kind) ? (
        <Link href="/investments/holdings" className="ghost-btn h-9 px-3 text-xs">
          Clear filters
        </Link>
      ) : undefined}
    >
      <form className="mb-3 grid gap-2 md:grid-cols-[minmax(16rem,1fr)_12rem_14rem_auto]" action="/investments/holdings">
        <label className="relative">
          <span className="sr-only">Search holdings</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--fg-muted)" aria-hidden />
          <Input
            name="q"
            type="search"
            defaultValue={query}
            className="pl-9"
            placeholder="Search symbol, name, platform or currency"
          />
        </label>
        <label>
          <span className="sr-only">Price status</span>
          <NativeSelect name="status" defaultValue={status}>
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </NativeSelect>
        </label>
        <label>
          <span className="sr-only">Investment type</span>
          <NativeSelect name="kind" defaultValue={kind}>
            <option value="">All investment types</option>
            {kinds.map((item) => (
              <option key={item.kind} value={item.kind}>{item.label}</option>
            ))}
          </NativeSelect>
        </label>
        <button type="submit" className="primary-btn h-10 px-4 text-xs">Apply</button>
      </form>

      {rows.length === 0 ? (
        <Banner title="No holdings match">
          <p>Adjust the search or filter. The underlying records are unchanged.</p>
        </Banner>
      ) : (
        <Table>
          <TableCaption className="sr-only">Investment holdings with units, value, realised and price status</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="text-left">Holding</TableHead>
              <TableHead className="text-left">Type</TableHead>
              <TableHead className="text-left">Platform</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Invested</TableHead>
              <TableHead className="text-right">Market value</TableHead>
              <TableHead className="text-right">Realised</TableHead>
              <TableHead className="text-left">Price state</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((position) => (
              <TableRow key={position.instrumentId}>
                <TableCell>
                  <Link href={`/investments/${position.instrumentId}`} className="font-medium text-(--fg) hover:text-brand-400">
                    {position.symbol}
                  </Link>
                  <p className="text-xs text-(--fg-muted)">{position.name}</p>
                </TableCell>
                <TableCell>
                  <span className="rounded-lg border border-(--border) px-2 py-1 text-xs text-(--fg-secondary)">
                    {kindLabel(position.kind, position.nativeCurrency)}
                  </span>
                  <p className="mt-1 text-xs text-(--fg-muted)">{groupLabel(position.assetFamily)}</p>
                </TableCell>
                <TableCell className="text-(--fg-secondary)">
                  {/* The holding's mark is its platform's (DESIGN.md §9, rule 5). */}
                  {position.platformName ? (
                    <span className="flex items-center gap-2">
                      <InstitutionMark institution={position.platformName} />
                      {position.platformName}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="tnum text-right text-(--fg-secondary)">{position.quantity}</TableCell>
                <TableCell className="text-right">{formatAmount(position.costBasis)}</TableCell>
                <TableCell className="text-right">{formatAmount(position.marketValue)}</TableCell>
                <TableCell className="text-right">{formatAmount(position.realisedGain)}</TableCell>
                <TableCell className="text-xs">
                  <PriceState position={position} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
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
      [position.symbol, position.name, position.platformName, position.nativeCurrency].some((value) =>
        value !== null &&
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
      <span className="text-(--warn)">
        Native price unavailable
        <span className="block text-(--fg-muted)">{position.unavailableReason ?? "No price resolved"}</span>
      </span>
    );
  }
  if (status === "REPORTING_CURRENCY_CONVERSION_UNAVAILABLE") {
    return (
      <span className="text-(--warn)">
        FX conversion unavailable
        <span className="block text-(--fg-muted)">
          Native {position.nativeCurrency} price observed{position.pricedOn ? ` on ${position.pricedOn}` : ""}.
        </span>
      </span>
    );
  }
  if (position.isStale) {
    return (
      <span className="text-(--warn)">
        Stale
        <span className="block text-(--fg-muted)">{position.pricedOn ?? "date unavailable"}</span>
      </span>
    );
  }
  return <span className="text-(--fg-muted)">{position.pricedOn ?? "priced"}</span>;
}

function marketValueStatus(
  position: InvestmentWorkspacePosition,
): NonNullable<InvestmentWorkspacePosition["marketValueStatus"]> {
  return position.marketValueStatus ?? (position.marketValue ? "AVAILABLE" : "NATIVE_PRICE_UNAVAILABLE");
}

function formatAmount(value: { amount: string; currency: string } | null) {
  if (!value) return <span className="tnum text-(--fg-muted)" aria-label="unavailable">-</span>;
  return (
    <span className="tnum text-(--fg)">
      {formatMoney(Money.fromRupees(value.amount, Currency.of(value.currency)))}
    </span>
  );
}

function uniqueKinds(positions: readonly InvestmentWorkspacePosition[]) {
  const rows = new Map<InstrumentKind, string>();
  for (const position of positions) rows.set(position.kind, kindLabel(position.kind, position.nativeCurrency));
  return [...rows.entries()].map(([kind, label]) => ({ kind, label })).sort((a, b) => a.label.localeCompare(b.label));
}
