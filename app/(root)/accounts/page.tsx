import type { Metadata } from "next";
import { getMyAccounts } from "@/features/accounts/account.actions";
import AccountsManager from "@/components/wealth/AccountsManager";
import { formatINR } from "@/lib/utils";
import { Landmark } from "lucide-react";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const accounts = await getMyAccounts();
  const total = accounts.reduce((s, a) => s + a.balance, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Accounts</h1>
          <p className="page-subtitle">Bank, cash and deposit balances.</p>
        </div>
      </div>

      <div className="networth-hero">
        <div className="flex items-center gap-3">
          <span className="icon-chip h-11 w-11">
            <Landmark className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-medium text-gray-500">Total balance</p>
            <p className="text-3xl font-bold tracking-tight text-gray-100 tnum">
              {formatINR(total)}
            </p>
          </div>
          <span className="pill ml-auto">{accounts.length} accounts</span>
        </div>
      </div>

      <AccountsManager items={accounts} />
    </div>
  );
}
