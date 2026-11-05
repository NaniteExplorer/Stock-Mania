import type { UserId } from "@/core/kernel";
import type { Percentage } from "@/core/numeric";
import type { AccountId } from "./accounts";
import type { AssertedValuation, OtherPhysicalAsset, RealEstate, Vehicle } from "./assets";
import type { DepreciationModel } from "./depreciation";

export type StoredPhysicalAsset = RealEstate | Vehicle | OtherPhysicalAsset;

/** Only the shipped schedule has a persistent identity; custom age bands do not. */
export type PhysicalDepreciationSpec =
  | { readonly kind: "DECLINING"; readonly rate: Percentage; readonly basis: string }
  | { readonly kind: "STRAIGHT"; readonly rate: Percentage; readonly floor: Percentage; readonly basis: string }
  | { readonly kind: "SCHEDULE"; readonly scheduleId: "MOTOR_IDV" };

export interface PhysicalAssetRecord {
  readonly asset: StoredPhysicalAsset;
  readonly model: DepreciationModel | null;
}

export interface PhysicalAssetCreation {
  readonly asset: StoredPhysicalAsset;
  readonly model: PhysicalDepreciationSpec | null;
  /** The asset's ledger account is new and unsaved: the writer opens it in the same atomic unit as the insert. */
  readonly opensAccount?: boolean;
}

export interface PhysicalAssetRepository {
  findByAccount(userId: UserId, accountId: AccountId): Promise<PhysicalAssetRecord | null>;
  list(userId: UserId): Promise<readonly PhysicalAssetRecord[]>;
}

/** Implementations must atomically enforce account ownership and audit each mutation. */
export interface PhysicalAssetWriter {
  create(userId: UserId, record: PhysicalAssetCreation): Promise<void>;
  replaceModel(userId: UserId, accountId: AccountId, model: PhysicalDepreciationSpec | null): Promise<void>;
  assertValuation(userId: UserId, accountId: AccountId, valuation: AssertedValuation): Promise<void>;
  /** Tombstone, never delete (class B); closes the asset's ledger account in the same unit. */
  remove(userId: UserId, accountId: AccountId): Promise<void>;
}
