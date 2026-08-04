import type { TaxContext, TaxLineItem } from "./types";

/**
 * A single tax rule. Rules are stateless and composable: a regime is an ordered
 * list of rules; the first rule whose `appliesTo` matches computes the tax.
 * New budget provisions become new rule subclasses, never edits to old ones.
 */
export abstract class TaxRule {
  abstract readonly name: string;

  abstract appliesTo(context: TaxContext): boolean;

  abstract compute(context: TaxContext): TaxLineItem[];

  protected line(partial: Omit<TaxLineItem, "rule">): TaxLineItem {
    return { rule: this.name, ...partial };
  }
}
