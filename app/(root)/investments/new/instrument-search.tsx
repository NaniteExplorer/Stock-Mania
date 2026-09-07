"use client";

import * as React from "react";
import { Check, Search } from "lucide-react";
import type { InvestmentSearchCandidate, InvestmentSearchResult } from "../catalog-actions";
import { searchInstrumentCatalogAction } from "../catalog-actions";

export interface ConfirmedInstrument {
  candidate: InvestmentSearchCandidate | null;
  query: string;
  mode: "CATALOG" | "MANUAL";
}

export default function InstrumentSearch({
  onConfirm,
}: {
  onConfirm: (selection: ConfirmedInstrument) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [result, setResult] = React.useState<InvestmentSearchResult | null>(null);
  const [staged, setStaged] = React.useState<InvestmentSearchCandidate | null>(null);
  const [highlighted, setHighlighted] = React.useState(0);
  const [pending, startTransition] = React.useTransition();
  const listboxId = "instrument-search-results";
  const candidates = result?.candidates ?? [];
  const open = candidates.length > 0;

  function submitSearch() {
    startTransition(async () => {
      const next = await searchInstrumentCatalogAction(query);
      setResult(next);
      setStaged(next.selected);
      setHighlighted(0);
      if (next.matchState === "MANUAL") onConfirm({ candidate: null, query, mode: "MANUAL" });
    });
  }

  function stage(candidate: InvestmentSearchCandidate) {
    setStaged(candidate);
  }

  function confirmManual() {
    setStaged(null);
    onConfirm({ candidate: null, query, mode: "MANUAL" });
  }

  function confirmStaged() {
    if (!staged) return;
    onConfirm({ candidate: staged, query, mode: "CATALOG" });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" aria-hidden />
          <input
            id="instrumentSearch"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && candidates.length > 0) {
                event.preventDefault();
                setHighlighted((current) => Math.min(current + 1, candidates.length - 1));
              } else if (event.key === "ArrowUp" && candidates.length > 0) {
                event.preventDefault();
                setHighlighted((current) => Math.max(current - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (candidates[highlighted]) stage(candidates[highlighted]);
                else submitSearch();
              } else if (event.key === "Escape") {
                setResult(null);
              }
            }}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={open ? `instrument-option-${highlighted}` : undefined}
            className="form-input pl-9"
            placeholder="Search by symbol, ISIN or name"
          />
        </div>
        <button type="button" className="ghost-btn h-10 px-4 text-xs" disabled={pending} onClick={submitSearch}>
          {pending ? "Searching..." : "Search"}
        </button>
      </div>

      {result && (
        <div className="rounded-lg border border-gray-600/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-gray-100">
              {result.matchState === "EXACT"
                ? "Exact symbol or ISIN match"
                : result.matchState === "CONFIRM"
                  ? "Choose the matching listing"
                  : "Manual entry"}
            </p>
            <p className="text-xs text-gray-500">
              Cache {result.cache.status.toLowerCase()}
              {result.cache.stale ? " · refresh due" : ""}
            </p>
          </div>

          {candidates.length > 0 && (
            <ul id={listboxId} role="listbox" className="mt-3 divide-y divide-gray-600/60 rounded-md border border-gray-600/70">
              {candidates.map((candidate, index) => (
                <li
                  key={`${candidate.catalogInstrumentId}-${candidate.listing.id}`}
                  id={`instrument-option-${index}`}
                  role="option"
                  aria-selected={staged?.listing.id === candidate.listing.id}
                  className={index === highlighted ? "bg-gray-700/50" : undefined}
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 p-3 text-left"
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => stage(candidate)}
                  >
                    <span>
                      <span className="block font-medium text-gray-100">{candidate.listing.symbol}</span>
                      <span className="block text-xs text-gray-500">
                        {candidate.name} · {candidate.listing.exchange} · {candidate.instrumentType}
                      </span>
                      {candidate.isin && <span className="block text-xs text-gray-600">{candidate.isin}</span>}
                    </span>
                    {staged?.listing.id === candidate.listing.id && <Check className="size-4 text-green-500" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {staged && (
            <div className="mt-3 rounded-md bg-gray-700/40 p-3">
              <p className="text-sm font-medium text-gray-100">{staged.listing.symbol} selected</p>
              <p className="text-xs text-gray-500">
                {staged.name} · {staged.listing.exchange} · {staged.listing.currency}
              </p>
              <button type="button" className="btn-glow mt-3 h-10 px-4 text-xs" onClick={confirmStaged}>
                Use this identity
              </button>
            </div>
          )}

          {result.manualEntryAllowed && (
            <button type="button" className="ghost-btn mt-3 h-10 px-4 text-xs" onClick={confirmManual}>
              Manual historical entry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
