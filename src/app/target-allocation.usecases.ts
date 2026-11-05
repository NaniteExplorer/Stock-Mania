/**
 * Stored target allocation use cases (financial-health-scoring.md § 3.6 persistence).
 *
 * The owner states the whole allocation at once; it is validated by the domain's
 * `targetAllocation()` (positive shares, distinct ids, exactly 100% in exact units)
 * and replaced atomically. Invalid input is a `ValidationError`, never written.
 */
import { Err, Ok, ValidationError, type AppError, type Result, type UseCase, type UserId } from "@/core/kernel";
import { Percentage } from "@/core/numeric";
import { rebalancingBand, targetAllocation, type Band, type TargetAllocation } from "@/domain/portfolio";
import type { RebalancingBandReader, RebalancingBandWriter, TargetAllocationReader, TargetAllocationWriter } from "@/domain/target-allocation";

export interface RecordTargetAllocationInput {
  readonly userId: UserId;
  /** Each share is decimal percent text, e.g. "60" or "30.5" (at most six places). */
  readonly sleeves: readonly { readonly id: string; readonly share: string }[];
}

export class RecordTargetAllocation implements UseCase<RecordTargetAllocationInput, TargetAllocation> {
  constructor(private readonly writer: TargetAllocationWriter) {}

  async execute(input: RecordTargetAllocationInput): Promise<Result<TargetAllocation, AppError>> {
    let allocation: TargetAllocation;
    try {
      allocation = targetAllocation(input.sleeves.map((s) => ({ id: s.id.trim(), share: Percentage.of(s.share) })));
    } catch (error) {
      return Err(new ValidationError((error as Error).message));
    }
    await this.writer.replace(input.userId, allocation);
    return Ok(allocation);
  }
}

export class RemoveTargetAllocation implements UseCase<{ readonly userId: UserId }, void> {
  constructor(private readonly writer: TargetAllocationWriter) {}

  async execute({ userId }: { readonly userId: UserId }): Promise<Result<void, AppError>> {
    try {
      await this.writer.remove(userId);
    } catch (error) {
      return Err(new ValidationError((error as Error).message));
    }
    return Ok();
  }
}

export class LoadTargetAllocation implements UseCase<{ readonly userId: UserId }, TargetAllocation | null> {
  constructor(private readonly reader: TargetAllocationReader) {}

  async execute({ userId }: { readonly userId: UserId }): Promise<Result<TargetAllocation | null, AppError>> {
    return Ok(await this.reader.load(userId));
  }
}

/* ═══ Rebalancing band (owner-stated; no default) ═══════════════════════ */

export interface RecordRebalancingBandInput {
  readonly userId: UserId;
  /** Decimal percent text, e.g. "6" points absolute and "30" percent relative. */
  readonly absolute: string;
  readonly relative: string;
}

export class RecordRebalancingBand implements UseCase<RecordRebalancingBandInput, Band> {
  constructor(private readonly writer: RebalancingBandWriter) {}

  async execute(input: RecordRebalancingBandInput): Promise<Result<Band, AppError>> {
    let band: Band;
    try {
      band = rebalancingBand({ absolute: Percentage.of(input.absolute.trim()), relative: Percentage.of(input.relative.trim()) });
    } catch (error) {
      return Err(new ValidationError((error as Error).message));
    }
    await this.writer.replace(input.userId, band);
    return Ok(band);
  }
}

export class RemoveRebalancingBand implements UseCase<{ readonly userId: UserId }, void> {
  constructor(private readonly writer: RebalancingBandWriter) {}

  async execute({ userId }: { readonly userId: UserId }): Promise<Result<void, AppError>> {
    try {
      await this.writer.remove(userId);
    } catch (error) {
      return Err(new ValidationError((error as Error).message));
    }
    return Ok();
  }
}

export class LoadRebalancingBand implements UseCase<{ readonly userId: UserId }, Band | null> {
  constructor(private readonly reader: RebalancingBandReader) {}

  async execute({ userId }: { readonly userId: UserId }): Promise<Result<Band | null, AppError>> {
    return Ok(await this.reader.load(userId));
  }
}
