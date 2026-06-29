import type { InvestmentKind } from "@/features/investments/investment.types";

/**
 * Tax asset classes and their rule shape. These produce CONFIGURABLE ESTIMATES
 * for planning — not tax advice or a filing computation. India FY2024-25+
 * defaults; every rate is user-overridable in Settings.
 */
export type TaxAssetClass = "EQUITY" | "EQUITY_MF" | "DEBT" | "CRYPTO" | "GOLD";
export type TaxTier = "STCG" | "LTCG" | "FLAT" | "SLAB" | "NONE";

export interface AssetTaxRule {
  label: string;
  /** Days to qualify as long-term; null = no LTCG concept (always flat/slab). */
  ltcgThresholdDays: number | null;
  shortTermRatePercent: number;
  longTermRatePercent: number;
  /** Crypto: single flat rate regardless of holding period. */
  flat: boolean;
  /** Crypto: losses cannot offset gains / be carried. */
  allowLossOffset: boolean;
  /** Debt/slab assets are taxed at the user's income slab rate. */
  useSlabRate: boolean;
}

export interface TaxConfig {
  rules: Record<TaxAssetClass, AssetTaxRule>;
  /** Income-tax slab % used for DEBT and pre-threshold GOLD. */
  slabPercent: number;
  /** Annual LTCG exemption (₹) — informational; applied at portfolio level. */
  ltcgExemption: number;
}

export const DEFAULT_TAX_CONFIG: TaxConfig = {
  slabPercent: 30,
  ltcgExemption: 125000,
  rules: {
    EQUITY: {
      label: "Equity / ETF",
      ltcgThresholdDays: 365,
      shortTermRatePercent: 20,
      longTermRatePercent: 12.5,
      flat: false,
      allowLossOffset: true,
      useSlabRate: false,
    },
    EQUITY_MF: {
      label: "Equity mutual fund",
      ltcgThresholdDays: 365,
      shortTermRatePercent: 20,
      longTermRatePercent: 12.5,
      flat: false,
      allowLossOffset: true,
      useSlabRate: false,
    },
    DEBT: {
      label: "Debt / bond",
      ltcgThresholdDays: null,
      shortTermRatePercent: 30, // overridden by slabPercent at runtime
      longTermRatePercent: 30,
      flat: false,
      allowLossOffset: true,
      useSlabRate: true,
    },
    CRYPTO: {
      label: "Crypto / VDA",
      ltcgThresholdDays: null,
      shortTermRatePercent: 30,
      longTermRatePercent: 30,
      flat: true,
      allowLossOffset: false,
      useSlabRate: false,
    },
    GOLD: {
      label: "Gold / digital gold",
      ltcgThresholdDays: 730, // 24 months
      shortTermRatePercent: 30, // slab until threshold
      longTermRatePercent: 12.5,
      flat: false,
      allowLossOffset: true,
      useSlabRate: true, // short-term taxed at slab
    },
  },
};

/** Map an investment kind to its tax asset class. */
export function taxClassForKind(kind: InvestmentKind): TaxAssetClass {
  switch (kind) {
    case "STOCK":
    case "ETF":
      return "EQUITY";
    case "MUTUAL_FUND":
      return "EQUITY_MF";
    case "BOND":
      return "DEBT";
    case "CRYPTO":
      return "CRYPTO";
    case "DIGITAL_GOLD":
      return "GOLD";
    default:
      return "EQUITY";
  }
}
