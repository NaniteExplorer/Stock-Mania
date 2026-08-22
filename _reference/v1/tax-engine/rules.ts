import type { AssetTaxRule, TaxAssetClass } from "../tax.config";
import { TaxRule } from "./rule";
import type { TaxContext, TaxLineItem } from "./types";

/** Losses: never taxed; note whether the loss can offset eligible gains. */
export class LossRule extends TaxRule {
  readonly name = "loss";
  constructor(private readonly offsetByClass: Partial<Record<TaxAssetClass, boolean>>) {
    super();
  }
  appliesTo(context: TaxContext): boolean {
    return context.eventKind === "CAPITAL_GAIN" && context.amount <= 0;
  }
  compute(context: TaxContext): TaxLineItem[] {
    const canOffset = context.assetClass ? this.offsetByClass[context.assetClass] !== false : true;
    return [this.line({
      tier: "NONE", taxableAmount: 0, ratePercent: 0, taxAmount: 0,
      note: canOffset ? "Loss — may offset eligible gains" : "Loss — not deductible",
    })];
  }
}

/** Flat-rate classes (crypto/VDA): one rate regardless of holding period. */
export class FlatRateRule extends TaxRule {
  readonly name = "flat-rate";
  constructor(private readonly assetClass: TaxAssetClass, private readonly ratePercent: number) {
    super();
  }
  appliesTo(context: TaxContext): boolean {
    return context.eventKind === "CAPITAL_GAIN" && context.assetClass === this.assetClass && context.amount > 0;
  }
  compute(context: TaxContext): TaxLineItem[] {
    return [this.line({
      tier: "FLAT", taxableAmount: context.amount, ratePercent: this.ratePercent,
      taxAmount: (context.amount * this.ratePercent) / 100, note: `Flat ${this.ratePercent}%`,
    })];
  }
}

/**
 * STCG/LTCG capital gains for one asset class. Long-term gains first consume
 * the remaining annual LTCG exemption (reported via `exemptionUsed` upstream).
 * Short-term on slab-taxed classes (debt, gold pre-threshold) uses the slab %.
 */
export class CapitalGainsRule extends TaxRule {
  readonly name = "capital-gains";
  constructor(private readonly assetClass: TaxAssetClass, private readonly rule: AssetTaxRule) {
    super();
  }
  appliesTo(context: TaxContext): boolean {
    return context.eventKind === "CAPITAL_GAIN" && context.assetClass === this.assetClass && context.amount > 0;
  }
  compute(context: TaxContext): TaxLineItem[] {
    const isLongTerm = this.rule.ltcgThresholdDays != null && context.holdingDays >= this.rule.ltcgThresholdDays;
    if (isLongTerm) {
      const exempt = Math.min(context.amount, Math.max(0, context.ltcgExemptionRemaining));
      const taxable = context.amount - exempt;
      const rate = this.rule.longTermRatePercent;
      return [this.line({
        tier: "LTCG", taxableAmount: taxable, ratePercent: rate,
        taxAmount: (taxable * rate) / 100,
        note: exempt > 0 ? `LTCG ${rate}% (₹${Math.round(exempt).toLocaleString("en-IN")} exempt)` : `LTCG ${rate}%`,
      })];
    }
    const useSlab = this.rule.useSlabRate;
    const rate = useSlab ? context.slabPercent : this.rule.shortTermRatePercent;
    const tier = this.rule.ltcgThresholdDays == null && useSlab ? "SLAB" : "STCG";
    return [this.line({
      tier, taxableAmount: context.amount, ratePercent: rate,
      taxAmount: (context.amount * rate) / 100, note: `${tier} ${rate}%`,
    })];
  }
}

/** Interest income (FD/RD/savings/debt accruals) taxed at the user's slab. */
export class SlabIncomeRule extends TaxRule {
  readonly name = "slab-income";
  appliesTo(context: TaxContext): boolean {
    return context.eventKind === "INTEREST" && context.amount > 0;
  }
  compute(context: TaxContext): TaxLineItem[] {
    return [this.line({
      tier: "SLAB", taxableAmount: context.amount, ratePercent: context.slabPercent,
      taxAmount: (context.amount * context.slabPercent) / 100, note: `Interest at slab ${context.slabPercent}%`,
    })];
  }
}

/** EEE instruments: PPF and EPF (within limits) — interest and gains exempt. */
export class ExemptRule extends TaxRule {
  readonly name = "exempt";
  constructor(private readonly matches: (context: TaxContext) => boolean, private readonly note: string) {
    super();
  }
  appliesTo(context: TaxContext): boolean {
    return this.matches(context);
  }
  compute(): TaxLineItem[] {
    return [this.line({ tier: "NONE", taxableAmount: 0, ratePercent: 0, taxAmount: 0, note: this.note })];
  }
}
