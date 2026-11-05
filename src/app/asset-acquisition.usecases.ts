/**
 * Use cases for the expense-to-asset-acquisition link (task 1.8).
 *
 * Thin on purpose: the rules are `acquisitionOf` in `src/domain/asset-acquisition.ts`
 * and the audited writes are the writer port's. These turn the expected failures
 * — a refused link, a missing row, a malformed id — into values the UI can show
 * with their reason, and let an unexpected persistence failure stay observable.
 *
 * The owner always comes from the caller's authenticated context (the container
 * resolves it from the session), never from a form field.
 */

import type { Count } from "@/core/units";
import { AppError, Err, Ok, ValidationError, type Result, type UseCase, type UserId } from "@/core/kernel";
import { AccountId } from "@/domain/accounts";
import type { AcquisitionCandidate, AssetAcquisition, AssetAcquisitionRepository, AssetAcquisitionWriter } from "@/domain/asset-acquisition";

/** Expected failures become values; anything else is rethrown. */
async function guarded<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return Ok(await work());
  } catch (error) {
    if (error instanceof AppError) return Err(error);
    if (error instanceof RangeError || error instanceof TypeError) return Err(new ValidationError(error.message));
    throw error;
  }
}

export interface LinkAssetAcquisitionInput {
  readonly userId: UserId;
  readonly assetAccountId: string;
  readonly postingId: string;
}

/** Names `postingId` as the asset's acquisition, replacing any earlier link (which is tombstoned, not erased). */
export class LinkAssetAcquisition implements UseCase<LinkAssetAcquisitionInput, AssetAcquisition> {
  constructor(private readonly writer: AssetAcquisitionWriter) {}

  execute(input: LinkAssetAcquisitionInput): Promise<Result<AssetAcquisition>> {
    return guarded(() => {
      const postingId = input.postingId.trim();
      if (!postingId) throw new ValidationError("Choose the posting that paid for the asset.");
      return this.writer.link(input.userId, AccountId.from(input.assetAccountId), postingId);
    });
  }
}

export interface UnlinkAssetAcquisitionInput {
  readonly userId: UserId;
  readonly assetAccountId: string;
}

/** Tombstones the asset's link. The asset falls back to any owner-entered purchase terms. */
export class UnlinkAssetAcquisition implements UseCase<UnlinkAssetAcquisitionInput, void> {
  constructor(private readonly writer: AssetAcquisitionWriter) {}

  execute(input: UnlinkAssetAcquisitionInput): Promise<Result<void>> {
    return guarded(() => this.writer.unlink(input.userId, AccountId.from(input.assetAccountId)));
  }
}

export interface RestoreAssetAcquisitionInput {
  readonly userId: UserId;
  readonly linkId: string;
}

/** Undo of an unlink: re-judges the link and restores it, or refuses with the reason. */
export class RestoreAssetAcquisition implements UseCase<RestoreAssetAcquisitionInput, AssetAcquisition> {
  constructor(private readonly writer: AssetAcquisitionWriter) {}

  execute(input: RestoreAssetAcquisitionInput): Promise<Result<AssetAcquisition>> {
    return guarded(() => this.writer.restore(input.userId, input.linkId));
  }
}

export interface AssetAcquisitionForInput {
  readonly userId: UserId;
  readonly assetAccountId: string;
}

/**
 * The asset's acquisition cost provenance: the linked posting's date, amount and
 * description, or null when nothing (still) qualifies. Null is "not linked", never
 * a zero cost.
 */
export class AssetAcquisitionFor implements UseCase<AssetAcquisitionForInput, AssetAcquisition | null> {
  constructor(private readonly repository: AssetAcquisitionRepository) {}

  execute(input: AssetAcquisitionForInput): Promise<Result<AssetAcquisition | null>> {
    return guarded(() => this.repository.forAsset(input.userId, AccountId.from(input.assetAccountId)));
  }
}

/** The shortlist of expense postings the link picker offers; the link itself is still judged on write. */
export class AcquisitionCandidates implements UseCase<{ readonly userId: UserId; readonly limit?: Count }, readonly AcquisitionCandidate[]> {
  constructor(private readonly repository: AssetAcquisitionRepository) {}

  execute(input: { readonly userId: UserId; readonly limit?: Count }): Promise<Result<readonly AcquisitionCandidate[]>> {
    return guarded(() => this.repository.candidates(input.userId, input.limit));
  }
}
