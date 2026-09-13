"use client";

/**
 * The instrument combobox, searching as you type.
 *
 * What changed and what deliberately did not: the search now fires on a debounce
 * rather than only on the button, but the combobox roles, `aria-activedescendant`
 * wiring, the arrow/enter/escape handling and — above all — the **explicit
 * confirm step** are the same. Staging is not selecting. A holding's identity is
 * the one decision on this page that is expensive to get wrong, so it still costs
 * a deliberate click, and as-you-type only makes the candidate easier to find.
 *
 * Two things as-you-type adds that a button press does not need:
 *
 *  - **A sequence guard.** Responses to "REL", "RELI" and "RELIA" can land in any
 *    order. Each request carries a ticket and only the newest one is allowed to
 *    write state, so a slow early keystroke cannot overwrite a fast later one.
 *  - **A visible error state.** A button press that fails is attributable; a
 *    background request that fails silently just looks like "no results", which
 *    is the same picture as a correct empty answer and a completely different
 *    fact.
 *
 * Priceability (C10) is shown here and enforced in `catalog-actions.ts`. Both
 * sides call `addableReference`, so a candidate the list greys out is the same
 * candidate the server refuses.
 */

import * as React from "react";
import { Check, Search, TriangleAlert } from "lucide-react";
import type { InvestmentSearchCandidate, InvestmentSearchResult } from "../catalog-actions";
import { searchInstrumentCatalogAction } from "../catalog-actions";
import { addableReference } from "../entry-identity";

export interface ConfirmedInstrument {
  candidate: InvestmentSearchCandidate | null;
  query: string;
  mode: "CATALOG" | "MANUAL";
}

/**
 * Long enough that a fast typist sends one request rather than eight, short
 * enough that the list feels attached to the keyboard.
 */
const DEBOUNCE_MS = 250;

/** Below this a catalogue query matches thousands of rows and ranks none. */
const MIN_QUERY = 2;

export default function InstrumentSearch({
  onConfirm,
}: {
  onConfirm: (selection: ConfirmedInstrument) => void;
}) {
  const [query, setQuery] = React.useState("");
  const [rawResult, setResult] = React.useState<InvestmentSearchResult | null>(null);
  const [staged, setStaged] = React.useState<InvestmentSearchCandidate | null>(null);
  const [highlighted, setHighlighted] = React.useState(0);
  const [rawPending, setPending] = React.useState(false);
  const [rawFailure, setFailure] = React.useState<string | null>(null);
  const listboxId = "instrument-search-results";
  /*
   * Whether the query is long enough to be searching at all, derived rather than
   * stored. Clearing the list in an effect would be a setState during render
   * commit — a cascading render for something the render already knows.
   */
  const active = query.trim().length >= MIN_QUERY;
  const result = active ? rawResult : null;
  const failure = active ? rawFailure : null;
  const pending = active && rawPending;
  const candidates = result?.candidates ?? [];
  const open = candidates.length > 0;
  const stagedReference = staged ? addableReference(staged) : null;

  /* The ticket of the newest request; anything older is discarded on arrival. */
  const ticket = React.useRef(0);

  const runSearch = React.useCallback(async (term: string, explicit: boolean) => {
    const mine = (ticket.current += 1);
    setPending(true);
    try {
      const next = await searchInstrumentCatalogAction(term);
      if (ticket.current !== mine) return;
      setFailure(null);
      setResult(next);
      setStaged(next.selected);
      setHighlighted(0);
      /*
       * Only an explicit submit may flip the form into manual mode. On a
       * debounce it would fire at every prefix that happens to match nothing —
       * "REL" on the way to "RELIANCE" — and swap the identity fields out from
       * under the cursor.
       */
      if (explicit && next.matchState === "MANUAL") {
        onConfirm({ candidate: null, query: term, mode: "MANUAL" });
      }
    } catch {
      if (ticket.current !== mine) return;
      /*
       * The message is deliberately generic. Whatever went wrong upstream, the
       * only two things the user can do are retry and fall back to manual entry,
       * and a provider's exception text is not a sentence he can act on.
       */
      setFailure("The catalogue search could not be reached. Try again, or record the identity manually.");
      setResult(null);
    } finally {
      if (ticket.current === mine) setPending(false);
    }
  }, [onConfirm]);

  function submitSearch() {
    if (query.trim().length < MIN_QUERY) return;
    void runSearch(query.trim(), true);
  }

  /*
   * As-you-type. A query that shrinks below the floor only invalidates whatever
   * is in flight — a ref write, not state — because the render derives an empty
   * list from `active` anyway.
   */
  React.useEffect(() => {
    const term = query.trim();
    if (term.length < MIN_QUERY) {
      ticket.current += 1;
      return;
    }
    const timer = setTimeout(() => void runSearch(term, false), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  /*
   * The server probes the shown rows in `after()`, so a first search for a row
   * nobody has swept yet answers "checking". One re-read a couple of seconds
   * later is what turns that into an addable row without the user retyping. It
   * runs once per result set — `checking` goes false on the re-read whatever the
   * verdict was, so this cannot become a poll.
   */
  const checking = candidates.some((candidate) => !candidate.quoteChecked);
  const rechecked = React.useRef("");
  React.useEffect(() => {
    const term = query.trim();
    if (!checking || !active || rechecked.current === term) return;
    const timer = setTimeout(() => {
      rechecked.current = term;
      void runSearch(term, false);
    }, 2_500);
    return () => clearTimeout(timer);
  }, [checking, active, query, runSearch]);

  function stage(candidate: InvestmentSearchCandidate) {
    setStaged(candidate);
  }

  function confirmManual() {
    setStaged(null);
    onConfirm({ candidate: null, query, mode: "MANUAL" });
  }

  function confirmStaged() {
    if (!staged || !stagedReference?.ok) return;
    onConfirm({ candidate: staged, query, mode: "CATALOG" });
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-500" aria-hidden />
          <input
            id="instrumentSearch"
            aria-label="Search the instrument catalogue"
            aria-describedby="instrument-search-hint"
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
            autoComplete="off"
            /* `form-input` carries its own `px-3.5`, which ties on specificity
               with a plain `pl-9` and wins on order — the magnifier then sits on
               top of the first character. The important flag settles it. */
            className="form-input w-full !pl-9 !pr-10"
            placeholder="NSE ticker, AMFI scheme code, ISIN or US ticker"
          />
          {/* The spinner is a static ring under reduced motion: `motion-safe`
              leaves it still for anyone who asked for less movement. */}
          {pending && (
            <span
              aria-hidden
              className="absolute right-3 top-1/2 size-4 -translate-y-1/2 rounded-full border-2 border-gray-600 border-t-brand-400 motion-safe:animate-spin"
            />
          )}
        </div>
        <button type="button" className="ghost-btn h-10 px-4 text-xs" disabled={pending} onClick={submitSearch}>
          {pending ? "Searching..." : "Search"}
        </button>
      </div>

      <p id="instrument-search-hint" className="text-xs text-gray-500">
        Results appear as you type, from {MIN_QUERY} characters. Search covers Indian exchange listings, AMFI mutual
        funds and SEC-listed US companies. Names and ambiguous matches always need your confirmation, and a listing no
        price source has accepted cannot be added.
      </p>

      <p className="sr-only" role="status" aria-live="polite">
        {pending
          ? "Searching the local instrument catalogue."
          : failure
            ? failure
            : result
              ? `${candidates.length} matching listing${candidates.length === 1 ? "" : "s"}.` +
                (checking ? " Checking price sources." : "")
              : ""}
      </p>

      {failure && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-500/[0.06] p-3">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm text-red-300">{failure}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className="ghost-btn h-9 px-3 text-xs" onClick={submitSearch}>
                Retry
              </button>
              <button type="button" className="ghost-btn h-9 px-3 text-xs" onClick={confirmManual}>
                Manual historical entry
              </button>
            </div>
          </div>
        </div>
      )}

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

          {candidates.length === 0 && !pending && (
            <p className="mt-3 rounded-md border border-gray-600/70 p-3 text-sm text-gray-500">
              Nothing in the catalogue matches “{query.trim()}”. Try the exchange ticker or the ISIN, or record the
              identity manually below.
            </p>
          )}

          {candidates.length > 0 && (
            <ul id={listboxId} role="listbox" className="mt-3 divide-y divide-gray-600/60 rounded-md border border-gray-600/70">
              {candidates.map((candidate, index) => {
                const reference = addableReference(candidate);
                return (
                  <li
                    key={`${candidate.catalogInstrumentId}-${candidate.listing.id}`}
                    id={`instrument-option-${index}`}
                    role="option"
                    aria-selected={staged?.listing.id === candidate.listing.id}
                    aria-disabled={!reference.ok}
                    className={index === highlighted ? "bg-gray-700/50" : undefined}
                  >
                    <button
                      type="button"
                      disabled={!reference.ok}
                      className="flex w-full items-center justify-between gap-3 p-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
                      onMouseEnter={() => setHighlighted(index)}
                      onClick={() => stage(candidate)}
                    >
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className={reference.ok ? "font-medium text-gray-100" : "font-medium text-gray-400 line-through"}>
                            {candidate.listing.symbol}
                          </span>
                          {/* Exchange and currency on every row, never only on
                              the staged one: RELIANCE on NSE and RELIANCE on BSE
                              are two rows that otherwise read identically. */}
                          <span className="rounded border border-gray-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                            {candidate.listing.exchange}
                          </span>
                          <span className="rounded border border-gray-600 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-400">
                            {candidate.listing.currency}
                          </span>
                          {!reference.ok && (
                            /* "Nobody has asked yet" and "we asked and no source
                               would price it" are different facts. Rendering the
                               queue as a refusal is what makes a perfectly
                               addable stock look permanently unaddable. */
                            <span className="rounded border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                              {candidate.quoteChecked ? "Not priceable" : "Checking price source"}
                            </span>
                          )}
                          {candidate.quoteStale && (
                            <span className="rounded border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                              Quote stale
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-xs text-gray-500">
                          {candidate.name} · {candidate.instrumentType}
                          {candidate.firstTradeDate ? ` · from ${candidate.firstTradeDate}` : ""}
                        </span>
                        {candidate.isin && <span className="block text-xs text-gray-600">{candidate.isin}</span>}
                        {!reference.ok && <span className="mt-1 block text-xs text-amber-400/90">{reference.reason}</span>}
                      </span>
                      {staged?.listing.id === candidate.listing.id && reference.ok && (
                        <Check className="size-4 shrink-0 text-green-500" aria-hidden />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {staged && (
            <div className="mt-3 rounded-md bg-gray-700/40 p-3">
              <p className="text-sm font-medium text-gray-100">{staged.listing.symbol} selected</p>
              <p className="text-xs text-gray-500">
                {staged.name} · {staged.listing.exchange} · {staged.listing.currency}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {stagedReference?.ok
                  ? `Quote reference: ${stagedReference.quoteRef}. This reference never fills the execution price.`
                  : (stagedReference?.reason ?? "")}
              </p>
              <button
                type="button"
                className="btn-glow mt-3 h-10 px-4 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!stagedReference?.ok}
                onClick={confirmStaged}
              >
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
