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
import { Input } from "../../../../components/ui/input";
import { NativeSelect } from "../../../../components/ui/native-select";
import { FormField as Field } from "../[instrumentId]/form-field";

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
            className={kind === "DIGITAL_GOLD" ? "size-4 text-(--warn)" : "size-4 text-(--fg-secondary)"}
            aria-hidden
         />
          <h2 id="metal-identity-title" className="text-base font-semibold text-(--fg)">
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
                    ? "focus-brand inline-flex h-10 items-center rounded-lg border border-brand-500 bg-brand-500/10 px-4 text-sm font-medium text-(--fg)"
                    : "focus-brand inline-flex h-10 items-center rounded-lg border border-(--border) px-4 text-sm text-(--fg-secondary) transition-colors hover:border-(--border-control) hover:text-(--fg)"
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
              <NativeSelect
                {...props}
                name="purity"
                
               value={purity}
                onChange={(event) => setPurity(event.target.value)}
              >
                {lane.purities.map((option) => (
                  <option key={option.slug} value={option.slug}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
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
              ? "rounded-lg border border-(--gain)/30 bg-(--gain)/[0.05] p-3 text-xs text-(--fg-secondary)"
              : "rounded-lg border border-(--border)/70 p-3 text-xs text-(--fg-muted)"
          }
          aria-live="polite"
        >
          {identified ? (
            <>
              Recording as <span className="text-(--fg)">{name}</span>, priced from{" "}
              <span className="tnum text-(--fg-secondary)">{purity}</span>. Grams on another platform stay a
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
        className="grid gap-4 border-t border-(--border) pt-5 md:grid-cols-4"
      >
        <div className="md:col-span-4">
          <h2 id="metal-entry-title" className="text-base font-semibold text-(--fg)">
            Purchase details
          </h2>
        </div>

        <Field name="side" label="Side" required error={errors.side?.[0]}>
          {(props) => (
            <NativeSelect
              {...props}
              name="side"
              
             value={side}
              onChange={(event) => setSide(event.target.value as "BUY" | "SELL")}
            >
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </NativeSelect>
          )}
        </Field>
        <Field name="tradedOn" label="Date" required error={errors.tradedOn?.[0]}>
          {(props) => (
            <Input
              {...props}
              name="tradedOn"
              type="date"
              
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
            <Input
              {...props}
              name="quantity"
              className="tnum"
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
            <Input
              {...props}
              name="totalAmount"
              className="tnum"
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
              <NativeSelect {...props} name="settlementAccountId" required defaultValue="">
                <option value="" disabled>
                  Choose an account
                </option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </NativeSelect>
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
            <Input
              {...props}
              name="exchangeFees"
              className="tnum"
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
            <Input
              {...props}
              name="statutoryCharges"
              className="tnum"
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
              <NativeSelect {...props} name="method" defaultValue="FIFO">
                <option value="FIFO">FIFO</option>
                <option value="LIFO">LIFO</option>
                <option value="HIFO">HIFO</option>
                <option value="AVERAGE_COST">Average cost</option>
                <option value="SPECIFIC_ID">Specific lots</option>
              </NativeSelect>
            )}
          </Field>
        )}

        <div className="rounded-lg border border-(--border)/70 p-4 md:col-span-4" aria-live="polite">
          <p className="text-xs font-medium text-(--fg-muted)">Signed cash impact</p>
          <p
            className={
              preview.ok ? "tnum mt-1 text-2xl font-semibold text-(--fg)" : "mt-1 text-sm text-(--loss)"
            }
          >
            {preview.ok ? `INR ${formatMinor(preview.value.signedMinor)}` : preview.message}
          </p>
          {preview.ok && (
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div className="flex justify-between gap-3">
                <dt className="text-(--fg-muted)">{lane.label} itself, charges excluded</dt>
                <dd className="tnum text-(--fg)">INR {formatMinor(preview.value.considerationMinor)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-(--fg-muted)">Works out at, per gram</dt>
                <dd className="tnum text-(--fg)">INR {formatMinor(preview.value.ratePerGramMinor)}</dd>
              </div>
            </dl>
          )}
          <p className="mt-2 text-xs text-(--fg-muted)">
            No verified charge schedule exists for bullion platforms, so nothing is estimated here —
            the fields above are what is saved. On a sale, platform fees and GST are treated as
            transfer expenses and deducted from the consideration in full.
          </p>
          {side === "BUY" && (
            <p className="mt-2 text-xs text-(--warn)">
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
            <p className="text-xs text-(--fg-muted)">{preview.message}</p>
          )}
          {state && (
            <p className={state.ok ? "text-sm text-(--gain)" : "text-sm text-(--loss)"} role="status">
              {state.message}
            </p>
          )}
        </div>
      </section>
    </form>
  );
}
