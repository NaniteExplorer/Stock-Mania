import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Download } from "lucide-react";
import { connection } from "next/server";
import { CalendarDate, DateRange } from "@/core/time";
import { Money } from "@/core/money";
import { rupee, type Figure } from "@/core/format";
import { Kpi, KpiStrip, Masthead, Page as PageShell, Panel } from "@/components/ui/page-shell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FilterBar } from "@/ui/filter-bar";
import { formatMoney } from "@/ui/format";
import { InstitutionMark } from "@/ui/provider-picker";
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

  const [result, flows, pendingRows] = await Promise.all([
    banking.listCashPositions.execute({ userId, asOf: today, includeClosed: true }),
    repositories.balances.monthlyFlows(userId, monthRange),
    repositories.imports.pendingRowCounts(userId),
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

  /*
   * Staged rows that never reached the ledger, named by their account.
   *
   * This exists because the balances here were correct and misleading at the same
   * time: 96 of 719 statement rows sat in review, their net was −₹6,05,125, and
   * the account showed a figure six lakh healthier than the bank's. Arithmetically
   * right, and the wrong answer to the question being asked.
   */
  const pendingImports = pendingRows
    .map((pending) => {
      const position = positions.find(
        (candidate) => candidate.asset.id.value === pending.accountId,
      );
      return position
        ? {
            ...pending,
            label: position.asset.displayName,
            institution: position.asset.account.institution,
          }
        : null;
    })
    .filter((pending): pending is NonNullable<typeof pending> => pending !== null);

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
    <PageShell>
      <Masthead
        title="Accounts"
        hero={rupee(totalOpen)}
        side={
          <Button asChild variant="outline" size="sm">
            <a href="/accounts/export" download>
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export CSV
            </a>
          </Button>
        }
      />
      <p className="text-sm text-(--fg-secondary)">
        Every bank account, wallet and cash balance — summed from journal postings at read time, never stored.{" "}
        <span className="text-(--fg-muted)">Phase 2</span>
      </p>

      <KpiStrip>
        <Kpi label="Total balance" value={rupee(totalOpen)} detail="Open spendable money" />
        <Kpi label="Accounts" value={String(openPositions.length) as Figure} detail="Open, cash-like" />
        <Kpi label="Money in" value={rupee(thisMonth?.income ?? Money.zero())} detail="This month" />
        <Kpi label="Money out" value={rupee(thisMonth?.expense ?? Money.zero())} detail="This month" />
      </KpiStrip>

      {pendingImports.length > 0 && (
        <Panel
          title="Part of an import is still in the review queue"
          description="Until these rows are posted, the balances below are the balances of the rows that were."
        >
          <ul className="space-y-2 text-sm">
            {pendingImports.map((pending) => (
              <li key={pending.accountId} className="flex flex-wrap items-center gap-2">
                <InstitutionMark institution={pending.institution} />
                <span className="text-(--fg)">{pending.label}</span>
                <span className="text-(--fg-secondary)">
                  — <span className="tabular-nums">{pending.rows}</span> row
                  {pending.rows === 1 ? "" : "s"} staged and not posted
                  {pending.batches > 1 ? ` across ${pending.batches} imports` : ""}
                </span>
                <Link href="/imports" className="text-xs text-(--accent) hover:underline">
                  Review them
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-(--fg-muted)">
            Worth finishing rather than ignoring: a review queue is rarely a random sample of a
            statement, so a part-posted import usually leans one way — and the balance leans with
            it.
          </p>
        </Panel>
      )}

      {result.value.anomalies.length > 0 && (
        <Panel
          title="Worth a look"
          description="These balances are possible in the ledger but not in the world."
        >
          <ul className="space-y-2">
            {result.value.anomalies.map((anomaly) => (
              <li key={anomaly} className="flex gap-2 text-sm text-(--fg-secondary)">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-(--warn)" aria-hidden />
                <span>{anomaly}</span>
              </li>
            ))}
          </ul>
        </Panel>
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

      {positions.length === 0 ? (
        <Banner title="No accounts yet">
          <p>Open a bank account, wallet or cash account below, then import a statement to fill it in.</p>
        </Banner>
      ) : (
        <AccountsTable rows={rows} />
      )}

      <Panel
        title="Open an account"
        description="A balance today is booked against Equity:Opening Balances, so you can start mid-life without inventing history."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/imports">Import a statement</Link>
          </Button>
        }
      >
        <OpenAccountForm />
      </Panel>
    </PageShell>
  );
}

const KIND_LABELS: Record<string, string> = {
  BANK_ACCOUNT: "Bank",
  WALLET: "Wallet",
  CASH_IN_HAND: "Cash",
};
