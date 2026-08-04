import type { TaxConfig } from "../tax.config";
import { IndiaFY2025Regime } from "./india-fy2025.regime";
import type { TaxRegime } from "./regime";
import type { TaxComputation, TaxContext } from "./types";

/** A user's saved settings become a regime with the same rule wiring. */
export class UserOverrideRegime extends IndiaFY2025Regime {
  readonly name: string = "india-fy2025:user";
  constructor(config: TaxConfig) {
    super(config);
  }
}

/** Registered regimes, newest first. Add future budgets to the front. */
const REGIMES: TaxRegime[] = [new IndiaFY2025Regime()];

export const TaxEngine = {
  /** Pick the regime in force on `date` (defaults to the newest). */
  for(date: Date = new Date()): TaxRegime {
    return REGIMES.find((regime) => date >= regime.effectiveFrom) ?? REGIMES[REGIMES.length - 1];
  },

  /** Compute tax for one event under `regime` (or the date-selected one). */
  compute(context: TaxContext, regime?: TaxRegime): TaxComputation {
    const active = regime ?? this.for(context.date);
    const rule = active.ruleFor(context);
    const lineItems = rule ? rule.compute(context) : [];
    const taxAmount = lineItems.reduce((sum, item) => sum + item.taxAmount, 0);
    // LTCG exemption consumed = gain that an LTCG line left untaxed.
    const exemptionUsed = lineItems
      .filter((item) => item.tier === "LTCG")
      .reduce((sum, item) => sum + Math.max(0, context.amount - item.taxableAmount), 0);
    return { lineItems, taxAmount, exemptionUsed };
  },
};
