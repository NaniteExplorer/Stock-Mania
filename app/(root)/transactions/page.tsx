import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import { AccountType } from "@/domain/accounts";
import { rupee, type Figure } from "@/core/format";
import { formatMoney } from "@/ui/format";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import { Kpi, KpiStrip, Masthead, Page as PageShell } from "../../../components/ui/page-shell";
import { Banner } from "../../../components/ui/banner";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { NativeSelect } from "../../../components/ui/native-select";
import RegisterTable, { type RegisterRow } from "./register-table";
import { Count } from "@/core/units";
import {
  applyExclusions, bulkScopeLimit, describeRemovalRefusal, filterChips, filterErrorMessage, filterFields, isFiltered,
  parseFilterResult, FILTER_KINDS, MAX_EXCLUDED,
} from "./bulk-scope";
import { toTransactionQuery } from "./bulk-query";
import { buildRemovalPreview, projectTransaction, rowHref, type PreviewAccount } from "./bulk-preview";

export const metadata: Metadata = { title: "Transactions" };

const PAGE_SIZE = 200;

/**
 * The register.
 *
 * The projection from `Transaction` to a row is the interesting part and it is
 * done here, on the server (`bulk-preview.ts`): each transaction's *balance-sheet*
 * leg gives the account and the direction, and its *income-statement* leg gives the
 * category. Reading it that way means a transfer between two accounts has no
 * category and says so, rather than being labelled with whichever account came first.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; accountId?: string; from?: string; to?: string; q?: string; kind?: string; exclude?: string }>;
}) {
  await connection();

  const params = await searchParams;
  // An impossible date is a field error shown beside its input, never a thrown RangeError.
  const { filter, errors } = parseFilterResult(params);
  const query = toTransactionQuery(filter);
  const requestedPage = Number.parseInt(params.page ?? "1", 10);
  const pageNumber = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const { repositories } = services();
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));

  const [page, accounts, flows, scope] = await Promise.all([
    repositories.journal.find(userId, { ...query, limit: Count(PAGE_SIZE), offset: Count((pageNumber - 1) * PAGE_SIZE) }),
    repositories.accounts.list(userId, { includeClosed: true }),
    repositories.balances.monthlyFlows(userId, DateRange.monthOf(today)),
    // The remove-all preview (DESIGN §7.1): the whole matching set, only when filtered.
    isFiltered(filter)
      ? repositories.journal.find(userId, { ...query, limit: Count(bulkScopeLimit(filter.exclude)), offset: Count(0) })
      : Promise.resolve(null),
  ]);

  const byId = new Map(accounts.map((account) => [account.id.value, account]));
  const lookup = (id: string): PreviewAccount | undefined => {
    const account = byId.get(id);
    return account
      ? {
          name: account.displayName,
          isBalanceSheet: account.type.isBalanceSheet,
          isIncomeStatement: account.type.isIncomeStatement,
          isAsset: account.type === AccountType.ASSET,
        }
      : undefined;
  };
  const uncategorised = accounts.find(
    (account) => account.code.toString() === "Expenses:Uncategorized",
  );

  const excluded = new Set(filter.exclude ?? []);
  const rows: RegisterRow[] = page.transactions
    .filter((txn) => !excluded.has(txn.id.value))
    .map((txn) => {
      const row = projectTransaction(txn, lookup);
      return {
        id: row.id,
        date: row.date,
        description: row.description,
        kind: KIND_LABELS[txn.kind] ?? txn.kind,
        account: row.account,
        category: row.category,
        amount: formatMoney(row.money),
        direction: row.direction,
        href: byId.has(row.accountId) ? rowHref(row) : null,
        reconciled: row.reconciled,
      };
    });

  // The scope the dialog would remove: the filter, less anything filtered out (§7.1).
  const scoped = scope
    ? applyExclusions(scope.transactions.map((txn) => projectTransaction(txn, lookup)), scope.totalCount, filter.exclude)
    : null;
  const preview = buildRemovalPreview(scoped?.rows ?? []);
  const fieldErrors = filterErrorMessage(errors);
  const protectedIds = preview.protectedRows.map((row) => row.id);
  // Known before the dialog opens, so the dialog shows the refusal instead of a form.
  const preflight = fieldErrors
    ? { message: `${fieldErrors} Nothing will be removed.`, refusal: "INVALID" }
    : protectedIds.length > 0
      ? {
          message: describeRemovalRefusal("RECONCILED", protectedIds, "before"),
          refusal: "RECONCILED",
          blockedIds: protectedIds.slice(0, MAX_EXCLUDED + 1),
        }
      : null;
  const blocked = Object.fromEntries(preview.protectedRows.map((row) => [row.id, { label: row.label, href: row.href }]));
  const chips = filterChips(
    filter,
    (id) => byId.get(id)?.displayName,
    (kind) => KIND_LABELS[kind] ?? kind,
  ).map((chip) => chip.label);
  const pageHref = (n: number) => `/transactions?${new URLSearchParams({ ...filterFields(filter), page: String(n) })}`;
  const withoutExclusions = `/transactions?${new URLSearchParams(filterFields({ ...filter, exclude: undefined }))}`;

  const thisMonth = flows.find((flow) => flow.month === today.toMonthKey());
  const income = thisMonth?.income ?? Money.zero();
  const expense = thisMonth?.expense ?? Money.zero();
  const uncategorisedCount = uncategorised
    ? page.transactions.filter((txn) =>
        txn.postings().some((posting) => posting.accountId.equals(uncategorised.id)),
      ).length
    : 0;

  return (
    <PageShell>
      <Masthead
        title="Transactions"
        side={
          <Button asChild variant="outline" size="sm">
            <Link href="/imports">Import a statement</Link>
          </Button>
        }
      />
      <p className="text-sm text-(--fg-secondary)">
        Every posting, keyboard-driven, categorised by keyword rules you can read and edit.{" "}
        <span className="text-(--fg-muted)">Phase 2</span>
      </p>

      <div className="mb-6">
        <KpiStrip>
          <Kpi label="Inflow" value={rupee(income)} detail="This month"
            info="Postings to income categories in this calendar month. Transfers between your own accounts are not income, so they are not counted." />
          <Kpi label="Outflow" value={rupee(expense)} detail="This month"
            info="Postings to expense categories in this calendar month. Transfers between your own accounts are not counted." />
          <Kpi label="Net" value={rupee(income.minus(expense))} detail="Inflow less outflow"
            info="Inflow less outflow for this calendar month. A minus sign means more went out than came in." />
          <Kpi label="Uncategorised" value={String(uncategorisedCount) as Figure} detail="Awaiting a rule"
            info="Rows on this page still posted to Expenses:Uncategorized. A keyword rule you write moves them to a category." />
        </KpiStrip>
      </div>

      <form method="get" action="/transactions" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filter the register">
        <Label className="flex-col items-start text-xs text-(--fg-secondary)">
          Account
          <NativeSelect name="accountId" defaultValue={filter.accountId ?? ""}>
            <option value="">Any</option>
            {accounts.filter((account) => account.type.isBalanceSheet).map((account) => (
              <option key={account.id.value} value={account.id.value}>{account.displayName}</option>
            ))}
          </NativeSelect>
        </Label>
        {(["from", "to"] as const).map((key) => (
          <Label key={key} className="flex-col items-start text-xs text-(--fg-secondary)">
            {key === "from" ? "From" : "To"}
            <Input
              type="date"
              name={key}
              defaultValue={filter[key] ?? ""}
              aria-invalid={errors[key] ? true : undefined}
              aria-describedby={errors[key] ? `filter-${key}-error` : undefined}
            />
            {errors[key] && (
              <span id={`filter-${key}-error`} role="alert" className="block text-(--loss)">{errors[key]}</span>
            )}
          </Label>
        ))}
        <Label className="flex-col items-start text-xs text-(--fg-secondary)">
          Type
          <NativeSelect name="kind" defaultValue={filter.kind ?? ""}>
            <option value="">Any</option>
            {FILTER_KINDS.map((kind) => (
              <option key={kind} value={kind}>{KIND_LABELS[kind] ?? kind}</option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="flex-col items-start text-xs text-(--fg-secondary)">
          Narration or reference
          <Input type="search" name="q" defaultValue={filter.q ?? ""} />
        </Label>
        <button type="submit" className="ghost-btn h-10 px-4 text-xs">Apply filter</button>
        {(isFiltered(filter) || fieldErrors) && (
          <Link href="/transactions" className="text-xs text-(--fg-secondary) hover:underline">Clear filter</Link>
        )}
      </form>

      {filter.exclude && filter.exclude.length > 0 && (
        <p className="mb-4 text-xs text-(--fg-secondary)">
          Excluding {filter.exclude.length} protected row{filter.exclude.length === 1 ? "" : "s"} from this filter ·{" "}
          <Link href={withoutExclusions} className="hover:underline">Show them again</Link>
        </p>
      )}
      {errors.exclude && <p role="alert" className="mb-4 text-xs text-(--loss)">{errors.exclude}</p>}

      <RegisterTable
        rows={rows}
        serverFiltered={isFiltered(filter)}
        bulk={{
          count: scoped?.count ?? page.totalCount,
          chips,
          fields: filterFields(filter),
          net: preview.net,
          range: preview.range,
          accounts: preview.accounts,
          preflight,
          blocked,
        }}
        empty={
          <Banner title={isFiltered(filter) ? "Nothing matches this filter" : "No transactions yet"}>
            <p>
              {isFiltered(filter)
                ? "Widen the dates or clear the filter to see more of the register."
                : "Import a bank statement, or record a spend from the accounts screen. Nothing reaches the ledger until you confirm it."}
            </p>
          </Banner>
        }
      />

      {page.totalCount > PAGE_SIZE && (
        <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Transaction pages">
          <Link
            href={pageHref(pageNumber - 1)}
            aria-disabled={pageNumber === 1}
            className={`ghost-btn h-9 px-3 text-xs ${pageNumber === 1 ? "pointer-events-none opacity-40" : ""}`}
          >
            Previous
          </Link>
          <p className="text-xs text-(--fg-muted)">
            Page {pageNumber} of {Math.ceil(page.totalCount / PAGE_SIZE)} · {page.totalCount} transactions
          </p>
          <Link
            href={pageHref(pageNumber + 1)}
            aria-disabled={pageNumber * PAGE_SIZE >= page.totalCount}
            className={`ghost-btn h-9 px-3 text-xs ${pageNumber * PAGE_SIZE >= page.totalCount ? "pointer-events-none opacity-40" : ""}`}
          >
            Next
          </Link>
        </nav>
      )}
    </PageShell>
  );
}

const KIND_LABELS: Record<string, string> = {
  WITHDRAWAL: "Spend",
  DEPOSIT: "Receipt",
  TRANSFER: "Transfer",
  OPENING_BALANCE: "Opening balance",
  RECONCILIATION: "Adjustment",
  CHARGE: "Charge",
  REVERSAL: "Reversal",
};
