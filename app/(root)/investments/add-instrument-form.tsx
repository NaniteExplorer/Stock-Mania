"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import type { InstrumentKind } from "@/domain/instruments";
import { ASSET_GROUPS, groupBlurb, groupLabel, kindLabel, kindsIn, type AssetGroup } from "@/domain/asset-groups";
import { hintsFor } from "@/ui/instrument-hints";
import { addInstrumentAction, type InvestingActionState } from "./actions";
import { PlatformSelect, type PlatformOption } from "./platform-select";

/**
 * Add an instrument.
 *
 * The kind list is the seventeen leaves, grouped into the categories a holder
 * thinks in — digital metals, not three unrelated rows for gold, silver and an
 * SGB — rather than a generic "stock / fund / other". The leaf is asked for
 * because it decides how the holding is taxed and whether it can be sold at all: a liquid fund is slab-taxed at any holding period, an ELSS is
 * locked for three years, an SGB is exempt at maturity, and F&O is not a capital
 * gain at all. Asking once, here, is what lets every later screen answer without
 * guessing.
 *
 * Some leaves carry facts of their own — an option's strike and expiry, what an
 * ETF holds — and those fields appear only for the kind that needs them. They are
 * not cosmetic: an option with no strike is refused by its own constructor,
 * because a half-specified derivative is not a derivative.
 */
export default function AddInstrumentForm({
  platforms = [],
}: {
  platforms?: readonly PlatformOption[];
}) {
  const [state, action, pending] = React.useActionState<InvestingActionState | null, FormData>(
    addInstrumentAction,
    null,
  );
  const errors = state?.fieldErrors ?? {};
  const [category, setCategory] = React.useState<AssetGroup>("EQUITY");
  const [kind, setKind] = React.useState<InstrumentKind>("LISTED_EQUITY");
  const [platformName, setPlatformName] = React.useState("");
  const [symbol, setSymbol] = React.useState("");
  const [name, setName] = React.useState("");
  /*
   * Placeholders and hints follow the chosen kind. They used to be the equity
   * ones for all seventeen — so "Digital gold" suggested an NSE ticker, an ISIN
   * and an AMFI scheme code, none of which exist for grams in a vault. The price
   * code is the field that matters: get it wrong and the holding never prices.
   */
  const hint = hintsFor(kind);
  const isOption = kind === "OPTION";
  const isFuture = kind === "FUTURE";
  const isContract = isOption || isFuture;
  const isDigitalMetal = kind === "DIGITAL_GOLD" || kind === "DIGITAL_SILVER" || kind === "DIGITAL_PLATINUM";
  const metalName = kindLabel(kind);
  const platformSlug = platformName.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toUpperCase();
  const automaticSymbol = `${kind === "DIGITAL_GOLD" ? "GOLD" : kind === "DIGITAL_SILVER" ? "SILVER" : "PLATINUM"}-${platformSlug || "HOLDING"}`;
  const automaticName = `${metalName} - ${platformName || "Unassigned platform"}`;

  return (
    <form action={action} className="grid gap-4 md:grid-cols-3">
      <div className="md:col-span-3 rounded-2xl border border-violet-500/25 bg-violet-500/[0.04] p-4">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-full bg-violet-500 text-sm font-bold text-white">1</span>
          <div><h3 className="font-semibold text-gray-100">Choose the investment</h3><p className="text-xs text-gray-500">Start with a broad category, then choose the exact type.</p></div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field name="category" label="Investment category" hint={groupBlurb(category)}>
            {(props) => (
              <select {...props} name="category" className="form-input" value={category} onChange={(event) => {
                const next = event.target.value as AssetGroup;
                setCategory(next);
                setKind(kindsIn(next)[0]);
              }}>
                {ASSET_GROUPS.map((group) => <option key={group} value={group}>{groupLabel(group)}</option>)}
              </select>
            )}
          </Field>
          <Field name="kind" label="Investment type" required error={errors.kind?.[0]}>
            {(props) => (
              <select {...props} name="kind" className="form-input" value={kind} onChange={(event) => setKind(event.target.value as InstrumentKind)}>
                {kindsIn(category).map((item) => <option key={item} value={item}>{kindLabel(item)}</option>)}
              </select>
            )}
          </Field>
        </div>
      </div>
      <div className="md:col-span-3 grid gap-4 rounded-2xl border border-gray-600/70 p-4 md:grid-cols-2">
        <div className="md:col-span-2"><h3 className="font-semibold text-gray-100">2. Choose the platform</h3><p className="mt-1 text-xs text-gray-500">The app will create the holding name, symbol and pricing setup from this choice.</p></div>
        <PlatformSelect platforms={platforms} instrumentKind={kind} error={errors.institutionId?.[0] ?? errors.newPlatformName?.[0]} onPlatformNameChange={setPlatformName} />
      </div>
      <Field
        name="symbol"
        label="Symbol"
        required
        hint="Your own short name for it. The same asset on two platforms needs two — the app will qualify a clash for you."
        error={errors.symbol?.[0]}
      >
        {(props) => (
          <input {...props} name="symbol" className="form-input" placeholder={hint.symbol} value={isDigitalMetal ? automaticSymbol : symbol} onChange={(event) => setSymbol(event.target.value)} readOnly={isDigitalMetal} required />
        )}
      </Field>

      <Field name="name" label="Name" required error={errors.name?.[0]}>
        {(props) => (
          <input {...props} name="name" className="form-input" placeholder={hint.name} value={isDigitalMetal ? automaticName : name} onChange={(event) => setName(event.target.value)} readOnly={isDigitalMetal} required />
        )}
      </Field>

      <div className="hidden">
      <Field name="legacyKindPicker" label="Kind">
        {(props) => (
          <select
            {...props}
            name="legacyKindPicker"
            className="form-input"
            value={kind}
            onChange={(event) => setKind(event.target.value as InstrumentKind)}
          >
            <optgroup label="Equity">
              <option value="LISTED_EQUITY">Listed equity</option>
              <option value="ETF">ETF</option>
            </optgroup>
            <optgroup label="Mutual funds">
              <option value="INDEX_FUND">Index fund</option>
              <option value="MUTUAL_FUND">Mutual fund (equity)</option>
              <option value="ELSS_FUND">ELSS (3-year lock)</option>
              <option value="LIQUID_FUND">Liquid fund (slab-taxed)</option>
              <option value="DEBT_FUND">Debt fund (slab-taxed)</option>
            </optgroup>
            <optgroup label="Digital metals">
              <option value="DIGITAL_GOLD">Digital gold (grams)</option>
              <option value="DIGITAL_SILVER">Digital silver (grams)</option>
              <option value="DIGITAL_PLATINUM">Digital platinum (grams)</option>
              <option value="SOVEREIGN_GOLD_BOND">Sovereign gold bond</option>
            </optgroup>
            <optgroup label="Fixed income">
              <option value="BOND">Bond</option>
              <option value="GOVT_SECURITY">Government security</option>
            </optgroup>
            <optgroup label="Real estate">
              <option value="REIT">REIT</option>
            </optgroup>
            <optgroup label="Crypto">
              <option value="CRYPTO">Crypto (VDA)</option>
            </optgroup>
            <optgroup label="Derivatives">
              <option value="OPTION">Option (F&amp;O — business income)</option>
              <option value="FUTURE">Future (F&amp;O — business income)</option>
            </optgroup>
          </select>
        )}
      </Field>
      </div>

      <Field
        name="currency"
        label="Trading currency"
        required
        hint="Indian assets and metals use INR. Foreign shares normally use USD."
        error={errors.currency?.[0]}
      >
        {(props) => (
          <select {...props} name="currency" className="form-input" defaultValue="INR">
            <option value="INR">INR — Indian rupee</option>
            <option value="USD">USD — US dollar</option>
          </select>
        )}
      </Field>

      {/*
        * ISIN and exchange are hidden rather than disabled where they do not
        * exist. A vault holding has no ISIN and trades on no exchange, and an
        * empty box invites someone to find something to put in it.
        */}
      {hint.hasIsin && (
        <Field name="isin" label="ISIN" error={errors.isin?.[0]}>
          {(props) => (
            <input {...props} name="isin" className="form-input" maxLength={12} placeholder="INE009A01021" />
          )}
        </Field>
      )}

      {hint.hasExchange && (
        <Field name="exchange" label="Exchange" error={errors.exchange?.[0]}>
          {(props) => (
            <input {...props} name="exchange" className="form-input" placeholder={hint.exchange} />
          )}
        </Field>
      )}

      <Field
        name="quoteRef"
        label={isDigitalMetal ? "Pricing standard" : "Price source code"}
        hint={isDigitalMetal ? "Used automatically to refresh the market value. You can change purity where applicable." : hint.quoteHint}
        error={errors.quoteRef?.[0]}
      >
        {(props) => isDigitalMetal ? (
          <select {...props} name="quoteRef" className="form-input" key={kind} defaultValue={hint.quoteRef}>
            {kind === "DIGITAL_GOLD" && <option key="gold-999" value="GOLD999">24K gold (99.9% purity)</option>}
            {kind === "DIGITAL_GOLD" && <option key="gold-995" value="GOLD995">22K gold (99.5% benchmark)</option>}
            {kind === "DIGITAL_SILVER" && <option key="silver-999" value="SILVER999">Fine silver (99.9% purity)</option>}
            {kind === "DIGITAL_PLATINUM" && <option key="platinum-999" value="PLATINUM999">Fine platinum (99.9% purity)</option>}
          </select>
        ) : (
          <input
            {...props}
            name="quoteRef"
            className="form-input"
            key={kind}
            defaultValue={hint.quoteRef}
          />
        )}
      </Field>

      {hint.tax && (
        <p className="md:col-span-3 rounded-xl border border-gray-600 px-3 py-2 text-xs text-gray-400">
          <span className="font-medium text-gray-300">How this is taxed. </span>
          {hint.tax}
        </p>
      )}

      {kind === "ETF" && (
        <Field
          name="underlying"
          label="What the ETF holds"
          hint="Gold ETFs changed tax class in the 2023 budget, so this is not cosmetic."
          error={errors.underlying?.[0]}
        >
          {(props) => (
            <select {...props} name="underlying" className="form-input" defaultValue="EQUITY">
              <option value="EQUITY">Equity</option>
              <option value="DEBT">Debt (slab-taxed)</option>
              <option value="GOLD">Gold</option>
            </select>
          )}
        </Field>
      )}

      {kind === "DEBT_FUND" && (
        <label className="flex items-center gap-2 text-sm text-gray-300 md:col-span-3">
          <input type="checkbox" name="legacyUnits" className="h-4 w-4" />
          These units were bought before 1 April 2023 (they keep indexation and the 20% long-term rate)
        </label>
      )}

      {isContract && (
        <>
          <Field
            name="underlyingSymbol"
            label="Underlying"
            required
            hint="The index or share the contract is on."
            error={errors.underlyingSymbol?.[0]}
          >
            {(props) => (
              <input {...props} name="underlyingSymbol" className="form-input" placeholder="NIFTY" required />
            )}
          </Field>

          <Field name="expiry" label="Expiry" required error={errors.expiry?.[0]}>
            {(props) => <input {...props} name="expiry" type="date" className="form-input" required />}
          </Field>

          <Field
            name="lotSize"
            label="Lot size"
            required
            hint="Units of the underlying per lot. A quantity of 1 is one lot, not one share."
            error={errors.lotSize?.[0]}
          >
            {(props) => (
              <input
                {...props}
                name="lotSize"
                className="form-input tnum"
                inputMode="numeric"
                placeholder="75"
                required
              />
            )}
          </Field>
        </>
      )}

      {isOption && (
        <>
          <Field name="right" label="Call or put" required error={errors.right?.[0]}>
            {(props) => (
              <select {...props} name="right" className="form-input" defaultValue="CALL">
                <option value="CALL">Call</option>
                <option value="PUT">Put</option>
              </select>
            )}
          </Field>

          <Field name="strike" label="Strike" required error={errors.strike?.[0]}>
            {(props) => (
              <input
                {...props}
                name="strike"
                className="form-input tnum"
                inputMode="decimal"
                placeholder="24000.00"
                required
              />
            )}
          </Field>
        </>
      )}

      {isFuture && (
        <Field
          name="contractMonth"
          label="Contract month"
          hint="Which monthly series, for rolling a position. Taken from the expiry when blank."
          error={errors.contractMonth?.[0]}
        >
          {(props) => (
            <input {...props} name="contractMonth" className="form-input tnum" placeholder="2026-09" />
          )}
        </Field>
      )}

      {isContract && (
        <p className="md:col-span-3 text-xs text-amber-500">
          F&amp;O is taxed as non-speculative business income at your slab rate, and its
          losses cannot be set off against capital gains. Set your marginal rate on
          Settings, or the report assumes the top slab.
        </p>
      )}

      <div className="md:col-span-3 flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-glow" disabled={pending}>
          {pending ? "Adding…" : "Add instrument"}
        </button>
        {state && (
          <p className={state.ok ? "text-sm text-green-500" : "text-sm text-red-500"} role="status">
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
