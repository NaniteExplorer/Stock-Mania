import {
  DEFAULT_TAX_CONFIG,
  taxClassForKind,
  type TaxAssetClass,
  type TaxConfig,
  type TaxTier,
} from "./tax.config";
import { TaxEngine, UserOverrideRegime, type TaxContext } from "./engine";
import type { InvestmentKind } from "@/features/investments/investment.types";

export interface TaxEstimate {
  assetClass: TaxAssetClass;
  tier: TaxTier;
  taxableGain: number;
  ratePercent: number;
  taxAmount: number;
  note: string;
}

/**
 * Per-holding tax estimate — thin façade over the rule engine so existing
 * callers keep a flat result shape. The annual LTCG exemption is NOT applied
 * here (it's a portfolio-level allowance); call `TaxEngine.compute` directly
 * with `ltcgExemptionRemaining` for an aggregated, exemption-aware figure.
 */
export function estimateTax(
  config: TaxConfig,
  args: { assetClass: TaxAssetClass; gain: number; holdingDays: number },
): TaxEstimate {
  const context: TaxContext = {
    eventKind: "CAPITAL_GAIN",
    assetClass: args.assetClass,
    amount: args.gain,
    holdingDays: args.holdingDays,
    slabPercent: config.slabPercent,
    ltcgExemptionRemaining: 0,
    date: new Date(),
  };
  const { lineItems, taxAmount } = TaxEngine.compute(context, new UserOverrideRegime(config));
  const item = lineItems[0];
  return {
    assetClass: args.assetClass,
    tier: item?.tier ?? "NONE",
    taxableGain: Math.max(0, args.gain),
    ratePercent: item?.ratePercent ?? 0,
    taxAmount,
    note: item?.note ?? "",
  };
}

/** Convenience: estimate from an investment kind. */
export function estimateTaxForKind(
  config: TaxConfig,
  args: { kind: InvestmentKind; gain: number; holdingDays: number },
): TaxEstimate {
  return estimateTax(config, { assetClass: taxClassForKind(args.kind), gain: args.gain, holdingDays: args.holdingDays });
}

export { DEFAULT_TAX_CONFIG };
export type { TaxConfig };
