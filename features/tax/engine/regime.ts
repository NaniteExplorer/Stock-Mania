import type { TaxRule } from "./rule";
import type { TaxContext } from "./types";

/**
 * A regime is a named, effective-dated, ordered collection of rules — e.g. the
 * India FY2024-25+ capital-gains framework. Budget changes are modelled as a
 * NEW regime with a later `effectiveFrom`, never edits to a shipped one, so
 * historical computations stay reproducible.
 */
export abstract class TaxRegime {
  abstract readonly name: string;
  /** First date (inclusive) this regime applies to. */
  abstract readonly effectiveFrom: Date;

  abstract rules(): TaxRule[];

  /** First matching rule wins; regimes order rules from most to least specific. */
  ruleFor(context: TaxContext): TaxRule | undefined {
    return this.rules().find((rule) => rule.appliesTo(context));
  }
}
