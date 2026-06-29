import type { Metadata } from "next";
import { Landmark } from "lucide-react";
import { getMyAccounts } from "@/features/accounts/account.actions";
import { transactionService } from "@/features/transactions/transaction.service";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { userPreferencesService } from "@/features/user/user.preferences";
import AccountsManager from "@/components/wealth/AccountsManager";
import StatementImporter from "@/components/wealth/StatementImporter";
import { formatCurrency, getCurrencyRates } from "@/lib/currencies";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const session = await getCurrentSession();
  const [accounts, transactions, preferences] = await Promise.all([
    getMyAccounts(), session?.user?.id ? transactionService.list(session.user.id) : [],
    session?.user?.id ? userPreferencesService.get(session.user.id) : Promise.resolve({ displayCurrency: "INR" }),
  ]);
  const displayCurrency = preferences.displayCurrency || "INR";
  const rates = await getCurrencyRates(displayCurrency, accounts.map((account) => account.currency));
  const total = accounts.reduce((sum, account) => sum + account.balance / (rates[account.currency] || (account.currency === displayCurrency ? 1 : Number.POSITIVE_INFINITY)), 0);
  const converted = accounts.some((account) => account.currency !== displayCurrency);

  return <div className="flex flex-col gap-6">
    <div><h1 className="page-title">Accounts</h1><p className="page-subtitle">Bank, cash, deposits, retirement accounts and statement history.</p></div>
    <div className="networth-hero"><div className="flex items-center gap-3"><span className="icon-chip h-11 w-11"><Landmark className="h-5 w-5" /></span><div><p className="text-sm font-medium text-gray-500">Total balance {converted ? `· converted to ${displayCurrency}` : ""}</p><p className="text-3xl font-bold tracking-tight text-gray-100 tnum">{formatCurrency(total, displayCurrency)}</p></div><span className="pill ml-auto">{accounts.length} accounts</span></div></div>
    <StatementImporter accounts={accounts} transactions={transactions} />
    <AccountsManager items={accounts} />
  </div>;
}
