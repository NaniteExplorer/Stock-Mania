import { DEFAULT_TAX_CONFIG, type TaxAssetClass, type TaxConfig } from "../tax.config";
import { TaxRegime } from "./regime";
import type { TaxRule } from "./rule";
import { CapitalGainsRule, ExemptRule, FlatRateRule, LossRule, SlabIncomeRule } from "./rules";

/**
 * India, FY2024-25 onwards (post July-2024 budget): equity 20% STCG / 12.5%
 * LTCG over 12 months with the ₹1.25L exemption, crypto flat 30% with no loss
 * offset, debt at slab, gold 12.5% LTCG over 24 months (slab before), PPF/EPF
 * exempt. Seeded from a TaxConfig so user overrides reuse the same shape.
 */
export class IndiaFY2025Regime extends TaxRegime {
  readonly name: string = "india-fy2025";
  readonly effectiveFrom = new Date("2024-07-23");

  constructor(protected readonly config: TaxConfig = DEFAULT_TAX_CONFIG) {
    super();
  }

  rules(): TaxRule[] {
    const classes = Object.keys(this.config.rules) as TaxAssetClass[];
    return [
      // PPF and EPF are EEE: contributions, interest and maturity are exempt.
      new ExemptRule(
        (context) => context.instrument === "PPF" || context.instrument === "EPF",
        "Exempt (EEE)",
      ),
      new LossRule(Object.fromEntries(classes.map((c) => [c, this.config.rules[c].allowLossOffset]))),
      ...classes.filter((c) => this.config.rules[c].flat).map((c) => new FlatRateRule(c, this.config.rules[c].shortTermRatePercent)),
      ...classes.filter((c) => !this.config.rules[c].flat).map((c) => new CapitalGainsRule(c, this.config.rules[c])),
      new SlabIncomeRule(),
    ];
  }
}
