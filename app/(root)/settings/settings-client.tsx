"use client";

import { useState, useTransition } from "react";
import { Coins, Settings } from "lucide-react";
import { toast } from "sonner";
import { saveUserPreferences } from "./settings.actions";
import { SUPPORTED_CURRENCIES } from "@/lib/currencies";

export default function SettingsClient({ user, displayCurrency: initialCurrency }: {
  user: { name: string; email: string };
  displayCurrency: string;
}) {
  const [displayCurrency, setDisplayCurrency] = useState(initialCurrency);
  const [pending, startTransition] = useTransition();
  const save = () => startTransition(async () => {
    const result = await saveUserPreferences({ displayCurrency });
    if (result.success) toast.success("Preferences saved");
    else toast.error(result.error ?? "Failed to save");
  });
  return <div className="flex max-w-3xl flex-col gap-6">
    <div className="flex items-center gap-3"><span className="icon-chip h-11 w-11"><Settings className="h-5 w-5" /></span><div><h1 className="page-title">Settings</h1><p className="page-subtitle">A deliberately small, manual-first setup.</p></div></div>
    <section className="panel p-6"><h2 className="font-semibold text-gray-100">Account</h2><dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><dt className="text-gray-500">Name</dt><dd className="text-gray-200">{user.name}</dd><dt className="text-gray-500">Email</dt><dd className="text-gray-200">{user.email}</dd></dl></section>
    <section className="panel flex flex-col gap-4 p-6"><div className="flex items-center gap-3"><span className="icon-chip"><Coins className="h-5 w-5" /></span><div><h2 className="font-semibold text-gray-100">Display currency</h2><p className="text-xs text-gray-500">Monthly entries remain exactly as entered.</p></div></div><select value={displayCurrency} onChange={(e) => setDisplayCurrency(e.target.value)} className="select-trigger">{SUPPORTED_CURRENCIES.map((currency) => <option key={currency.code} value={currency.code}>{currency.symbol} · {currency.code} — {currency.name}</option>)}</select><button onClick={save} disabled={pending} className="btn-brand self-end px-6">{pending ? "Saving…" : "Save"}</button></section>
    <section className="rounded-xl border border-green-500/25 bg-green-500/10 p-4 text-sm text-green-300"><strong>Manual mode is active.</strong> No broker, mailbox, Drive, statement, or scheduled balance sync is connected.</section>
  </div>;
}
