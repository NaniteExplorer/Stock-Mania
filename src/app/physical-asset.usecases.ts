/**
 * Physical asset use cases (TASKS 1.4): create, assert a valuation, replace the
 * depreciation model, tombstone, list. Every write goes through the
 * `PhysicalAssetWriter`, whose adapter commits each mutation via `mutateAtomic`.
 *
 * Creation opens a dedicated ASSET ledger account (subtype = kind) with **no**
 * opening balance: an asserted valuation is not a posting, and the purchase posting
 * (if any) is linked separately through 1.8 asset acquisitions.
 */
import { Err, Ok, ValidationError, type AppError, type Result, type UseCase, type UserId } from "@/core/kernel";
import type { Money } from "@/core/money";
import type { CalendarDate } from "@/core/time";
import type { AccountId } from "@/domain/accounts";
import { OtherPhysicalAsset, RealEstate, Vehicle, type AssertedValuation, type ValuationSource } from "@/domain/assets";
import type { PhysicalAssetRecord, PhysicalAssetRepository, PhysicalAssetWriter, PhysicalDepreciationSpec } from "@/domain/physical-asset-store";
import type { OpenAccount } from "./ledger.usecases";

export type StoredPhysicalKind = "REAL_ESTATE" | "VEHICLE" | "OTHER";

export interface CreatePhysicalAssetInput {
  readonly userId: UserId;
  readonly name: string;
  readonly kind: StoredPhysicalKind;
  readonly purchase?: { readonly on: CalendarDate; readonly price: Money };
  readonly model: PhysicalDepreciationSpec | null;
  readonly firstValuation?: AssertedValuation;
}

function refused(error: unknown): Result<never, AppError> {
  return Err(new ValidationError(error instanceof Error ? error.message : "The physical asset write was refused."));
}

export class CreatePhysicalAsset implements UseCase<CreatePhysicalAssetInput, AccountId> {
  constructor(
    private readonly openAccount: OpenAccount,
    private readonly writer: PhysicalAssetWriter,
  ) {}

  async execute(input: CreatePhysicalAssetInput): Promise<Result<AccountId, AppError>> {
    // Prepared, not saved: the writer opens the account and inserts the asset in one atomic unit.
    const prepared = await this.openAccount.prepare({ userId: input.userId, name: input.name, type: "ASSET", subtype: input.kind });
    if (!prepared.ok) return prepared;
    const account = prepared.value;
    try {
      const valuations = input.firstValuation ? [input.firstValuation] : [];
      const asset = input.kind === "REAL_ESTATE" ? new RealEstate(account, valuations, input.purchase)
        : input.kind === "VEHICLE" ? new Vehicle(account, valuations, input.purchase)
          : new OtherPhysicalAsset(account, valuations, input.purchase);
      await this.writer.create(input.userId, { asset, model: input.model, opensAccount: true });
    } catch (error) {
      return refused(error);
    }
    return Ok(account.id);
  }
}

export interface AssertPhysicalValuationInput {
  readonly userId: UserId;
  readonly accountId: AccountId;
  readonly on: CalendarDate;
  readonly value: Money;
  readonly source: ValuationSource;
  readonly note?: string;
}

export class AssertPhysicalValuation implements UseCase<AssertPhysicalValuationInput, void> {
  constructor(private readonly writer: PhysicalAssetWriter) {}

  async execute(input: AssertPhysicalValuationInput): Promise<Result<void, AppError>> {
    try {
      await this.writer.assertValuation(input.userId, input.accountId, {
        on: input.on, value: input.value, source: input.source, ...(input.note ? { note: input.note } : {}),
      });
    } catch (error) {
      return refused(error);
    }
    return Ok();
  }
}

export class ReplacePhysicalModel implements UseCase<{ readonly userId: UserId; readonly accountId: AccountId; readonly model: PhysicalDepreciationSpec | null }, void> {
  constructor(private readonly writer: PhysicalAssetWriter) {}

  async execute(input: { readonly userId: UserId; readonly accountId: AccountId; readonly model: PhysicalDepreciationSpec | null }): Promise<Result<void, AppError>> {
    try {
      await this.writer.replaceModel(input.userId, input.accountId, input.model);
    } catch (error) {
      return refused(error);
    }
    return Ok();
  }
}

export class RemovePhysicalAsset implements UseCase<{ readonly userId: UserId; readonly accountId: AccountId }, void> {
  constructor(private readonly writer: PhysicalAssetWriter) {}

  async execute(input: { readonly userId: UserId; readonly accountId: AccountId }): Promise<Result<void, AppError>> {
    try {
      await this.writer.remove(input.userId, input.accountId);
    } catch (error) {
      return refused(error);
    }
    return Ok();
  }
}

export class ListPhysicalAssets implements UseCase<{ readonly userId: UserId }, readonly PhysicalAssetRecord[]> {
  constructor(private readonly repository: PhysicalAssetRepository) {}

  async execute({ userId }: { readonly userId: UserId }): Promise<Result<readonly PhysicalAssetRecord[], AppError>> {
    return Ok(await this.repository.list(userId));
  }
}
