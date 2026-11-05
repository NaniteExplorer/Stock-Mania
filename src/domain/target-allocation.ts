/**
 * Ports for the owner's stored target allocation (financial-health-scoring.md § 3.6).
 *
 * The value type and its validator are `TargetAllocation` / `targetAllocation()` in
 * `portfolio.ts`; nothing here re-validates. A stored allocation is replaced as a
 * whole, never edited sleeve by sleeve, so it can never be half-written.
 */
import type { Band, TargetAllocation } from "./portfolio";

export interface TargetAllocationReader {
  /** The live allocation, or `null` when none is stored. */
  load(userId: { readonly value: string }): Promise<TargetAllocation | null>;
}

export interface TargetAllocationWriter {
  replace(userId: { readonly value: string }, allocation: TargetAllocation): Promise<void>;
  remove(userId: { readonly value: string }): Promise<void>;
}

/**
 * Ports for the owner's rebalancing band. The validator is `rebalancingBand()` in
 * `portfolio.ts`; there is no default band — none stored means none measured.
 */
export interface RebalancingBandReader {
  load(userId: { readonly value: string }): Promise<Band | null>;
}

export interface RebalancingBandWriter {
  replace(userId: { readonly value: string }, band: Band): Promise<void>;
  remove(userId: { readonly value: string }): Promise<void>;
}
