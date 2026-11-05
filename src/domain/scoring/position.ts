/**
 * Descriptive per-holding context (TASKS 3.7). Pure; no I/O.
 *
 * Descriptive only: it says what a holding is in the owner's portfolio. It never
 * rates the security, ranks holdings or suggests buying, selling or holding
 * (PRODUCT-REQUIREMENT §5.3). Every field is computed from data already stored
 * for the holding or marked unavailable with the reason; nothing is invented.
 * Equity fundamentals stay unavailable until filing ingestion clears RULES §4
 * (TASKS 3.7 dependency).
 */
import type { Money } from "@/core/money";
import { moneyRatio } from "@/core/ratio";
import type { Days, Ratio } from "@/core/units";

export interface HoldingFacts {
  readonly name: string;
  readonly costBasis: Money | null;
  readonly marketValue: Money | null;
  /** Sum of the market values of every holding. */
  readonly portfolioValue: Money | null;
  /** Whole days since the stored price, or null when none is stored. */
  readonly priceAgeDays: Days | null;
}

export type ContextField<T> =
  | { readonly state: "available"; readonly value: T; readonly basis: string }
  | { readonly state: "unavailable"; readonly reason: string };

export interface HoldingContext {
  readonly name: string;
  readonly weight: ContextField<Ratio>;
  readonly unrealisedReturn: ContextField<Ratio>;
  readonly priceAge: ContextField<Days>;
  /** Always unavailable today; present so the screen says so instead of omitting it. */
  readonly fundamentals: ContextField<never>;
  readonly disclaimer: string;
}

const no = (reason: string): ContextField<never> => ({ state: "unavailable", reason });

export const FUNDAMENTALS_UNAVAILABLE =
  "Fundamentals (own 5-year and sector medians, pledging, Piotroski components) are not ingested yet; each will carry its filing URL, date and units when they are.";

export function holdingContext(facts: HoldingFacts): HoldingContext {
  const { marketValue: mv, costBasis: cost, portfolioValue: total } = facts;
  const weight: ContextField<Ratio> = mv === null ? no("No market value is stored for this holding.")
    : total === null || !total.isPositive ? no("The portfolio total is not known.")
    : mv.currency.code !== total.currency.code ? no("Market value and portfolio total are in different currencies.")
    : { state: "available", value: moneyRatio(mv, total), basis: "Market value / portfolio market value." };
  const unrealisedReturn: ContextField<Ratio> = mv === null || cost === null ? no("Cost basis or market value is not stored.")
    : !cost.isPositive ? no("Cost basis is zero or negative; a return on it is undefined.")
    : mv.currency.code !== cost.currency.code ? no("Cost and value are in different currencies.")
    : { state: "available", value: moneyRatio(mv.minus(cost), cost), basis: "(Market value - cost basis) / cost basis, before tax and charges." };
  const priceAge: ContextField<Days> = facts.priceAgeDays === null
    ? no("No stored price date.")
    : { state: "available", value: facts.priceAgeDays, basis: "Days since the last stored price." };
  return {
    name: facts.name, weight, unrealisedReturn, priceAge,
    fundamentals: no(FUNDAMENTALS_UNAVAILABLE),
    disclaimer: "Context, not a rating: this describes the holding and recommends no action.",
  };
}
