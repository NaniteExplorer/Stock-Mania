"use client";

import WealthManager, { type WealthField } from "@/components/wealth/WealthManager";
import ProviderMark from "@/components/wealth/ProviderMark";
import { createAccount, updateAccount, deleteAccount } from "@/features/accounts/account.actions";
import { ACCOUNT_TYPE_LABELS, type Account, type AccountType } from "@/features/accounts/account.types";
import { formatCurrency, SUPPORTED_CURRENCIES } from "@/lib/currencies";
import { findFinancialProvider } from "@/lib/financial-providers";

const fields: WealthField[] = [
  { name: "name", label: "Account name", type: "text", required: true, placeholder: "Salary account", half: true },
  { name: "institution", label: "Bank / institution", type: "provider", placeholder: "Search HDFC, SBI, UBS...", half: true },
  { name: "type", label: "Type", type: "select", half: true, options: Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => ({ value, label })) },
  { name: "last4", label: "Last 4 digits", type: "text", placeholder: "1234", half: true },
  { name: "currency", label: "Account currency", type: "select", half: true, options: SUPPORTED_CURRENCIES.map((currency) => ({ value: currency.code, label: `${currency.symbol} / ${currency.code} - ${currency.name}` })) },
  { name: "balance", label: "Current balance", type: "number", step: "0.01", required: true },
];

export default function AccountsManager({ items }: { items: Account[] }) {
  return (
    <WealthManager<Account>
      items={items}
      fields={fields}
      addLabel="Add account"
      dialogTitle="account"
      emptyTitle="No accounts yet"
      emptyDescription="Add a bank, card, cash, pension or deposit account to track it in your net worth."
      toValues={(account) => ({
        name: account.name,
        institution: account.institution,
        type: account.type,
        last4: account.last4 ?? "",
        currency: account.currency,
        balance: String(account.balance),
      })}
      onCreate={(values) => createAccount({
        name: values.name,
        institution: values.institution,
        providerId: findFinancialProvider(values.institution)?.id ?? null,
        type: values.type as AccountType,
        currency: values.currency,
        balance: Number(values.balance) || 0,
        last4: values.last4 || null,
      })}
      onUpdate={(id, values) => updateAccount(id, {
        name: values.name,
        institution: values.institution,
        providerId: findFinancialProvider(values.institution)?.id ?? null,
        type: values.type as AccountType,
        currency: values.currency,
        balance: Number(values.balance) || 0,
        last4: values.last4 || null,
      })}
      onDelete={deleteAccount}
      renderRow={(account) => (
        <div className="flex items-center gap-3">
          <ProviderMark providerId={account.providerId} institution={account.institution} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-100">{account.name}</p>
            <p className="truncate text-xs text-gray-500">
              {account.institution || ACCOUNT_TYPE_LABELS[account.type]}
              {account.last4 ? ` **${account.last4}` : ""} / {ACCOUNT_TYPE_LABELS[account.type]}
            </p>
          </div>
          <p className="ml-auto pr-2 text-sm font-bold text-gray-100 tnum">{formatCurrency(account.balance, account.currency, true)}</p>
        </div>
      )}
    />
  );
}
