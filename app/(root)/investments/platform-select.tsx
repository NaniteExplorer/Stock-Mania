"use client";

import * as React from "react";
import { Field } from "@/ui/primitives";
import { groupOfKind, type AssetGroup } from "@/domain/asset-groups";
import type { InstrumentKind } from "@/domain/instruments";
import type { InstitutionKind } from "@/domain/institutions";
import { FINANCIAL_PROVIDERS } from "@/ui/providers";

export interface PlatformOption {
  id: string;
  name: string;
  kind: InstitutionKind;
}

/**
 * Which platform a holding sits on.
 *
 * A `<select>` rather than the free-text `ProviderPicker` the cash accounts use,
 * and the difference is not cosmetic: an instrument's platform is a foreign key,
 * so "Zerodha" and "zerodha " have to resolve to one row or the per-platform
 * profit-and-loss underneath it is arithmetic on a typo. The escape hatch is the
 * last option — type a name and the action registers it — so a platform nobody
 * has heard of is still a first-class row rather than an "Other" that loses it.
 *
 * The list narrows by what is being registered. Offering Zerodha for digital
 * gold, or a bullion vault for a share, is the kind of wrong-list that makes a
 * user pick the nearest wrong answer, and a wrong platform is worse than none —
 * it is a number attributed to a broker the holding was never on.
 */
export function PlatformSelect({
  platforms,
  instrumentKind,
  defaultValue = "",
  error,
  onPlatformNameChange,
}: {
  platforms: readonly PlatformOption[];
  /** Narrows the list; omit to offer everything. */
  instrumentKind?: InstrumentKind;
  defaultValue?: string;
  error?: string;
  onPlatformNameChange?: (name: string) => void;
}) {
  const [value, setValue] = React.useState(defaultValue);
  const isNew = value === NEW;

  const wanted = instrumentKind ? KINDS_FOR[groupOfKind(instrumentKind)] : null;
  const offered = wanted
    ? platforms.filter((platform) => wanted.includes(platform.kind))
    : platforms;
  const suggested = FINANCIAL_PROVIDERS.filter((provider) =>
    groupOfKind(instrumentKind ?? "LISTED_EQUITY") === "DIGITAL_METALS"
      ? provider.kind === "BULLION"
      : wanted?.includes(provider.kind as InstitutionKind),
  ).filter((provider) => !platforms.some((platform) => platform.name === provider.name));

  /*
   * A platform already chosen stays chosen even when the instrument kind moves
   * it out of the offered list — silently blanking a field the user filled in is
   * how a holding ends up unattributed.
   */
  const selected = platforms.find((platform) => platform.id === value);
  const list =
    selected && !offered.some((platform) => platform.id === selected.id)
      ? [selected, ...offered]
      : offered;

  return (
    <>
      <Field
        name="institutionId"
        label="Platform"
        hint="Where it is held — the broker, app or vault. Two platforms means two holdings."
        error={error}
      >
        {(props) => (
          <select
            {...props}
            name="institutionId"
            className="form-input"
            value={value}
            onChange={(event) => {
              const next = event.target.value;
              setValue(next);
              const existing = platforms.find((platform) => platform.id === next);
              onPlatformNameChange?.(
                existing?.name ?? (next.startsWith(SUGGESTED) ? next.slice(SUGGESTED.length) : ""),
              );
            }}
          >
            <option value="">Not recorded</option>
            {list.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {platform.name}
              </option>
            ))}
            {suggested.length > 0 && (
              <optgroup label="Popular platforms">
                {suggested.map((platform) => (
                  <option key={platform.id} value={`${SUGGESTED}${platform.name}`}>
                    {platform.name}
                  </option>
                ))}
              </optgroup>
            )}
            <option value={NEW}>Add a platform…</option>
          </select>
        )}
      </Field>

      {isNew && (
        <Field
          name="newPlatformName"
          label="New platform"
          required
          hint="Registered as you save, and offered on every later form."
        >
          {(props) => (
            <input
              {...props}
              name="newPlatformName"
              className="form-input"
              placeholder="Kuvera"
              maxLength={120}
              required
              onChange={(event) => onPlatformNameChange?.(event.target.value)}
            />
          )}
        </Field>
      )}
    </>
  );
}

/** The sentinel the action reads as "register the name in `newPlatformName`". */
export const NEW = "__new__";
export const SUGGESTED = "__suggested__:";

/**
 * Which sorts of organisation can hold which sorts of asset.
 *
 * Bullion vaults hold metal and nothing else; brokers hold everything listed.
 * Wallets appear on both sides because PhonePe and Paytm genuinely are both.
 */
const KINDS_FOR: Readonly<Record<AssetGroup, readonly InstitutionKind[]>> = {
  EQUITY: ["BROKER", "BANK", "WALLET", "OTHER"],
  FUNDS: ["BROKER", "BANK", "WALLET", "SCHEME", "OTHER"],
  FIXED_INCOME: ["BROKER", "BANK", "SCHEME", "OTHER"],
  DIGITAL_METALS: ["BULLION", "WALLET", "BROKER", "OTHER"],
  REAL_ESTATE: ["BROKER", "BANK", "OTHER"],
  CRYPTO: ["BROKER", "WALLET", "OTHER"],
  DERIVATIVES: ["BROKER", "OTHER"],
};
