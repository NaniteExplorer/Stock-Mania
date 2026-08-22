import type { TaxAssetClass, TaxTier } from "../tax.config";

/**
 * The kind of taxable event. CAPITAL_GAIN covers realised/if-realised-today
 * security gains; INTEREST covers FD/RD/savings accruals (slab income);
 * SALARY/DEDUCTION exist so future salary-planning rules (e.g. section 80C)
 * plug into the same engine without reshaping it.
 */
export type TaxEventKind = "CAPITAL_GAIN" | "INTEREST" | "SALARY" | "DEDUCTION";

/** Everything a rule may need to decide applicability and compute tax. */
export interface TaxContext {
  eventKind: TaxEventKind;
  assetClass: TaxAssetClass | null;
  /** Named scheme for instruments with special treatment (EEE etc.). */
  instrument?: "PPF" | "EPF" | "NPS" | "FD" | "RD" | null;
  /** Gain (or income amount) in the account currency. Losses are negative. */
  amount: number;
  /** Holding period in days; irrelevant for INTEREST/SALARY events. */
  holdingDays: number;
  /** User's marginal income-tax slab, percent. */
  slabPercent: number;
  /** Remaining annual LTCG exemption (₹) available to this computation. */
  ltcgExemptionRemaining: number;
  /** Event date — used by the engine to select the regime; rules may use it too. */
  date: Date;
}

export interface TaxLineItem {
  rule: string;
  tier: TaxTier;
  taxableAmount: number;
  ratePercent: number;
  taxAmount: number;
  note: string;
}

export interface TaxComputation {
  lineItems: TaxLineItem[];
  taxAmount: number;
  /** LTCG exemption consumed by this computation (₹). */
  exemptionUsed: number;
}
