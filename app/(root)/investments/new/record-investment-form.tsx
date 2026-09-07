"use client";

import * as React from "react";
import { ReceiptText } from "lucide-react";
import type { CatalogInstrumentType } from "@/domain/instrument-catalog";
import type { InstrumentKind } from "@/domain/instruments";
import { kindLabel } from "@/domain/asset-groups";
import { Field } from "@/ui/primitives";
import { PlatformSelect, type PlatformOption } from "../platform-select";
import { recordInvestmentEntryAction, type InvestmentEntryActionState } from "../catalog-actions";
import InstrumentSearch, { type ConfirmedInstrument } from "./instrument-search";

export interface AccountOption {
  id: string;
  label: string;
}

const CATALOG_KIND: Readonly<Record<CatalogInstrumentType, InstrumentKind>> = {
  EQUITY: "LISTED_EQUITY",
  ETF: "ETF",
  MUTUAL_FUND: "MUTUAL_FUND",
  BOND: "BOND",
  GOVT_SECURITY: "GOVT_SECURITY",
  REIT: "REIT",
  DERIVATIVE: "FUTURE",
  OTHER: "LISTED_EQUITY",
};

const MANUAL_KINDS: readonly InstrumentKind[] = [
  "LISTED_EQUITY",
  "ETF",
  "INDEX_FUND",
  "MUTUAL_FUND",
  "LIQUID_FUND",
  "DEBT_FUND",
  "ELSS_FUND",
  "BOND",
  "GOVT_SECURITY",
  "SOVEREIGN_GOLD_BOND",
  "REIT",
  "CRYPTO",
];

export default function RecordInvestmentForm({
  accounts,
  platforms,
  defaultDate,
}: {
  accounts: readonly AccountOption[];
  platforms: readonly PlatformOption[];
  defaultDate: string;
}) {
  const [state, action, pending] = React.useActionState<InvestmentEntryActionState | null, FormData>(
    recordInvestmentEntryAction,
    null,
  );
  const [selection, setSelection] = React.useState<ConfirmedInstrument | null>(null);
  const [side, setSide] = React.useState<"BUY" | "SELL">("BUY");
  const [quantity, setQuantity] = React.useState("");
  const [unitPrice, setUnitPrice] = React.useState("");
  const [brokerage, setBrokerage] = React.useState("");
  const [exchangeFees, setExchangeFees] = React.useState("");
  const [statutoryCharges, setStatutoryCharges] = React.useState("");
  const [taxWithheld, setTaxWithheld] = React.useState("");
  const [manualKind, setManualKind] = React.useState<InstrumentKind>("LISTED_EQUITY");
  const errors = state?.fieldErrors ?? {};
  const selected = selection?.candidate ?? null;
  const identityMode = selection?.mode ?? "MANUAL";
  const selectedKind = selected ? CATALOG_KIND[selected.instrumentType] : manualKind;
  const preview = cashPreviewFromStrings({ side, quantity, unitPrice, brokerage, exchangeFees, statutoryCharges, taxWithheld });

  return (
    <form action={action} className="space-y-6">
      <section aria-labelledby="instrument-identity-title" className="space-y-4">
        <h2 id="instrument-identity-title" className="text-base font-semibold text-gray-100">Instrument identity</h2>
        <InstrumentSearch onConfirm={setSelection} />

        <input type="hidden" name="identityMode" value={identityMode} />
        <input type="hidden" name="selectionConfirmed" value={selection ? "yes" : ""} />
        <input type="hidden" name="catalogQuery" value={selection?.query ?? ""} />
        <input type="hidden" name="catalogInstrumentId" value={selected?.catalogInstrumentId ?? ""} />
        <input type="hidden" name="listingId" value={selected?.listing.id ?? ""} />

        {selected ? (
          <div className="rounded-lg border border-green-500/30 bg-green-500/[0.05] p-4">
            <p className="text-sm font-medium text-gray-100">{selected.listing.symbol}</p>
            <p className="mt-1 text-xs text-gray-400">{selected.name}</p>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
              <div><dt className="text-gray-500">Exchange</dt><dd className="text-gray-200">{selected.listing.exchange}</dd></div>
              <div><dt className="text-gray-500">Type</dt><dd className="text-gray-200">{selected.instrumentType}</dd></div>
              <div><dt className="text-gray-500">Currency</dt><dd className="text-gray-200">{selected.listing.currency}</dd></div>
              <div><dt className="text-gray-500">Provider</dt><dd className="text-gray-200">{preferredProvider(selected.providerMappings)}</dd></div>
            </dl>
          </div>
        ) : selection?.mode === "MANUAL" ? (
          <div className="grid gap-4 md:grid-cols-3">
            <Field name="symbol" label="Symbol" required error={errors.symbol?.[0]}>
              {(props) => <input {...props} name="symbol" className="form-input" maxLength={40} required />}
            </Field>
            <Field name="name" label="Name" required error={errors.name?.[0]}>
              {(props) => <input {...props} name="name" className="form-input" maxLength={160} required />}
            </Field>
            <Field name="kind" label="Investment type" required error={errors.kind?.[0]}>
              {(props) => (
                <select {...props} name="kind" className="form-input" value={manualKind} onChange={(event) => setManualKind(event.target.value as InstrumentKind)}>
                  {MANUAL_KINDS.map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}
                </select>
              )}
            </Field>
            <Field name="isin" label="ISIN" error={errors.isin?.[0]}>
              {(props) => <input {...props} name="isin" className="form-input" maxLength={12} placeholder="INE009A01021" />}
            </Field>
            <Field name="exchange" label="Exchange" error={errors.exchange?.[0]}>
              {(props) => <input {...props} name="exchange" className="form-input" maxLength={16} placeholder="NSE" />}
            </Field>
            <Field name="currency" label="Currency" required error={errors.currency?.[0]}>
              {(props) => (
                <select {...props} name="currency" className="form-input" defaultValue="INR">
                  <option value="INR">INR</option>
                  <option value="USD">USD</option>
                </select>
              )}
            </Field>
          </div>
        ) : (
          <p className="rounded-lg border border-gray-600/70 p-3 text-sm text-gray-500">
            Confirm a catalogue result or choose manual entry.
          </p>
        )}

        {selected && (
          <>
            <input type="hidden" name="symbol" value={selected.listing.symbol} />
            <input type="hidden" name="name" value={selected.name} />
            <input type="hidden" name="kind" value={selectedKind} />
            <input type="hidden" name="isin" value={selected.isin ?? ""} />
            <input type="hidden" name="exchange" value={selected.listing.exchange} />
            <input type="hidden" name="currency" value={selected.listing.currency} />
          </>
        )}
      </section>

      <section aria-labelledby="trade-entry-title" className="grid gap-4 border-t border-gray-600 pt-5 md:grid-cols-4">
        <div className="md:col-span-4 flex items-center gap-2">
          <ReceiptText className="size-4 text-gray-500" aria-hidden />
          <h2 id="trade-entry-title" className="text-base font-semibold text-gray-100">Trade details</h2>
        </div>

        <Field name="side" label="Side" required error={errors.side?.[0]}>
          {(props) => (
            <select {...props} name="side" className="form-input" value={side} onChange={(event) => setSide(event.target.value as "BUY" | "SELL")}>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>
          )}
        </Field>
        <Field name="tradedOn" label="Trade date" required error={errors.tradedOn?.[0]}>
          {(props) => <input {...props} name="tradedOn" type="date" className="form-input" defaultValue={defaultDate} required />}
        </Field>
        <Field name="quantity" label="Quantity" required error={errors.quantity?.[0]}>
          {(props) => <input {...props} name="quantity" className="form-input tnum" inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />}
        </Field>
        <Field name="unitPrice" label="Execution price per unit" required error={errors.unitPrice?.[0]}>
          {(props) => <input {...props} name="unitPrice" className="form-input tnum" inputMode="decimal" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} required />}
        </Field>

        <Field name="settlementAccountId" label={side === "BUY" ? "Paid from" : "Proceeds to"} required error={errors.settlementAccountId?.[0]}>
          {(props) => (
            <select {...props} name="settlementAccountId" className="form-input" required defaultValue="">
              <option value="" disabled>Choose an account</option>
              {accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
            </select>
          )}
        </Field>
        <PlatformSelect platforms={platforms} instrumentKind={selectedKind} error={errors.institutionId?.[0] ?? errors.newPlatformName?.[0]} />

        <Field name="brokerage" label="Brokerage" error={errors.brokerage?.[0]}>
          {(props) => <input {...props} name="brokerage" className="form-input tnum" inputMode="decimal" placeholder="0.00" value={brokerage} onChange={(event) => setBrokerage(event.target.value)} />}
        </Field>
        <Field name="exchangeFees" label="Exchange fees" error={errors.exchangeFees?.[0]}>
          {(props) => <input {...props} name="exchangeFees" className="form-input tnum" inputMode="decimal" placeholder="0.00" value={exchangeFees} onChange={(event) => setExchangeFees(event.target.value)} />}
        </Field>
        <Field name="statutoryCharges" label="STT, GST and stamp" error={errors.statutoryCharges?.[0]}>
          {(props) => <input {...props} name="statutoryCharges" className="form-input tnum" inputMode="decimal" placeholder="0.00" value={statutoryCharges} onChange={(event) => setStatutoryCharges(event.target.value)} />}
        </Field>
        <Field name="taxWithheld" label="Tax withheld" error={errors.taxWithheld?.[0]}>
          {(props) => <input {...props} name="taxWithheld" className="form-input tnum" inputMode="decimal" placeholder="0.00" value={taxWithheld} onChange={(event) => setTaxWithheld(event.target.value)} />}
        </Field>

        {side === "SELL" && (
          <>
            <Field name="deductibleCharges" label="Deductible charges" hint="STT and tax withheld are usually not deductible." error={errors.deductibleCharges?.[0]}>
              {(props) => <input {...props} name="deductibleCharges" className="form-input tnum" inputMode="decimal" placeholder="0.00" />}
            </Field>
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
          </>
        )}

        <div className="rounded-lg border border-gray-600/70 p-4 md:col-span-4">
          <p className="metric-label">Signed cash impact</p>
          <p className={preview.ok ? "tnum mt-1 text-2xl font-semibold text-gray-100" : "mt-1 text-sm text-red-500"}>
            {preview.ok ? preview.display : preview.message}
          </p>
        </div>

        <div className="md:col-span-4 flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-glow" disabled={pending || !selection || accounts.length === 0}>
            {pending ? "Recording..." : "Record investment"}
          </button>
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

export function cashPreviewFromStrings(input: {
  side: "BUY" | "SELL";
  quantity: string;
  unitPrice: string;
  brokerage?: string;
  exchangeFees?: string;
  statutoryCharges?: string;
  taxWithheld?: string;
}): { ok: true; display: string } | { ok: false; message: string } {
  if (!/^\d+(\.\d{1,8})?$/.test(input.quantity) || !/^\d+(\.\d{1,2})?$/.test(input.unitPrice)) {
    return { ok: false, message: "Enter quantity and price." };
  }
  const quantity = scaled(input.quantity, 8);
  const price = scaled(input.unitPrice, 2);
  if (quantity <= 0n || price <= 0n) return { ok: false, message: "Quantity and price must be positive." };
  const consideration = divideHalfUp(quantity * price, 100_000_000n);
  const costs =
    rupees(input.brokerage) +
    rupees(input.exchangeFees) +
    rupees(input.statutoryCharges) +
    rupees(input.taxWithheld);
  const signed = input.side === "BUY" ? -(consideration + costs) : consideration - costs;
  return { ok: true, display: `INR ${formatMinor(signed)}` };
}

function preferredProvider(mappings: readonly { provider: string; tradingSymbol: string }[]): string {
  const zerodha = mappings.find((mapping) => mapping.provider === "ZERODHA");
  const mapping = zerodha ?? mappings[0];
  return mapping ? `${mapping.provider} ${mapping.tradingSymbol}` : "None";
}

function rupees(value: string | undefined): bigint {
  if (!value) return 0n;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return 0n;
  return scaled(value, 2);
}

function scaled(value: string, decimals: number): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return remainder * 2n >= denominator ? quotient + 1n : quotient;
}

function formatMinor(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}
