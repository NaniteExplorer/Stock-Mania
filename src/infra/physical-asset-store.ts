import { and, asc, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import { newUuid, type UserId } from "@/core/kernel";
import { AccountId } from "@/domain/accounts";
import { AcquisitionRefusedError, purchaseMismatch } from "@/domain/asset-acquisition";
import type { AssertedValuation } from "@/domain/assets";
import { OtherPhysicalAsset, RealEstate, Vehicle } from "@/domain/assets";
import type { PhysicalAssetCreation, PhysicalAssetRecord, PhysicalAssetRepository, PhysicalAssetWriter, PhysicalDepreciationSpec } from "@/domain/physical-asset-store";
import { DrizzleAssetAcquisitionRepository } from "./asset-acquisition-store";
import type { Database } from "./db/client";
import { ledgerAccounts, physicalAssets, physicalAssetValuations } from "./db/schema";
import { decodePhysicalAsset, encodePhysicalAsset, encodePhysicalModel } from "./physical-asset-codec";
import { AccountMapper } from "./repositories";
import { UnitOfWork, type RequestContext } from "./unit-of-work";

/** Reads assertions and model terms separately: modelled values are never persisted. */
export class DrizzlePhysicalAssetRepository implements PhysicalAssetRepository {
  constructor(private readonly db: Database) {}

  async findByAccount(userId: UserId, accountId: AccountId): Promise<PhysicalAssetRecord | null> {
    const [record] = await this.read(userId, accountId);
    return record ?? null;
  }

  async list(userId: UserId): Promise<readonly PhysicalAssetRecord[]> {
    return this.read(userId);
  }

  private async read(userId: UserId, accountId?: AccountId): Promise<readonly PhysicalAssetRecord[]> {
    const rows = await this.db.select({
      header: { ...getTableColumns(physicalAssets), purchasePriceMinor: sql<string | null>`CAST(${physicalAssets.purchasePriceMinor} AS TEXT)`,
        ratePercentScaled: sql<string | null>`CAST(${physicalAssets.ratePercentScaled} AS TEXT)`,
        floorPercentScaled: sql<string | null>`CAST(${physicalAssets.floorPercentScaled} AS TEXT)` },
      account: ledgerAccounts,
    }).from(physicalAssets).innerJoin(ledgerAccounts, eq(ledgerAccounts.id, physicalAssets.accountId))
      .where(and(eq(physicalAssets.userId, userId.value), eq(ledgerAccounts.userId, userId.value),
        isNull(physicalAssets.deletedAt), isNull(ledgerAccounts.deletedAt),
        accountId === undefined ? undefined : eq(physicalAssets.accountId, accountId.value)))
      .orderBy(asc(physicalAssets.accountId));
    const records: PhysicalAssetRecord[] = [];
    for (const row of rows) {
      const history = await this.db.select({ on: physicalAssetValuations.onDate,
        valueMinor: sql<string>`CAST(${physicalAssetValuations.valueMinor} AS TEXT)`,
        source: physicalAssetValuations.source, note: physicalAssetValuations.note,
      }).from(physicalAssetValuations).where(and(eq(physicalAssetValuations.userId, userId.value),
        eq(physicalAssetValuations.assetAccountId, row.header.accountId), isNull(physicalAssetValuations.deletedAt)))
        .orderBy(asc(physicalAssetValuations.onDate));
      records.push(decodePhysicalAsset(AccountMapper.toDomain(row.account), row.header, history));
    }
    return Object.freeze(records);
  }
}

/** Every write is one audited mutateAtomic unit; nothing is hard-deleted (class B: tombstone). */
export class DrizzlePhysicalAssetWriter implements PhysicalAssetWriter {
  constructor(private readonly db: Database, private readonly context: RequestContext) {}

  async create(userId: UserId, input: PhysicalAssetCreation): Promise<void> {
    if (this.context.userId !== userId.value || this.context.actorId !== userId.value) {
      throw new Error("Physical asset owner does not match authenticated actor.");
    }
    if (input.asset.account.userId.value !== userId.value) throw new RangeError("Physical asset account belongs to another owner.");
    const encoded = encodePhysicalAsset(input);
    const acquisition = await new DrizzleAssetAcquisitionRepository(this.db).forAsset(userId, input.asset.id);
    if (acquisition && input.asset.purchase) {
      const mismatch = purchaseMismatch(acquisition, input.asset.purchase);
      if (mismatch) throw new AcquisitionRefusedError(mismatch);
    }
    const now = this.context.clock.now();
    const snapshot = { ...encoded, currency: input.asset.currency.code };
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: "CREATE", entityType: "physical_asset", entityId: encoded.header.accountId,
      before: null, touchedAccountIds: [],
      event: { type: "physical_asset.created", aggregateType: "physical_asset", aggregateId: encoded.header.accountId,
        payload: snapshot, effectiveOn: null },
      apply: async (tx) => {
        // A new account is opened in this same unit, so a refused insert leaves no orphan account.
        if (input.opensAccount) await tx.insert(ledgerAccounts).values(AccountMapper.toRow(input.asset.account));
        // Re-read the authoritative account inside the same transaction as the insert.
        const [account] = await tx.select().from(ledgerAccounts).where(and(eq(ledgerAccounts.id, encoded.header.accountId),
          eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt))).limit(1);
        if (!account || account.type !== "ASSET" || account.subtype !== encoded.header.kind || account.isSystem) {
          throw new RangeError("Physical asset needs a live owned eligible asset account.");
        }
        if (account.currency !== input.asset.currency.code) throw new RangeError("Physical asset currency differs from the authoritative account.");
        // Reconstruct against the database account too; an input object is not authority.
        decodePhysicalAsset(AccountMapper.toDomain(account), encoded.header, encoded.valuations);
        const { purchasePriceMinor, ratePercentScaled, floorPercentScaled, ...header } = encoded.header;
        const currency = account.currency;
        await tx.insert(physicalAssets).values({ ...header, currency, kind: input.asset.kind as "REAL_ESTATE" | "VEHICLE" | "OTHER",
          modelKind: input.model?.kind ?? null,
          ratePercentScaled: ratePercentScaled === null ? null : sql`CAST(${ratePercentScaled} AS INTEGER)`,
          floorPercentScaled: floorPercentScaled === null ? null : sql`CAST(${floorPercentScaled} AS INTEGER)`,
          purchasePriceMinor: purchasePriceMinor === null ? null : sql`CAST(${purchasePriceMinor} AS INTEGER)`,
          userId: userId.value, createdAt: now, updatedAt: now });
        for (const value of encoded.valuations) {
          await tx.run(sql`INSERT INTO physical_asset_valuations
            (id,user_id,asset_account_id,on_date,value_minor,currency,source,note,created_at,updated_at)
            VALUES (${newUuid()},${userId.value},${header.accountId},${value.on},CAST(${value.valueMinor} AS INTEGER),${currency},
              ${value.source},${value.note},${now.getTime()},${now.getTime()})`);
        }
        return { result: undefined, after: snapshot };
      },
    });
  }

  private assertActor(userId: UserId): void {
    if (this.context.userId !== userId.value || this.context.actorId !== userId.value) {
      throw new Error("Physical asset owner does not match authenticated actor.");
    }
  }

  private async live(userId: UserId, accountId: AccountId): Promise<PhysicalAssetRecord> {
    const record = await new DrizzlePhysicalAssetRepository(this.db).findByAccount(userId, accountId);
    if (!record) throw new RangeError("No live physical asset with that account.");
    return record;
  }

  async replaceModel(userId: UserId, accountId: AccountId, model: PhysicalDepreciationSpec | null): Promise<void> {
    this.assertActor(userId);
    await this.live(userId, accountId);
    const columns = encodePhysicalModel(model);
    const now = this.context.clock.now();
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: "UPDATE", entityType: "physical_asset", entityId: accountId.value,
      before: null, touchedAccountIds: [],
      event: { type: "physical_asset.model_replaced", aggregateType: "physical_asset", aggregateId: accountId.value, payload: { ...columns }, effectiveOn: null },
      apply: async (tx) => {
        await tx.update(physicalAssets).set({
          modelKind: columns.modelKind as "DECLINING" | "STRAIGHT" | "SCHEDULE" | null,
          ratePercentScaled: columns.ratePercentScaled === null ? null : sql`CAST(${columns.ratePercentScaled} AS INTEGER)`,
          floorPercentScaled: columns.floorPercentScaled === null ? null : sql`CAST(${columns.floorPercentScaled} AS INTEGER)`,
          modelBasis: columns.modelBasis, scheduleId: columns.scheduleId, updatedAt: now,
        }).where(and(eq(physicalAssets.accountId, accountId.value), eq(physicalAssets.userId, userId.value), isNull(physicalAssets.deletedAt)));
        return { result: undefined, after: { ...columns } };
      },
    });
  }

  async assertValuation(userId: UserId, accountId: AccountId, valuation: AssertedValuation): Promise<void> {
    this.assertActor(userId);
    const { asset } = await this.live(userId, accountId);
    // Rebuild through the constructor: currency, sign, one-per-date and not-before-purchase.
    const constructors = { REAL_ESTATE: RealEstate, VEHICLE: Vehicle, OTHER: OtherPhysicalAsset };
    new constructors[asset.kind](asset.account, [...asset.valuations, valuation], asset.purchase);
    const now = this.context.clock.now();
    const id = newUuid();
    const payload = { id, on: valuation.on.toISO(), valueMinor: valuation.value.minor.toString(), currency: asset.currency.code, source: valuation.source, note: valuation.note ?? null };
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: "CREATE", entityType: "physical_asset_valuation", entityId: id,
      before: null, touchedAccountIds: [],
      event: { type: "physical_asset.valuation_asserted", aggregateType: "physical_asset", aggregateId: accountId.value, payload, effectiveOn: valuation.on },
      apply: async (tx) => {
        await tx.run(sql`INSERT INTO physical_asset_valuations
          (id,user_id,asset_account_id,on_date,value_minor,currency,source,note,created_at,updated_at)
          VALUES (${id},${userId.value},${accountId.value},${payload.on},CAST(${payload.valueMinor} AS INTEGER),${payload.currency},
            ${payload.source},${payload.note},${now.getTime()},${now.getTime()})`);
        return { result: undefined, after: payload };
      },
    });
  }

  /**
   * Tombstones the asset and its live assertions, and closes its ledger account in
   * the same unit (the way the accounts screen closes one: `isClosed`, never deleted,
   * so any posting history stays readable).
   */
  async remove(userId: UserId, accountId: AccountId): Promise<void> {
    this.assertActor(userId);
    await this.live(userId, accountId);
    const now = this.context.clock.now();
    await new UnitOfWork(this.db, this.context).mutateAtomic({
      action: "SOFT_DELETE", entityType: "physical_asset", entityId: accountId.value,
      before: null, touchedAccountIds: [],
      event: { type: "physical_asset.tombstoned", aggregateType: "physical_asset", aggregateId: accountId.value, payload: {}, effectiveOn: null },
      apply: async (tx) => {
        await tx.update(physicalAssetValuations).set({ deletedAt: now, updatedAt: now })
          .where(and(eq(physicalAssetValuations.assetAccountId, accountId.value), eq(physicalAssetValuations.userId, userId.value), isNull(physicalAssetValuations.deletedAt)));
        await tx.update(physicalAssets).set({ deletedAt: now, updatedAt: now })
          .where(and(eq(physicalAssets.accountId, accountId.value), eq(physicalAssets.userId, userId.value), isNull(physicalAssets.deletedAt)));
        await tx.update(ledgerAccounts).set({ isClosed: true, updatedAt: now })
          .where(and(eq(ledgerAccounts.id, accountId.value), eq(ledgerAccounts.userId, userId.value), isNull(ledgerAccounts.deletedAt)));
        return { result: undefined, after: null };
      },
    });
  }
}
