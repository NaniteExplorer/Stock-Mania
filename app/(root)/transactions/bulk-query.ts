import { CalendarDate, DateRange } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import type { TransactionKind, TransactionQuery } from "@/domain/transactions";
import { isCalendarDate, type RegisterFilter } from "./bulk-scope";

const EARLIEST = "1900-01-01";
const LATEST = "2999-12-31";

/**
 * A parsed {@link RegisterFilter} as the repository's query; open date ends stay open.
 *
 * Never throws. `parseFilterResult` already drops (and reports) an impossible date, but a
 * filter built any other way is checked again here, so `2026-02-30` can no longer reach
 * `CalendarDate.parse` and take the page or the action down (QA FAIL, 2026-11-03). The
 * exclusion list is not a repository concern: callers apply it with `applyExclusions`.
 */
export function toTransactionQuery(filter: RegisterFilter): TransactionQuery {
  const query: { -readonly [K in keyof TransactionQuery]: TransactionQuery[K] } = {};
  if (filter.accountId) query.accountIds = [AccountId.from(filter.accountId)];
  const from = filter.from && isCalendarDate(filter.from) ? filter.from : undefined;
  const to = filter.to && isCalendarDate(filter.to) ? filter.to : undefined;
  if (from || to) {
    const [start, end] = [from ?? EARLIEST, to ?? LATEST].sort();
    query.range = DateRange.of(CalendarDate.parse(start), CalendarDate.parse(end));
  }
  if (filter.q) query.search = filter.q;
  if (filter.kind) query.kinds = [filter.kind as TransactionKind];
  return query;
}
