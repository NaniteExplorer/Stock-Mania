import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftRight } from "lucide-react";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate, DateRange } from "@/core/time";
import { AccountType } from "@/domain/accounts";
import { EmptyState, PageHeader, Pill, Stat } from "@/ui/primitives";
import { formatMoney } from "@/ui/format";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import RegisterTable, { type RegisterRow } from "./register-table";

export const metadata: Metadata = { title: "Transactions" };

const PAGE_SIZE = 200;

/**
 * The register.
 *
 * The projection from `Transaction` to a row is the interesting part and it is
 * done here, on the server: each transaction's *balance-sheet* leg gives the
 * account and the direction, and its *income-statement* leg gives the category.
 * Reading it that way means a transfer between two accounts has no category and
 * says so, rather than being labelled with whichever account came first.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await connection();

  const requestedPage = Number.parseInt((await searchParams).page ?? "1", 10);
  const pageNumber = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const { repositories } = services();
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));

  const [page, accounts, flows] = await Promise.all([
    repositories.journal.find(userId, { limit: PAGE_SIZE, offset: (pageNumber - 1) * PAGE_SIZE }),
    repositories.accounts.list(userId, { includeClosed: true }),
    repositories.balances.monthlyFlows(userId, DateRange.monthOf(today)),
  ]);

  const byId = new Map(accounts.map((account) => [account.id.value, account]));
  const uncategorised = accounts.find(
    (account) => account.code.toString() === "Expenses:Uncategorized",
  );

  const rows: RegisterRow[] = page.transactions.map((txn) => {
    const postings = txn.postings();
    const balanceLeg = postings.find(
      (posting) => byId.get(posting.accountId.value)?.type.isBalanceSheet ?? false,
    );
    const flowLeg = postings.find(
      (posting) => byId.get(posting.accountId.value)?.type.isIncomeStatement ?? false,
    );
    const anchor = balanceLeg ?? postings[0];
    const anchorAccount = byId.get(anchor.accountId.value);

    return {
      id: txn.id.value,
      date: txn.txnDate.toISO(),
      description: txn.description,
      kind: KIND_LABELS[txn.kind] ?? txn.kind,
      account: anchorAccount?.displayName ?? "—",
      category: flowLeg ? (byId.get(flowLeg.accountId.value)?.name ?? "—") : "Transfer",
      amount: formatMoney(anchor.amount),
      direction: !balanceLeg
        ? "NEUTRAL"
        : flowLeg === undefined
          ? "NEUTRAL"
          : balanceLeg.isDebit
            ? anchorAccount?.type === AccountType.ASSET
              ? "IN"
              : "OUT"
            : anchorAccount?.type === AccountType.ASSET
              ? "OUT"
              : "IN",
    };
  });

  const thisMonth = flows.find((flow) => flow.month === today.toMonthKey());
  const income = thisMonth?.income ?? Money.zero();
  const expense = thisMonth?.expense ?? Money.zero();
  const uncategorisedCount = uncategorised
    ? page.transactions.filter((txn) =>
        txn.postings().some((posting) => posting.accountId.equals(uncategorised.id)),
      ).length
    : 0;

  return (
    <>
      <PageHeader
        title="Transactions"
        subtitle="Every posting, keyboard-driven, categorised by keyword rules you can read and edit."
        badge={<Pill tone="brand">Phase 2</Pill>}
        action={
          <Link href="/imports" className="ghost-btn h-10 px-4 text-xs">
            Import a statement
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Inflow" value={income} hint="This month" />
        <Stat label="Outflow" value={expense} hint="This month" />
        <Stat label="Net" value={income.minus(expense)} hint="Inflow less outflow" />
        <Stat
          label="Uncategorised"
          value={<span className="tnum">{uncategorisedCount}</span>}
          hint="Awaiting a rule"
        />
      </div>

      {rows.length === 0 ? (
        <section className="panel p-0">
          <EmptyState
            icon={ArrowLeftRight}
            title="No transactions yet"
            body="Import a bank statement, or record a spend from the accounts screen. Nothing reaches the ledger until you confirm it."
          />
        </section>
      ) : (
        <RegisterTable rows={rows} />
      )}

      {page.totalCount > PAGE_SIZE && (
        <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Transaction pages">
          <Link
            href={`/transactions?page=${pageNumber - 1}`}
            aria-disabled={pageNumber === 1}
            className={`ghost-btn h-9 px-3 text-xs ${pageNumber === 1 ? "pointer-events-none opacity-40" : ""}`}
          >
            Previous
          </Link>
          <p className="text-xs text-gray-500">
            Page {pageNumber} of {Math.ceil(page.totalCount / PAGE_SIZE)} · {page.totalCount} transactions
          </p>
          <Link
            href={`/transactions?page=${pageNumber + 1}`}
            aria-disabled={pageNumber * PAGE_SIZE >= page.totalCount}
            className={`ghost-btn h-9 px-3 text-xs ${pageNumber * PAGE_SIZE >= page.totalCount ? "pointer-events-none opacity-40" : ""}`}
          >
            Next
          </Link>
        </nav>
      )}
    </>
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
