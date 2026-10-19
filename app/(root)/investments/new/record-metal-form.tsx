"use client";

/**
 * Buying and selling vaulted metal, which is not a trade with the ticker filed
 * off.
 *
 * Three differences drive the whole form. There is nothing to search for, so
 * identity is chosen (metal, purity, platform) rather than found. The receipt
 * states a rupee total and the grams it bought, not a rate — the rate between
 * them runs past the two decimals a price can hold — so the amount is what is
 * asked for and the rate is shown back, derived. And no verified charge
 * schedule exists for bullion apps, so this lane offers no estimate and no
 * delivery/intraday segment: it asks for what the receipt shows and no more.
 *
 * It posts to the same action as the listed lane and books lots exactly as a
 * share purchase does, with one deliberate difference: **there is no funding
 * account**. Metal is usually bought with a tap in a bullion app, from money
 * that was never a row here, so asking which tracked account paid for it was a
 * question with no honest answer. The cash leg posts to Equity: Opening
 * Balances instead — see `resolveSettlement` in `catalog-actions.ts` for what
 * that means and what it costs.
 */

import * as React from "react";
import { Coins } from "lucide-react";
import { Field } from "@/ui/primitives";
import { PlatformSelect, type PlatformOption } from "../platform-select";
import { recordInvestmentEntryAction, type InvestmentEntryActionState } from "../catalog-actions";
import type { AccountOption } from "./record-investment-form";
import {
  METAL_LANES,
  formatMinor,
  metalDisplayName,
  metalLane,
  metalPricing,
  type MetalKind,
} from "./metal-identity";

export default function RecordMetalForm({
  accounts,
  platforms,
  defaultDate,
  defaultKind = "DIGITAL_GOLD",
}: {
  accounts: readonly AccountOption[];
  platforms: readonly PlatformOption[];
  defaultDate: string;
  defaultKind?: MetalKind;
}) {
  const [state, action, pending] = React.useActionState<InvestmentEntryActionState | null, FormData>(
    recordInvestmentEntryAction,
    null,
  );
  const [kind, setKind] = React.useState<MetalKind>(defaultKind);
  const [purity, setPurity] = React.useState<string>(metalLane(defaultKind).purities[0].slug);
  const [side, setSide] = React.useState<"BUY" | "SELL">("BUY");
  const [tradedOn, setTradedOn] = React.useState(defaultDate);
  const [grams, setGrams] = React.useState("");
  const [totalAmount, setTotalAmount] = React.useState("");
  const [platformCharges, setPlatformCharges] = React.useState("");
  const [gst, setGst] = React.useState("");
  const [platformName, setPlatformName] = React.useState("");

  const lane = metalLane(kind);
  const errors = state?.fieldErrors ?? {};
  const name = metalDisplayName(kind, platformName);
  /* The same helper the action derives the stored rate with, so the figure on
     screen is the figure that gets booked. */
  const preview = metalPricing({
    side,
    grams,
    total: totalAmount,
    charges: [platformCharges, gst],
  });

  /*
   * The platform is the second half of the holding's identity, so it is a gate
   * rather than a hint: without it every vault's grams pile into one position.
   */
  const identified = platformName.trim() !== "";

  function chooseMetal(next: MetalKind) {
    setKind(next);
    setPurity(metalLane(next).purities[0].slug);
  }

  return (
    <form action={action} className="space-y-6">
      <section aria-labelledby="metal-identity-title" className="space-y-4">
        <div className="flex items-center gap-2">
          <Coins
            className={kind === "DIGITAL_GOLD" ? "size-4 text-yellow-500" : "size-4 text-gray-400"}
            aria-hidden
          />
          <h2 id="metal-identity-title" className="text-base font-semibold text-gray-100">
            What you bought
          </h2>
        </div>

        <div role="group" aria-label="Metal" className="flex flex-wrap gap-2">
          {METAL_LANES.map((option) => {
            const active = option.kind === kind;
            return (
              <button
                key={option.kind}
                type="button"
                aria-pressed={active}
                onClick={() => chooseMetal(option.kind)}
                className={
                  active
                    ? "focus-brand inline-flex h-10 items-center rounded-lg border border-brand-500 bg-brand-500/10 px-4 text-sm font-medium text-gray-100"
                    : "focus-brand inline-flex h-10 items-center rounded-lg border border-gray-600 px-4 text-sm text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-100"
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Field
            name="purity"
            label="Purity"
            required
            hint="Part of the holding's identity — 999 and 995 fine are different grams."
          >
            {(props) => (
              <select
                {...props}
                name="purity"
                className="form-input"
                value={purity}
                onChange={(event) => setPurity(event.target.value)}
              >
                {lane.purities.map((option) => (
                  <option key={option.slug} value={option.slug}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <PlatformSelect
            platforms={platforms}
            instrumentKind={kind}
            error={errors.institutionId?.[0] ?? errors.newPlatformName?.[0]}
            onPlatformNameChange={setPlatformName}
          />
        </div>

        <p
          className={
            identified
              ? "rounded-lg border border-green-500/30 bg-green-500/[0.05] p-3 text-xs text-gray-300"
              : "rounded-lg border border-gray-600/70 p-3 text-xs text-gray-500"
          }
          aria-live="polite"
        >
          {identified ? (
            <>
              Recording as <span className="text-gray-100">{name}</span>, priced from{" "}
              <span className="tnum text-gray-300">{purity}</span>. Grams on another platform stay a
              separate holding with its own cost base.
            </>
          ) : (
            "Choose the platform holding the metal — the vault, app or wallet. It is half of what makes this holding distinct."
          )}
        </p>

        <input type="hidden" name="identityMode" value="METAL" />
        <input type="hidden" name="selectionConfirmed" value={identified ? "yes" : ""} />
        <input type="hidden" name="symbol" value={purity} />
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="quoteRef" value={purity} />
        <input type="hidden" name="currency" value="INR" />
      </section>

      <section
        aria-labelledby="metal-entry-title"
        className="grid gap-4 border-t border-gray-600 pt-5 md:grid-cols-4"
      >
        <div className="md:col-span-4">
          <h2 id="metal-entry-title" className="text-base font-semibold text-gray-100">
            Purchase details
          </h2>
        </div>

        <Field name="side" label="Side" required error={errors.side?.[0]}>
          {(props) => (
            <select
              {...props}
              name="side"
              className="form-input"
              value={side}
              onChange={(event) => setSide(event.target.value as "BUY" | "SELL")}
            >
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>
          )}
        </Field>
        <Field name="tradedOn" label="Date" required error={errors.tradedOn?.[0]}>
          {(props) => (
            <input
              {...props}
              name="tradedOn"
              type="date"
              className="form-input"
              value={tradedOn}
              onChange={(event) => setTradedOn(event.target.value)}
              required
            />
          )}
        </Field>
        <Field
          name="quantity"
          label="Grams"
          required
          hint="The grams credited to the vault, to as many decimals as the receipt shows."
          error={errors.quantity?.[0]}
        >
          {(props) => (
            <input
              {...props}
              name="quantity"
              className="form-input tnum"
              inputMode="decimal"
              placeholder="0.0000"
              value={grams}
              onChange={(event) => setGrams(event.target.value)}
              required
            />
          )}
        </Field>
        <Field
          name="totalAmount"
          label={side === "BUY" ? "Total paid (INR)" : "Total received (INR)"}
          required
          hint="The rupee total on the receipt — what actually changed hands, charges included. Not the rate per gram: that is worked out from this and the grams."
          error={errors.totalAmount?.[0]}
        >
          {(props) => (
            <input
              {...props}
              name="totalAmount"
              className="form-input tnum"
              inputMode="decimal"
              placeholder="0.00"
              value={totalAmount}
              onChange={(event) => setTotalAmount(event.target.value)}
              required
            />
          )}
        </Field>

        {/*
          * Buying asks for no account; selling has to. There is no inverse of an
          * opening position — grams do not leave the books into nowhere — so the
          * proceeds need a real destination, and the asymmetry is deliberate.
          */}
        {side === "SELL" && (
          <Field
            name="settlementAccountId"
            label="Proceeds to"
            required
            hint="Where the sale money landed."
            error={errors.settlementAccountId?.[0]}
          >
            {(props) => (
              <select {...props} name="settlementAccountId" className="form-input" required defaultValue="">
                <option value="" disabled>
                  Choose an account
                </option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}

        <Field
          name="exchangeFees"
          label="Platform charges"
          hint="Vault, storage or spread fees billed separately."
          error={errors.exchangeFees?.[0]}
        >
          {(props) => (
            <input
              {...props}
              name="exchangeFees"
              className="form-input tnum"
              inputMode="decimal"
              placeholder="0.00"
              value={platformCharges}
              onChange={(event) => setPlatformCharges(event.target.value)}
            />
          )}
        </Field>
        <Field
          name="statutoryCharges"
          label="GST"
          hint="Charged on most bullion apps. Enter the amount on the receipt."
          error={errors.statutoryCharges?.[0]}
        >
          {(props) => (
            <input
              {...props}
              name="statutoryCharges"
              className="form-input tnum"
              inputMode="decimal"
              placeholder="0.00"
              value={gst}
              onChange={(event) => setGst(event.target.value)}
            />
          )}
        </Field>

        {side === "SELL" && (
          <Field name="method" label="Lot method">
            {(props) => (
              <select {...props} name="method" className="form-input" defaultValue="FIFO">
                <option value="FIFO">FIFO</option>
                <option value="LIFO">LIFO</option>
                <option value="HIFO">HIFO</option>
                <option value="AVERAGE_COST">Average cost</option>
                <option value="SPECIFIC_ID">Specific lots</option>
              </select>
            )}
          </Field>
        )}

        <div className="rounded-lg border border-gray-600/70 p-4 md:col-span-4" aria-live="polite">
          <p className="metric-label">Signed cash impact</p>
          <p
            className={
              preview.ok ? "tnum mt-1 text-2xl font-semibold text-gray-100" : "mt-1 text-sm text-red-500"
            }
          >
            {preview.ok ? `INR ${formatMinor(preview.value.signedMinor)}` : preview.message}
          </p>
          {preview.ok && (
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">{lane.label} itself, charges excluded</dt>
                <dd className="tnum text-gray-200">INR {formatMinor(preview.value.considerationMinor)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Works out at, per gram</dt>
                <dd className="tnum text-gray-200">INR {formatMinor(preview.value.ratePerGramMinor)}</dd>
              </div>
            </dl>
          )}
          <p className="mt-2 text-xs text-gray-500">
            No verified charge schedule exists for bullion platforms, so nothing is estimated here —
            the fields above are what is saved. On a sale, platform fees and GST are treated as
            transfer expenses and deducted from the consideration in full.
          </p>
          {side === "BUY" && (
            <p className="mt-2 text-xs text-amber-300">
              This does not move money out of any account. The grams enter the books as an opening
              position, so if the rupees did leave a tracked account, record that payment separately
              — otherwise the same money is counted once as cash and once as metal.
            </p>
          )}
        </div>

        <div className="md:col-span-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="btn-glow"
            disabled={
              pending || !identified || !preview.ok || (side === "SELL" && accounts.length === 0)
            }
          >
            {pending ? "Recording..." : `Record ${lane.noun}`}
          </button>
          {!preview.ok && identified && (
            <p className="text-xs text-gray-500">{preview.message}</p>
          )}
          {state && (
            <p className={state.ok ? "text-sm text-green-500" : "text-sm text-red-500"} role="status">
              {state.message}
            </p>
          )}
        </div>
      </section>
    </form>
  );
}
