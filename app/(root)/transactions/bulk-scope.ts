/**
 * Pure helpers for filter-scoped bulk removal (tasks 2.5 / 2.6, DESIGN §7.1).
 *
 * No I/O, no React, no domain classes: the scope is plain data so the page, the
 * server action and the confirmation dialog all agree on it, and the spec can
 * exercise every rule without a database.
 */

/** The register's filter, as it travels in the URL and in the confirm form. */
export interface RegisterFilter {
  accountId?: string;
  from?: string;
  to?: string;
  q?: string;
  kind?: string;
  /**
   * Transaction ids taken out of the scope by *Filter them out* (DESIGN §7.1). Never makes
   * an unfiltered table filtered: it narrows a scope the owner already chose.
   */
  exclude?: string[];
}

/** A field the owner typed that is not usable, with the sentence to show beside it. */
export type FilterErrors = Partial<Record<keyof RegisterFilter, string>>;

export interface FilterChip {
  key: keyof RegisterFilter;
  label: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const FILTER_KINDS = [
  "WITHDRAWAL", "DEPOSIT", "TRANSFER", "OPENING_BALANCE", "RECONCILIATION", "CHARGE", "REVERSAL",
] as const;

/** Largest scope one confirmation may remove; beyond it the user narrows first. */
export const MAX_BULK_ROWS = 5000;

/** Most rows *Filter them out* carries in the URL; beyond it the owner narrows instead. */
export const MAX_EXCLUDED = 50;

function clean(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * True for a real calendar date in `YYYY-MM-DD`. The shape alone is not enough:
 * `2026-02-30` matches it and then throws deep inside `CalendarDate`, which used to
 * take the page and the confirm action down with it (QA FAIL, 2026-11-03).
 */
export function isCalendarDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= days;
}

const DATE_FIELDS = { from: "From", to: "To" } as const;

/**
 * Reads a filter from search params or form fields. Malformed keys are dropped, and a
 * key the owner did type but that cannot be used (an impossible date, a bad exclusion)
 * is reported in `errors`, so the caller refuses rather than quietly widening the scope.
 */
export function parseFilterResult(input: Record<string, unknown>): { filter: RegisterFilter; errors: FilterErrors } {
  const filter: RegisterFilter = {};
  const errors: FilterErrors = {};
  for (const key of ["accountId", "from", "to", "q", "kind", "exclude"] as const) {
    if (input[key] !== undefined && typeof input[key] !== "string") {
      errors[key] = "This filter could not be read. Clear it and choose again.";
    }
  }
  const accountId = clean(input.accountId);
  if (accountId && UUID.test(accountId)) filter.accountId = accountId.toLowerCase();
  else if (accountId) errors.accountId = "Choose a valid account before removing rows.";
  for (const key of ["from", "to"] as const) {
    const value = clean(input[key]);
    if (value === undefined) continue;
    if (isCalendarDate(value)) filter[key] = value;
    else errors[key] = `${DATE_FIELDS[key]} is not a real date (${value.slice(0, 20)}). Use YYYY-MM-DD.`;
  }
  if (filter.from && filter.to && filter.from > filter.to) [filter.from, filter.to] = [filter.to, filter.from];
  const q = clean(input.q);
  if (q) filter.q = q.slice(0, 120);
  const kind = clean(input.kind);
  if (kind && (FILTER_KINDS as readonly string[]).includes(kind)) filter.kind = kind;
  else if (kind) errors.kind = "Choose a valid transaction type before removing rows.";
  const exclude = clean(input.exclude);
  if (exclude) {
    const ids = [...new Set(exclude.split(",").map((id) => id.trim().toLowerCase()).filter(Boolean))];
    if (ids.length > MAX_EXCLUDED || ids.some((id) => !UUID.test(id))) {
      errors.exclude = "The excluded rows could not be read. Clear the filter and choose again.";
    } else if (ids.length > 0) {
      filter.exclude = ids;
    }
  }
  return { filter, errors };
}

/** {@link parseFilterResult} without the errors, for callers that only need the usable part. */
export function parseFilter(input: Record<string, unknown>): RegisterFilter {
  return parseFilterResult(input).filter;
}

/** Every field error as one sentence, in field order; empty when there are none. */
export function filterErrorMessage(errors: FilterErrors): string {
  return Object.values(errors).filter(Boolean).join(" ");
}

/** DESIGN §7 item 6: remove-all is refused on an unfiltered table. */
export function isFiltered(filter: RegisterFilter): boolean {
  return Object.entries(filter).some(([key, value]) => key !== "exclude" && value !== undefined);
}

/** Literal chips restating the scope (§7 item 1), in a stable order. */
export function filterChips(
  filter: RegisterFilter,
  accountName: (id: string) => string | undefined = () => undefined,
  kindLabel: (kind: string) => string = (kind) => kind,
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filter.accountId) chips.push({ key: "accountId", label: `Account: ${accountName(filter.accountId) ?? "Unknown account"}` });
  if (filter.from) chips.push({ key: "from", label: `From ${filter.from}` });
  if (filter.to) chips.push({ key: "to", label: `To ${filter.to}` });
  if (filter.kind) chips.push({ key: "kind", label: `Type: ${kindLabel(filter.kind)}` });
  if (filter.q) chips.push({ key: "q", label: `Matches “${filter.q}”` });
  if (filter.exclude?.length) {
    const n = filter.exclude.length;
    chips.push({ key: "exclude", label: `Excluding ${n} protected row${n === 1 ? "" : "s"}` });
  }
  return chips;
}

/** The filter as form fields / URL params — only the keys that are set. */
export function filterFields(filter: RegisterFilter): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) fields[key] = value.join(",");
    } else {
      fields[key] = value;
    }
  }
  return fields;
}

/**
 * *Filter them out* (DESIGN §7.1): the same filter with `ids` added to its exclusions.
 * Null when that would carry more than {@link MAX_EXCLUDED} rows; the owner narrows instead.
 */
export function withExclusions(filter: RegisterFilter, ids: readonly string[]): RegisterFilter | null {
  const exclude = [...new Set([...(filter.exclude ?? []), ...ids.map((id) => id.toLowerCase())])];
  if (exclude.length > MAX_EXCLUDED) return null;
  return { ...filter, exclude };
}

/**
 * Applies the exclusions to a resolved scope. `loaded` is what the repository returned
 * (at most `MAX_BULK_ROWS + 1` rows) and `totalCount` its count. The count is exact
 * whenever the whole scope was loaded, which is every case a confirmation can accept.
 */
export function applyExclusions<T extends { id: string }>(
  loaded: readonly T[],
  totalCount: number,
  exclude: readonly string[] = [],
): { rows: T[]; count: number; complete: boolean } {
  // `complete`: every matching row was loaded, so `rows` is the whole scope and
  // `rows.length === count`. Only a complete scope may be removed (QA FAIL 2026-11-05).
  const complete = loaded.length >= totalCount;
  if (exclude.length === 0) return { rows: [...loaded], count: totalCount, complete };
  const out = new Set(exclude.map((id) => id.toLowerCase()));
  const rows = loaded.filter((row) => !out.has(row.id.toLowerCase()));
  return { rows, count: totalCount - (loaded.length - rows.length), complete };
}

/**
 * How many rows to load to resolve a bulk scope: the cap, one lookahead row, plus one
 * per exclusion. Excluded rows still come back from the repository, so without the extra
 * room a scope of `MAX_BULK_ROWS` after exclusions would load only partly (QA FAIL
 * 2026-11-05: total 5002, exclude 2, loaded 5001 → 4999 removed while 5000 confirmed).
 */
export function bulkScopeLimit(exclude: readonly string[] = []): number {
  return MAX_BULK_ROWS + 1 + Math.min(new Set(exclude.map((id) => id.toLowerCase())).size, MAX_EXCLUDED);
}

/** The last guard before a write: the resolved rows must be exactly the confirmed scope. */
export function isResolvedScope(scope: { rows: readonly unknown[]; count: number; complete: boolean }): boolean {
  return scope.complete && scope.rows.length === scope.count;
}

/** §7 item 3: the phrase carries the ungrouped count. */
export function removalPhrase(count: number): string {
  return `remove ${count} rows`;
}

/** Exact after trimming, case-insensitive; never a partial match. */
export function phraseMatches(typed: string, count: number): boolean {
  return typed.trim().toLowerCase() === removalPhrase(count);
}

export type BulkScopeCheck =
  | { ok: true }
  | { ok: false; reason: "UNFILTERED" | "EMPTY" | "TOO_MANY" | "DRIFTED" | "PHRASE"; message: string };

const grouped = (n: number) => n.toLocaleString("en-IN");

/** The server-side gate run at confirm time, before any id is resolved into a removal. */
export function checkBulkScope(input: {
  filter: RegisterFilter;
  expectedCount: number;
  actualCount: number;
  phrase: string;
}): BulkScopeCheck {
  if (!isFiltered(input.filter)) {
    return { ok: false, reason: "UNFILTERED", message: "Remove-all needs a filter. Narrow the table first, so the scope is something you chose." };
  }
  if (input.actualCount === 0) return { ok: false, reason: "EMPTY", message: "Nothing matches this filter any more. Nothing was removed." };
  if (input.actualCount !== input.expectedCount) {
    return {
      ok: false,
      reason: "DRIFTED",
      message: `The table changed while this was open: ${grouped(input.expectedCount)} is now ${grouped(input.actualCount)}. Review again.`,
    };
  }
  if (input.actualCount > MAX_BULK_ROWS) {
    return { ok: false, reason: "TOO_MANY", message: `Remove at most ${grouped(MAX_BULK_ROWS)} rows at a time. Narrow the filter.` };
  }
  if (!phraseMatches(input.phrase, input.actualCount)) {
    return { ok: false, reason: "PHRASE", message: `Type “${removalPhrase(input.actualCount)}” to confirm.` };
  }
  return { ok: true };
}

/** A refusal from the ledger (`TombstoneRefusedError`), shaped for the screen. */
export function describeRemovalRefusal(
  reason: string,
  transactionIds: readonly string[],
  when: "after" | "before" = "after",
): string {
  const n = transactionIds.length;
  const rows = n === 1 ? "1 of these rows is" : `${grouped(n)} of these rows are`;
  // A preflight refusal comes before anything is attempted (§7.1: "Nothing will be removed").
  const nothing = when === "before" ? "Nothing will be removed." : "Nothing was removed.";
  switch (reason) {
    case "RECONCILED":
      return `${rows} in reconciled statements and cannot be removed. ${nothing}`;
    case "ALREADY_REMOVED":
      return `${rows} already removed. ${nothing}`;
    case "NOT_FOUND":
      return `${rows} no longer in the ledger. ${nothing}`;
    default:
      return `The removal was refused. ${nothing}`;
  }
}

/** The success line, matching §7.1 "after removal". */
export function removedMessage(count: number): string {
  return `Removed ${grouped(count)} transaction${count === 1 ? "" : "s"}`;
}
