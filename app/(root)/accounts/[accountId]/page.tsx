import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  Archive,
  ArchiveRestore,
  ArrowLeftRight,
  Save,
  Trash2,
  Upload,
} from "lucide-react";
import { Money } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import { AccountType } from "@/domain/accounts";
import { CashAsset } from "@/domain/assets";
import { Card, EmptyState, Field, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { InstitutionMark, ProviderPicker } from "@/ui/provider-picker";
import { formatMoney } from "@/ui/format";
import { ActionForm, SubmitButton } from "@/ui/action-form";
import type { SeriesPoint } from "@/ui/charts";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import {
  closeCashAccountAction,
  deleteCashAccountHistoryAction,
  deleteEmptyCashAccountAction,
  reopenCashAccountAction,
  updateCashAccountAction,
} from "../actions";
import BalanceChart from "./balance-chart";
import ReconcilePanel from "./reconcile-panel";
import LedgerTable from "./ledger-table";

export const metadata: Metadata = { title: "Account" };

const PAGE_SIZE = 50;

/**
 * One account, everything about it, and every control that acts on it.
 *
 * The list screen answers "how much money do I have"; this answers "what has
 * happened to this account and what can I do about it". Splitting them is what
 * makes the list readable again — the per-row edit form, the delete buttons and
 * the reconcile panel were all competing for the same table cell.
 *
 * `asOf` and `page` live in the query string so a balance on a particular date is
 * a link someone can keep.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ asOf?: string; page?: string; q?: string }>;
}) {
  await connection();

  const [{ accountId }, query] = await Promise.all([params, searchParams]);
  const userId = await currentUserId();
  await ensureSeeded(userId);

  const { repositories } = services();
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));

  // A hand-edited `?asOf=` should not take the whole page down with a parse error.
  let asOf = today;
  if (query.asOf) {
    try {
      asOf = CalendarDate.parse(query.asOf);
    } catch {
      asOf = today;
    }
  }

  const accounts = await repositories.accounts.list(userId, { includeClosed: true });
  const account = accounts.find((candidate) => candidate.id.value === accountId);
  if (!account) notFound();

  const page = Math.max(0, Number.parseInt(query.page ?? "0", 10) || 0);
  const window = DateRange.of(asOf.plusDays(-365), asOf);

  const [balance, postingCount, ledger, series, flows] = await Promise.all([
    repositories.balances.balanceOf(userId, account.id, asOf),
    repositories.accounts.countPostings(userId, account.id),
    repositories.journal.find(userId, {
      accountIds: [account.id],
      search: query.q || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    repositories.balances.balanceSeries(userId, account.id, window),
    repositories.balances.monthlyFlows(userId, DateRange.monthOf(asOf)),
  ]);

  const byId = new Map(accounts.map((candidate) => [candidate.id.value, candidate]));
  const thisMonth = flows.find((flow) => flow.month === asOf.toMonthKey());
  const asset = CashAsset.classify(account);

  const points: SeriesPoint[] = series.map((point) => ({
    x: point.date.toISO(),
    balance: point.balance.minor.toString(),
  }));

  const pageCount = Math.max(1, Math.ceil(ledger.totalCount / PAGE_SIZE));
  const canDelete = !account.isSystem && postingCount === 0;
  const canDeleteHistory = !account.isSystem && account.isClosed && postingCount > 0;

  return (
    <>
      <PageHeader
        title={account.displayName}
        subtitle={
          account.accountNumberSuffix
            ? `${account.code.toString()} · ending ${account.accountNumberSuffix}`
            : account.code.toString()
        }
        badge={
          <Pill tone={account.isClosed ? "neutral" : "brand"}>
            {account.isClosed ? "Closed" : "Open"}
          </Pill>
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/imports" className="ghost-btn h-10 px-4 text-xs">
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Import a statement
            </Link>
            <Link href="/accounts" className="ghost-btn h-10 px-4 text-xs">
              All accounts
            </Link>
          </div>
        }
      />

      <div className="mb-6 flex items-center gap-3">
        <InstitutionMark institution={account.institution} />
        <p className="text-sm text-gray-400">
          {account.institution ?? "No institution recorded"}
          {asset && <span className="text-gray-500"> · {KIND_LABELS[asset.kind] ?? asset.kind}</span>}
        </p>
      </div>

      {/* ── Balance, on a date the user chooses ─────────────────────────── */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Balance" value={balance} hint={`As at ${asOf.toISO()}`} />
        <Stat
          label="Postings"
          value={<span className="tnum">{postingCount}</span>}
          hint="Lines behind that figure"
        />
        <Stat label="Money in" value={thisMonth?.income ?? Money.zero()} hint="Across all accounts, this month" />
        <Stat label="Money out" value={thisMonth?.expense ?? Money.zero()} hint="Across all accounts, this month" />
      </div>

      {/* `Field` derives the input id from `name`, and the reconcile panel below
          also has an `asOf` — so this one is named for the id and mapped back to
          `asOf` on submit, rather than shipping two elements with one id. */}
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <Field name="balanceAsOf" label="Balance as at">
          {(props) => (
            <input
              {...props}
              name="asOf"
              type="date"
              defaultValue={asOf.toISO()}
              max={today.toISO()}
              className="form-input"
            />
          )}
        </Field>
        <button type="submit" className="ghost-btn h-12 px-5 text-xs">
          Show that date
        </button>
        {query.asOf && (
          <Link href={`/accounts/${accountId}`} className="text-xs text-gray-400 hover:underline">
            Back to today
          </Link>
        )}
      </form>

      <BalanceChart points={points} currency={account.currency.code} />

      {!account.isClosed && (
        <ReconcilePanel
          accountId={account.id.value}
          accountName={account.displayName}
          today={today.toISO()}
        />
      )}

      {/* ── Details ─────────────────────────────────────────────────────── */}
      {!account.isSystem && (
        <Card
          title="Details"
          subtitle="Only the last four digits of an account number are ever stored."
          className="mb-6"
        >
          <ActionForm
            action={updateCashAccountAction}
            fields={{ accountId: account.id.value }}
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            <>
              <Field name="name" label="Account name" required>
                {(props) => (
                  <input
                    {...props}
                    name="name"
                    className="form-input"
                    defaultValue={account.name}
                    required
                    maxLength={120}
                  />
                )}
              </Field>

              <Field name="subtype" label="Kind" required>
                {(props) => (
                  <select
                    {...props}
                    name="subtype"
                    className="form-input"
                    defaultValue={account.subtype ?? "BANK"}
                  >
                    <option value="BANK">Bank account</option>
                    <option value="SAVINGS">Savings account</option>
                    <option value="WALLET">Wallet (Paytm, PhonePe)</option>
                    <option value="CASH">Cash in hand</option>
                  </select>
                )}
              </Field>

              <Field name="institution" label="Bank or provider">
                {(props) => (
                  <ProviderPicker
                    {...props}
                    name="institution"
                    defaultValue={account.institution ?? ""}
                    kinds={["BANK", "WALLET"]}
                    placeholder="HDFC Bank"
                  />
                )}
              </Field>

              <Field name="accountNumberSuffix" label="Last four digits">
                {(props) => (
                  <input
                    {...props}
                    name="accountNumberSuffix"
                    className="form-input tnum"
                    defaultValue={account.accountNumberSuffix ?? ""}
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="1234"
                  />
                )}
              </Field>

              <Field
                name="sortOrder"
                label="Position in the list"
                hint="Lower sorts first. Leave alone if you have no preference."
              >
                {(props) => (
                  <input
                    {...props}
                    name="sortOrder"
                    className="form-input tnum"
                    defaultValue={account.sortOrder}
                    inputMode="numeric"
                  />
                )}
              </Field>

              <div className="flex items-end">
                <SubmitButton icon={<Save aria-hidden />} className="h-12 w-full px-4 text-xs">
                  Save details
                </SubmitButton>
              </div>
            </>
          </ActionForm>
        </Card>
      )}

      {/* ── This account's ledger ───────────────────────────────────────── */}
      <section className="panel mb-6 p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-600 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-100">Transactions</h2>
          <form method="get" className="flex items-center gap-2">
            {query.asOf && <input type="hidden" name="asOf" value={query.asOf} />}
            <input
              name="q"
              type="search"
              defaultValue={query.q ?? ""}
              placeholder="Search narration or reference"
              aria-label="Search this account's transactions"
              className="form-input h-9 py-1 text-xs"
            />
            <button type="submit" className="ghost-btn h-9 px-3 text-xs">
              Search
            </button>
          </form>
        </div>

        {ledger.transactions.length === 0 ? (
          <EmptyState
            icon={ArrowLeftRight}
            title={query.q ? "Nothing matches that search" : "No transactions yet"}
            body={
              query.q
                ? "Try a shorter search, or clear it to see everything."
                : "Import a statement to fill this account in."
            }
          />
        ) : (
          <>
            <LedgerTable
              accountId={account.id.value}
              rows={ledger.transactions.map((txn) => {
                const postings = txn.postings();
                const mine = postings.find((posting) => posting.accountId.equals(account.id));
                const other = postings.find((posting) => !posting.accountId.equals(account.id));
                const otherAccount = other ? byId.get(other.accountId.value) : undefined;
                return {
                  id: txn.id.value,
                  date: txn.txnDate.toISO(),
                  narration: txn.description,
                  otherSide: otherAccount?.code.toString() ?? "—",
                  amount: mine ? formatMoney(mine.amount) : "—",
                  // A debit to an asset is money arriving; to a liability it is
                  // debt being paid off. Both read as "in" for this account.
                  incoming: mine?.isDebit ?? false,
                  isReversal: txn.isReversal,
                };
              })}
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-600 px-5 py-3">
              <p className="text-xs text-gray-500">
                <span className="tnum text-gray-300">{ledger.totalCount}</span> transaction
                {ledger.totalCount === 1 ? "" : "s"} · page {page + 1} of {pageCount}
              </p>
              <div className="flex gap-2">
                {page > 0 && (
                  <Link
                    href={pageHref(accountId, query, page - 1)}
                    className="ghost-btn h-9 px-3 text-xs"
                  >
                    Previous
                  </Link>
                )}
                {page < pageCount - 1 && (
                  <Link
                    href={pageHref(accountId, query, page + 1)}
                    className="ghost-btn h-9 px-3 text-xs"
                  >
                    Next
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── Danger zone ─────────────────────────────────────────────────── */}
      {!account.isSystem && (
        <Card
          title="Closing and deleting"
          subtitle="Closing is reversible and keeps everything. Deleting is not, which is why it insists the account is closed first."
        >
          <div className="flex flex-wrap gap-3">
            {!account.isClosed && (
              <ActionForm
                action={closeCashAccountAction}
                fields={{ accountId: account.id.value }}
                confirm={{
                  title: `Close ${account.displayName}?`,
                  body: "It stops accepting new postings and disappears from the account pickers. Its balance and history are kept, and you can reopen it at any time.",
                  confirmLabel: "Close it",
                }}
              >
                <SubmitButton icon={<Archive aria-hidden />} className="h-10 px-4 text-xs">
                  Close account
                </SubmitButton>
              </ActionForm>
            )}

            {account.isClosed && (
              <ActionForm action={reopenCashAccountAction} fields={{ accountId: account.id.value }}>
                <SubmitButton icon={<ArchiveRestore aria-hidden />} className="h-10 px-4 text-xs">
                  Reopen account
                </SubmitButton>
              </ActionForm>
            )}

            {canDelete && (
              <ActionForm
                action={deleteEmptyCashAccountAction}
                fields={{ accountId: account.id.value }}
                confirm={{
                  title: `Delete ${account.displayName}?`,
                  body: "Nothing has ever been posted to this account, so nothing is lost.",
                  confirmLabel: "Delete it",
                  tone: "danger",
                }}
              >
                <SubmitButton icon={<Trash2 aria-hidden />} tone="danger" className="h-10 px-4 text-xs">
                  Delete account
                </SubmitButton>
              </ActionForm>
            )}

            {canDeleteHistory && (
              <ActionForm
                action={deleteCashAccountHistoryAction}
                fields={{ accountId: account.id.value }}
                confirm={{
                  title: `Delete ${account.displayName} and all ${postingCount} of its postings?`,
                  body: "Every transaction touching this account is removed from your ledger and your net worth changes. This cannot be undone from the app.",
                  confirmLabel: "Delete everything",
                  tone: "danger",
                }}
              >
                <SubmitButton icon={<Trash2 aria-hidden />} tone="danger" className="h-10 px-4 text-xs">
                  Delete account and history
                </SubmitButton>
              </ActionForm>
            )}

            {!canDelete && !canDeleteHistory && (
              <p className="self-center text-xs text-gray-500">
                {postingCount} posting(s) here. Close the account first to be able to delete it
                along with its history.
              </p>
            )}
          </div>
        </Card>
      )}
    </>
  );
}

function pageHref(
  accountId: string,
  query: { asOf?: string; q?: string },
  page: number,
): string {
  const params = new URLSearchParams();
  if (query.asOf) params.set("asOf", query.asOf);
  if (query.q) params.set("q", query.q);
  if (page > 0) params.set("page", String(page));
  const suffix = params.toString();
  return suffix ? `/accounts/${accountId}?${suffix}` : `/accounts/${accountId}`;
}

const KIND_LABELS: Record<string, string> = {
  BANK_ACCOUNT: "Bank",
  WALLET: "Wallet",
  CASH_IN_HAND: "Cash",
};
