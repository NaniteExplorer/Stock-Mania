import {
  DEFAULT_TAX_CONFIG,
  taxClassForKind,
  type TaxAssetClass,
  type TaxConfig,
  type TaxTier,
} from "./tax.config";
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
 * Pure tax estimator. Given a resolved config and a single gain + holding
 * period, returns the estimated tax. Losses are never taxed; for crypto, losses
 * also can't offset other gains (handled at the aggregation layer).
 */
export function estimateTax(
  config: TaxConfig,
  args: { assetClass: TaxAssetClass; gain: number; holdingDays: number },
): TaxEstimate {
  const rule = config.rules[args.assetClass];
  const base = { assetClass: args.assetClass, taxableGain: Math.max(0, args.gain) };

  if (args.gain <= 0) {
    return { ...base, tier: "NONE", ratePercent: 0, taxAmount: 0, note: rule.allowLossOffset ? "Loss — may offset eligible gains" : "Loss — not deductible" };
  }

  if (rule.flat) {
    const rate = rule.shortTermRatePercent;
    return { ...base, tier: "FLAT", ratePercent: rate, taxAmount: (args.gain * rate) / 100, note: `Flat ${rate}%` };
  }

  const isLongTerm = rule.ltcgThresholdDays != null && args.holdingDays >= rule.ltcgThresholdDays;
  if (isLongTerm) {
    const rate = rule.longTermRatePercent;
    return { ...base, tier: "LTCG", ratePercent: rate, taxAmount: (args.gain * rate) / 100, note: `LTCG ${rate}%` };
  }

  // Short-term (or no LTCG concept): slab assets use the user's slab rate.
  const rate = rule.useSlabRate ? config.slabPercent : rule.shortTermRatePercent;
  const tier: TaxTier = rule.ltcgThresholdDays == null && rule.useSlabRate ? "SLAB" : "STCG";
  return { ...base, tier, ratePercent: rate, taxAmount: (args.gain * rate) / 100, note: `${tier} ${rate}%` };
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
