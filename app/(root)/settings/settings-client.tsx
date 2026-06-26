"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { Settings, Check, X, ExternalLink } from "lucide-react";
import { saveUserPreferences } from "./settings.actions";

interface SettingsClientProps {
  user: { id: string; name: string; email: string };
  zerodhaConnected: boolean;
  alpacaConfigured: boolean;
  prefs: {
    whatsappNumber: string | null;
    whatsappAlertsEnabled: boolean;
    emailAlertsEnabled: boolean;
  };
  successMessage?: string;
  errorMessage?: string;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
      ok ? "bg-green-500/20 text-green-400" : "bg-gray-800 text-gray-500"
    }`}>
      {ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {label}
    </div>
  );
}

export default function SettingsClient({
  user,
  zerodhaConnected,
  alpacaConfigured,
  prefs,
  successMessage,
  errorMessage,
}: SettingsClientProps) {
  const [phone, setPhone] = useState(prefs.whatsappNumber ?? "");
  const [waEnabled, setWaEnabled] = useState(prefs.whatsappAlertsEnabled);
  const [emailEnabled, setEmailEnabled] = useState(prefs.emailAlertsEnabled);
  const [isPending, startTransition] = useTransition();

  const savePrefs = () => {
    startTransition(async () => {
      const result = await saveUserPreferences({
        whatsappNumber: phone || null,
        whatsappAlertsEnabled: waEnabled,
        emailAlertsEnabled: emailEnabled,
      });
      if (result.success) {
        toast.success("Preferences saved.");
      } else {
        toast.error(result.error ?? "Failed to save.");
      }
    });
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex items-center gap-3">
        <span className="icon-chip h-11 w-11">
          <Settings className="h-5 w-5" />
        </span>
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Account, brokers and notifications.</p>
        </div>
      </div>

      {successMessage && (
        <div className="rounded-lg border border-green-700 bg-green-900/20 px-4 py-3 text-sm text-green-400">
          {successMessage === "zerodha_connected"
            ? "✓ Zerodha connected successfully."
            : successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="rounded-lg border border-red-700 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {errorMessage === "zerodha_auth_failed"
            ? "Zerodha authentication failed. Please try again."
            : errorMessage}
        </div>
      )}

      {/* Account */}
      <section className="panel p-6 flex flex-col gap-4">
        <h2 className="text-base font-semibold text-gray-100">Account</h2>
        <div className="grid grid-cols-2 gap-y-3 text-sm">
          <span className="text-gray-500">Name</span>
          <span className="text-gray-200">{user.name}</span>
          <span className="text-gray-500">Email</span>
          <span className="text-gray-200">{user.email}</span>
        </div>
      </section>

      {/* Broker Connections */}
      <section className="panel p-6 flex flex-col gap-5">
        <h2 className="text-base font-semibold text-gray-100">Broker Connections</h2>

        <div className="flex flex-col gap-4">
          {/* Zerodha */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-200">Zerodha (India — NSE/BSE)</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Connects via KiteConnect OAuth. Token refreshes daily.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge ok={zerodhaConnected} label={zerodhaConnected ? "Connected" : "Disconnected"} />
              {!zerodhaConnected ? (
                <Link
                  href="/api/zerodha/connect"
                  className="rounded-md border border-yellow-600 px-3 py-1.5 text-xs font-medium text-yellow-400 hover:bg-yellow-500/10 transition-colors"
                >
                  Connect
                </Link>
              ) : (
                <Link
                  href="/api/zerodha/disconnect"
                  className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-medium text-gray-500 hover:border-red-700 hover:text-red-400 transition-colors"
                >
                  Disconnect
                </Link>
              )}
            </div>
          </div>

          {/* Alpaca */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-200">Alpaca (Global — NYSE/NASDAQ)</p>
              <p className="text-xs text-gray-500 mt-0.5">
                Set <code className="text-yellow-600">ALPACA_API_KEY</code> +{" "}
                <code className="text-yellow-600">ALPACA_API_SECRET</code> in your .env file.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge ok={alpacaConfigured} label={alpacaConfigured ? "Configured" : "Not set"} />
              <a
                href="https://alpaca.markets"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-yellow-400 transition-colors"
              >
                Get keys <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Notification Preferences */}
      <section className="panel p-6 flex flex-col gap-5">
        <h2 className="text-base font-semibold text-gray-100">Notifications</h2>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-gray-300">WhatsApp Number</span>
          <span className="text-xs text-gray-500">Include country code, e.g. +919876543210</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+919876543210"
            className="mt-1 rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-yellow-500"
            suppressHydrationWarning
          />
        </label>

        <div className="flex flex-col gap-3">
          <Toggle
            label="WhatsApp Alerts"
            sub="Receive price and signal alerts via WhatsApp"
            checked={waEnabled}
            onChange={setWaEnabled}
          />
          <Toggle
            label="Email Alerts"
            sub="Receive daily news summaries and price alerts via email"
            checked={emailEnabled}
            onChange={setEmailEnabled}
          />
        </div>

        <button
          onClick={savePrefs}
          disabled={isPending}
          className="rounded-md bg-yellow-500/10 border border-yellow-600 py-2.5 text-sm font-semibold text-yellow-400 hover:bg-yellow-500/20 transition-colors disabled:opacity-50"
          suppressHydrationWarning
        >
          {isPending ? "Saving…" : "Save Preferences"}
        </button>
      </section>
    </div>
  );
}

function Toggle({
  label,
  sub,
  checked,
  onChange,
}: {
  label: string;
  sub: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-200">{label}</p>
        <p className="text-xs text-gray-500">{sub}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? "bg-yellow-500" : "bg-gray-700"
        }`}
        suppressHydrationWarning
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
