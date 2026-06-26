"use client";

import { Landmark } from "lucide-react";
import WealthManager, { type WealthField } from "@/components/wealth/WealthManager";
import {
  createAccount,
  updateAccount,
  deleteAccount,
} from "@/features/accounts/account.actions";
import {
  ACCOUNT_TYPE_LABELS,
  type Account,
  type AccountType,
} from "@/features/accounts/account.types";
import { formatINRCompact } from "@/lib/utils";

const fields: WealthField[] = [
  { name: "name", label: "Account name", type: "text", required: true, placeholder: "Salary account", half: true },
  { name: "institution", label: "Bank / institution", type: "text", placeholder: "HDFC Bank", half: true },
  {
    name: "type",
    label: "Type",
    type: "select",
    half: true,
    options: Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  },
  { name: "last4", label: "Last 4 digits", type: "text", placeholder: "1234", half: true },
  { name: "balance", label: "Balance", type: "number", prefix: "₹", step: "0.01", required: true },
];

export default function AccountsManager({ items }: { items: Account[] }) {
  return (
    <WealthManager<Account>
      items={items}
      fields={fields}
      addLabel="Add account"
      dialogTitle="account"
      emptyTitle="No accounts yet"
      emptyDescription="Add your bank, cash and deposit balances to track them in your net worth."
      toValues={(a) => ({
        name: a.name,
        institution: a.institution,
        type: a.type,
        last4: a.last4 ?? "",
        balance: String(a.balance),
      })}
      onCreate={(v) =>
        createAccount({
          name: v.name,
          institution: v.institution,
          type: v.type as AccountType,
          balance: Number(v.balance) || 0,
          last4: v.last4 || null,
        })
      }
      onUpdate={(id, v) =>
        updateAccount(id, {
          name: v.name,
          institution: v.institution,
          type: v.type as AccountType,
          balance: Number(v.balance) || 0,
          last4: v.last4 || null,
        })
      }
      onDelete={deleteAccount}
      renderRow={(a) => (
        <div className="flex items-center gap-3">
          <span className="icon-chip">
            <Landmark className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-gray-100">{a.name}</p>
            <p className="truncate text-xs text-gray-500">
              {a.institution || ACCOUNT_TYPE_LABELS[a.type]}
              {a.last4 ? ` ••${a.last4}` : ""} · {ACCOUNT_TYPE_LABELS[a.type]}
            </p>
          </div>
          <p className="ml-auto pr-2 text-sm font-bold text-gray-100 tnum">
            {formatINRCompact(a.balance)}
          </p>
        </div>
      )}
    />
  );
}
