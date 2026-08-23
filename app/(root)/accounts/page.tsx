import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Landmark } from "lucide-react";
import { connection } from "next/server";
import { CalendarDate, DateRange } from "@/core/time";
import { Money } from "@/core/money";
import { Card, EmptyState, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
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
 */
export default async function Page() {
  await connection();

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const { banking, repositories } = services();
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const monthRange = DateRange.monthOf(today);

  const [result, flows] = await Promise.all([
    banking.listCashPositions.execute({ userId, asOf: today }),
    repositories.balances.monthlyFlows(userId, monthRange),
  ]);

  if (!result.ok) throw new Error(result.error.message);

  // The three seeded group accounts are hidden while empty: they are legitimate,
  // postable accounts, but three permanent zero rows above the real ones read as
  // clutter. Named explicitly rather than inferred from "looks like a group", so
  // a user's own empty account is never hidden from them.
  const GROUP_CODES = new Set(["Assets:Bank", "Assets:Cash", "Assets:Wallets"]);
  const positions = result.value.positions.filter(
    (position) =>
      !position.balance.isZero || !GROUP_CODES.has(position.asset.account.code.toString()),
  );
  const thisMonth = flows.find((flow) => flow.month === today.toMonthKey());

  return (
    <>
      <PageHeader
        title="Accounts"
        subtitle="Every bank account, wallet and cash balance — summed from journal postings at read time, never stored."
        badge={<Pill tone="brand">Phase 2</Pill>}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total balance" value={result.value.total} hint="Spendable money today" />
        <Stat label="Accounts" value={<span className="tnum">{positions.length}</span>} hint="Open, cash-like" />
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

      <section className="panel mb-6 p-0">
        <div className="table-scroll">
          <table className="w-full text-sm">
            <caption className="sr-only">
              Cash accounts, with kind, currency and derived balance
            </caption>
            <thead>
              <tr className="border-b border-gray-600">
                <th scope="col" className="metric-label px-4 py-3 text-left">Account</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Kind</th>
                <th scope="col" className="metric-label px-4 py-3 text-left">Currency</th>
                <th scope="col" className="metric-label px-4 py-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((position) => (
                <tr key={position.asset.id.value} className="border-b border-gray-600/50 last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-100">{position.asset.displayName}</span>
                    {position.asset.account.institution && (
                      <span className="ml-2 text-xs text-gray-500">
                        {position.asset.account.institution}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{KIND_LABELS[position.asset.kind]}</td>
                  <td className="px-4 py-3 text-gray-400">{position.asset.currency.code}</td>
                  <td className="px-4 py-3 text-right">
                    <MoneyText value={position.balance} tone="neutral" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {positions.length === 0 && (
          <EmptyState
            icon={Landmark}
            title="No accounts yet"
            body="Open a bank account, wallet or cash account below, then import a statement to fill it in."
          />
        )}
      </section>

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
