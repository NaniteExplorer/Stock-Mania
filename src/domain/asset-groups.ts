/**
 * The second level of the instrument taxonomy: what a holder calls a category.
 *
 * `InstrumentKind` has fifteen-odd leaves because tax law has fifteen-odd
 * answers, and that is the right grain for the tax engine and the wrong grain
 * for a person looking at their portfolio. Nobody asks "how much is in my
 * sovereign gold bonds, my digital gold and my gold ETF" as three questions;
 * they ask how much is in **metals**. So the screen groups, and the grouping
 * lives here rather than in a `page.tsx` map, because two screens that each
 * invent their own categories will eventually disagree about where an ELSS
 * fund goes.
 *
 * Two rules keep this from becoming a second, competing discriminator:
 *
 *   - It is a **lookup table, not a switch**. Adding a leaf adds a row. The
 *     conformance test in `tests/instruments.spec.ts` greps for `case "KIND"`
 *     and `=== "KIND"` outside `instruments.ts` precisely so a grouping like
 *     this cannot quietly grow logic.
 *   - **Gold is decided by the tax profile, not by the kind.** A gold ETF is an
 *     `ETF` and belongs under metals; an equity ETF is the same leaf and does
 *     not. The leaf already answers that question — `taxProfile().category` —
 *     and asking it is how the grouping stays true for a leaf added later.
 *
 * Nothing here is stored. It is derived on every read, so re-grouping is a code
 * change and never a migration.
 */

import type { InstrumentKind, MarketInstrument } from "@/domain/instruments";

/** The categories a portfolio screen actually shows. */
export type AssetGroup =
  | "EQUITY"
  | "FUNDS"
  | "FIXED_INCOME"
  | "DIGITAL_METALS"
  | "REAL_ESTATE"
  | "CRYPTO"
  | "DERIVATIVES";

/** Display order, coarsest-risk-first, so two screens list them the same way. */
export const ASSET_GROUPS: readonly AssetGroup[] = [
  "EQUITY",
  "FUNDS",
  "DIGITAL_METALS",
  "FIXED_INCOME",
  "REAL_ESTATE",
  "CRYPTO",
  "DERIVATIVES",
];

const GROUP_LABELS: Readonly<Record<AssetGroup, string>> = {
  EQUITY: "Equity",
  FUNDS: "Mutual funds",
  FIXED_INCOME: "Fixed income",
  DIGITAL_METALS: "Digital metals",
  REAL_ESTATE: "Real estate",
  CRYPTO: "Crypto",
  DERIVATIVES: "Derivatives",
};

const GROUP_BLURBS: Readonly<Record<AssetGroup, string>> = {
  EQUITY: "Shares and equity ETFs, Indian and foreign",
  FUNDS: "Index, active, ELSS, liquid and debt schemes",
  FIXED_INCOME: "Bonds and government securities",
  DIGITAL_METALS: "Gold, silver and platinum — in grams, wherever they are vaulted",
  REAL_ESTATE: "Listed property trusts",
  CRYPTO: "Virtual digital assets — 30% flat, losses cannot be set off",
  DERIVATIVES: "Options and futures — business income, not capital gains",
};

/**
 * The base group of a leaf, before the gold override.
 *
 * A total `Record`, so a new `InstrumentKind` fails to compile until it is
 * placed. That is deliberate: the alternative is a `?? "OTHER"` fallback and a
 * holding that silently lands in a bucket nobody looks at.
 */
const BASE_GROUP: Readonly<Record<InstrumentKind, AssetGroup>> = {
  LISTED_EQUITY: "EQUITY",
  ETF: "EQUITY",
  INDEX_FUND: "FUNDS",
  MUTUAL_FUND: "FUNDS",
  LIQUID_FUND: "FUNDS",
  DEBT_FUND: "FUNDS",
  ELSS_FUND: "FUNDS",
  BOND: "FIXED_INCOME",
  GOVT_SECURITY: "FIXED_INCOME",
  SOVEREIGN_GOLD_BOND: "DIGITAL_METALS",
  DIGITAL_GOLD: "DIGITAL_METALS",
  DIGITAL_SILVER: "DIGITAL_METALS",
  DIGITAL_PLATINUM: "DIGITAL_METALS",
  REIT: "REAL_ESTATE",
  CRYPTO: "CRYPTO",
  OPTION: "DERIVATIVES",
  FUTURE: "DERIVATIVES",
};

/** The group of a kind, ignoring anything only the instrument itself knows. */
export function groupOfKind(kind: InstrumentKind): AssetGroup {
  return BASE_GROUP[kind];
}

/**
 * The group of an actual holding.
 *
 * The one place the answer differs from `groupOfKind`: a gold ETF. It is an
 * `ETF` by leaf and gold by tax treatment, and a portfolio screen that filed it
 * under equity would understate the metal exposure the user is trying to see.
 * The test is on the tax category — the leaf's own answer — rather than on
 * metadata this file would have to learn to read.
 */
export function groupOf(instrument: MarketInstrument): AssetGroup {
  if (instrument.taxProfile().category === "GOLD") return "DIGITAL_METALS";
  return BASE_GROUP[instrument.kind];
}

export function groupLabel(group: AssetGroup): string {
  return GROUP_LABELS[group];
}

export function groupBlurb(group: AssetGroup): string {
  return GROUP_BLURBS[group];
}

/** The leaves filed under a group, for a picker that offers a group first. */
export function kindsIn(group: AssetGroup): readonly InstrumentKind[] {
  return (Object.keys(BASE_GROUP) as InstrumentKind[]).filter((kind) => BASE_GROUP[kind] === group);
}

/**
 * The label for a leaf, one level below the group.
 *
 * Equity splits by currency rather than by kind, because "Indian equity" and
 * "foreign equity" are different tax regimes and different FX exposure while
 * being the same leaf — and that distinction is the one an Indian portfolio
 * screen is actually asked for.
 */
export function kindLabel(kind: InstrumentKind, currencyCode?: string): string {
  if (kind === "LISTED_EQUITY" && currencyCode !== undefined) {
    return currencyCode === "INR" ? "Indian equity" : "Foreign equity";
  }
  return KIND_LABELS[kind];
}

const KIND_LABELS: Readonly<Record<InstrumentKind, string>> = {
  LISTED_EQUITY: "Listed equity",
  ETF: "ETF",
  INDEX_FUND: "Index fund",
  MUTUAL_FUND: "Mutual fund",
  LIQUID_FUND: "Liquid fund",
  DEBT_FUND: "Debt fund",
  ELSS_FUND: "ELSS",
  BOND: "Bond",
  GOVT_SECURITY: "Government security",
  SOVEREIGN_GOLD_BOND: "Sovereign gold bond",
  DIGITAL_GOLD: "Digital gold",
  DIGITAL_SILVER: "Digital silver",
  DIGITAL_PLATINUM: "Digital platinum",
  REIT: "REIT",
  CRYPTO: "Crypto",
  OPTION: "Option",
  FUTURE: "Future",
};
