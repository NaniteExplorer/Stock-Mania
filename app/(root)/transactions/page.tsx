import type { Metadata } from "next";
import { queryTransactions } from "@/features/transactions/transaction.actions";
import { getMyAccounts } from "@/features/accounts/account.actions";
import TransactionsList from "@/components/wealth/TransactionsList";

export const metadata: Metadata = { title: "Transactions" };

export default async function TransactionsPage() {
  const [{ transactions, total, grandTotal }, accounts] = await Promise.all([
    queryTransactions({ page: 0, pageSize: 50 }),
    getMyAccounts(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="page-title">Transactions</h1>
        <p className="page-subtitle">Every imported transaction across your accounts — search, filter by date/category, and recategorize.</p>
      </div>
      <TransactionsList
        initialTransactions={transactions}
        initialTotal={total}
        grandTotal={grandTotal}
        accounts={accounts}
      />
    </div>
  );
}
