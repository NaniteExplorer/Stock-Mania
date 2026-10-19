import Link from "next/link";

/**
 * Which kind of investment is being added, chosen before anything is typed.
 *
 * One form for everything was the wrong shape. A share is found by ticker; a
 * gram of vaulted gold has no ticker to find, so the single combobox at the top
 * of the page made digital metals look unsupported — and they were, because the
 * manual fallback deliberately stores no quote key and would have left the gold
 * unpriced forever.
 *
 * The lanes are the asset categories the portfolio already groups by
 * (`src/domain/asset-groups.ts`), so what the user picks here is the same
 * partition they will see the holding under afterwards. Platform stays a
 * per-holding field inside every lane rather than a lane of its own: the same
 * metal at two vaults, or the same share at two brokers, is two holdings with
 * two cost bases, and it is the category — not the platform — that joins them
 * back together in the portfolio views.
 *
 * Routed rather than client state, matching `holding-nav.tsx`: the lane is
 * linkable (the gold pages point straight at `?lane=metal`), and switching lanes
 * should discard a half-typed entry for a different asset family anyway.
 */
export const ENTRY_LANES = [
  {
    id: "market",
    label: "Stocks, ETFs & funds",
    hint: "Search the local catalogue by ticker, ISIN or scheme code, then record the contract note.",
  },
  {
    id: "metal",
    label: "Digital gold & metals",
    hint: "Grams in a vault or wallet. No ticker to search — choose the metal, its purity and the platform.",
  },
  {
    id: "manual",
    label: "Manual / unlisted",
    hint: "Holdings the catalogue genuinely cannot identify. Not live-priced: the value stays whatever you record.",
  },
] as const;

export type EntryLane = (typeof ENTRY_LANES)[number]["id"];
export type EntryLaneSearchParams = { lane?: string | string[] };

export function normalizeEntryLane(value: string | string[] | undefined): EntryLane {
  const candidate = Array.isArray(value) ? value[0] : value;
  return ENTRY_LANES.some((lane) => lane.id === candidate) ? (candidate as EntryLane) : "market";
}

export function entryLane(id: EntryLane): (typeof ENTRY_LANES)[number] {
  return ENTRY_LANES.find((lane) => lane.id === id) ?? ENTRY_LANES[0];
}

export default function EntryLaneNav({ activeLane }: { activeLane: EntryLane }) {
  return (
    <nav className="mb-6" aria-label="Investment type">
      <div className="flex flex-wrap gap-2">
        {ENTRY_LANES.map((lane) => {
          const active = lane.id === activeLane;
          const href = lane.id === "market" ? "/investments/new" : `/investments/new?lane=${lane.id}`;

          return (
            <Link
              key={lane.id}
              href={href}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "focus-brand inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-brand-500 bg-brand-500/10 px-3 text-sm font-medium text-gray-100"
                  : "focus-brand inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-gray-600 px-3 text-sm text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-100"
              }
            >
              {lane.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
