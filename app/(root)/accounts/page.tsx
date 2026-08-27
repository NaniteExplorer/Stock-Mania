import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Download, Landmark } from "lucide-react";
import { connection } from "next/server";
import { CalendarDate, DateRange } from "@/core/time";
import { Money } from "@/core/money";
import { Card, EmptyState, PageHeader, Pill, Stat } from "@/ui/primitives";
import { FilterBar } from "@/ui/filter-bar";
import { formatMoney } from "@/ui/format";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import AccountsTable, { type AccountRow } from "./accounts-table";
import OpenAccountForm from "./open-account-form";

export const metadata: Metadata = { title: "Accounts" };

/**
 * Accounts.
 *
 * Every balance on this page is a `SUM` over postings computed at request time.
 * There is no balance column in the schema, so there is nothing here that can be
 * stale — which is the specific v1 failure this screen exists to not repeat.
 *
 * The group accounts of the seeded chart (`Assets:Bank`, `Assets:Cash`,
 * `Assets:Wallets`) are cash-like too, and are shown only when something has been
 * posted directly to them: they are legitimate accounts, but listing three empty
 * rows above the real ones would read as clutter rather than as information.
 *
 * Editing lives on `/accounts/[accountId]` rather than in a table cell. Eight
 * inputs and four destructive buttons per row made the one question this page
 * exists to answer — how much money is where — the hardest thing on it.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; status?: string; sort?: string }>;
}) {
  await connection();

  const filters = await searchParams;
  const userId = await currentUserId();
  await ensureSeeded(userId);

  const { banking, repositories } = services();
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const monthRange = DateRange.monthOf(today);

  const [result, flows] = await Promise.all([
    banking.listCashPositions.execute({ userId, asOf: today, includeClosed: true }),
    repositories.balances.monthlyFlows(userId, monthRange),
  ]);

  if (!result.ok) throw new Error(result.error.message);

  // Seeded buckets are parents, not real cash accounts. They must not be shown as
  // spendable accounts even if a bad import once posted to them.
  const GROUP_CODES = new Set(["Assets:Bank", "Assets:Cash", "Assets:Wallets"]);
  const positions = result.value.positions.filter(
    (position) => !GROUP_CODES.has(position.asset.account.code.toString()),
  );
  const openPositions = positions.filter((position) => !position.asset.account.isClosed);
  const totalOpen = Money.total(openPositions.map((position) => position.balance));

  const postingCounts = new Map(
    await Promise.all(
      positions.map(
        async (position) =>
          [
            position.asset.id.value,
            await repositories.accounts.countPostings(userId, position.asset.id),
          ] as const,
      ),
    ),
  );
  const thisMonth = flows.find((flow) => flow.month === today.toMonthKey());

  const needle = (filters.q ?? "").trim().toLowerCase();
  const rows: AccountRow[] = positions
    .filter((position) => {
      const account = position.asset.account;
      if (filters.status === "open" && account.isClosed) return false;
      if (filters.status === "closed" && !account.isClosed) return false;
      if (filters.kind && position.asset.kind !== filters.kind) return false;
      if (
        needle &&
        !account.displayName.toLowerCase().includes(needle) &&
        !(account.institution?.toLowerCase().includes(needle) ?? false) &&
        !account.code.toString().toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    })
    .map((position) => {
      const account = position.asset.account;
      return {
        id: account.id.value,
        name: position.asset.displayName,
        code: account.code.toString(),
        institution: account.institution,
        suffix: account.accountNumberSuffix,
        kind: KIND_LABELS[position.asset.kind] ?? position.asset.kind,
        currency: position.asset.currency.code,
        isClosed: account.isClosed,
        isSystem: account.isSystem,
        postingCount: postingCounts.get(account.id.value) ?? 0,
        balance: formatMoney(position.balance),
        // Kept off the row type; used only for the sort below.
        sortKey: account.sortOrder,
        balanceMinor: position.balance.minor,
      };
    })
    .sort((a, b) => {
      switch (filters.sort) {
        case "balance":
          return a.balanceMinor === b.balanceMinor ? 0 : a.balanceMinor > b.balanceMinor ? -1 : 1;
        case "name":
          return a.name.localeCompare(b.name);
        case "postings":
          return b.postingCount - a.postingCount;
        default:
          return a.sortKey - b.sortKey || a.name.localeCompare(b.name);
      }
    })
    .map(({ sortKey: _sortKey, balanceMinor: _balanceMinor, ...row }) => row);

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Every bank account, wallet and cash balance — summed from journal postings at read time, never stored."
        badge={<Pill tone="brand">Phase 2</Pill>}
        action={
          <a href="/accounts/export" className="ghost-btn h-10 px-4 text-xs" download>
            <Download className="h-3.5 w-3.5" aria-hidden />
            Export CSV
          </a>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total balance" value={totalOpen} hint="Open spendable money" />
        <Stat
          label="Accounts"
          value={<span className="tnum">{openPositions.length}</span>}
          hint="Open, cash-like"
        />
        <Stat label="Money in" value={thisMonth?.income ?? Money.zero()} hint="This month" />
        <Stat label="Money out" value={thisMonth?.expense ?? Money.zero()} hint="This month" />
      </div>

      {result.value.anomalies.length > 0 && (
        <Card
          title="Worth a look"
          subtitle="These balances are possible in the ledger but not in the world."
          className="mb-6"
        >
          <ul className="space-y-2">
            {result.value.anomalies.map((anomaly) => (
              <li key={anomaly} className="flex gap-2 text-sm text-gray-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                <span>{anomaly}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {positions.length > 0 && (
        <FilterBar
          searchPlaceholder="Search name, bank or code"
          filters={[
            {
              name: "status",
              label: "Status",
              options: [
                { value: "", label: "Open and closed" },
                { value: "open", label: "Open only" },
                { value: "closed", label: "Closed only" },
              ],
            },
            {
              name: "kind",
              label: "Kind",
              options: [
                { value: "", label: "Any kind" },
                { value: "BANK_ACCOUNT", label: "Bank" },
                { value: "WALLET", label: "Wallet" },
                { value: "CASH_IN_HAND", label: "Cash" },
              ],
            },
            {
              name: "sort",
              label: "Sort",
              options: [
                { value: "", label: "Your order" },
                { value: "balance", label: "Largest balance" },
                { value: "name", label: "Name A–Z" },
                { value: "postings", label: "Most active" },
              ],
            },
          ]}
        />
      )}

      <div className="mb-6">
        {positions.length === 0 ? (
          <section className="panel p-0">
            <EmptyState
              icon={Landmark}
              title="No accounts yet"
              body="Open a bank account, wallet or cash account below, then import a statement to fill it in."
            />
          </section>
        ) : (
          <AccountsTable rows={rows} />
        )}
      </div>

      <Card
        title="Open an account"
        subtitle="A balance today is booked against Equity:Opening Balances, so you can start mid-life without inventing history."
        action={
          <Link href="/imports" className="ghost-btn h-10 px-4 text-xs">
            Import a statement
          </Link>
        }
      >
        <OpenAccountForm />
      </Card>
    </>
  );
}

const KIND_LABELS: Record<string, string> = {
  BANK_ACCOUNT: "Bank",
  WALLET: "Wallet",
  CASH_IN_HAND: "Cash",
};
