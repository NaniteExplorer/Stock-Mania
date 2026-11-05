/** Pure persistence boundary. Money columns must be selected as TEXT, never JS numbers. */
import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import type { Account } from "@/domain/accounts";
import { OtherPhysicalAsset, RealEstate, Vehicle, type ValuationSource } from "@/domain/assets";
import { DecliningBalance, MOTOR_IDV_SCHEDULE, StraightLine, type DepreciationModel } from "@/domain/depreciation";
import type { PhysicalAssetCreation, PhysicalAssetRecord, PhysicalDepreciationSpec } from "@/domain/physical-asset-store";

export interface PhysicalModelColumns {
  readonly modelKind: string | null;
  readonly ratePercentScaled: string | null;
  readonly floorPercentScaled: string | null;
  readonly modelBasis: string | null;
  readonly scheduleId: string | null;
}

export interface PhysicalAssetColumns extends PhysicalModelColumns {
  readonly accountId: string;
  readonly kind: string;
  readonly purchaseOn: string | null;
  readonly purchasePriceMinor: string | null;
}

export interface PhysicalValuationColumns {
  readonly on: string;
  readonly valueMinor: string;
  readonly source: string;
  readonly note: string | null;
}

const NO_MODEL: PhysicalModelColumns = Object.freeze({ modelKind: null, ratePercentScaled: null, floorPercentScaled: null, modelBasis: null, scheduleId: null });
const MAX_MINOR = 9223372036854775807n;
const SOURCES: ReadonlySet<string> = new Set(["PROFESSIONAL_VALUATION", "MARKET_COMPARABLE", "PURCHASE_PRICE", "SELF_ASSESSED"]);

function integer(text: string): bigint {
  if (typeof text !== "string" || !/^(0|[1-9]\d*)$/.test(text)) throw new RangeError("Expected a canonical nonnegative integer string.");
  return BigInt(text);
}

function minor(text: string): bigint {
  const value = integer(text);
  if (value > MAX_MINOR) throw new RangeError("Money exceeds signed64 storage.");
  return value;
}

function date(text: string): CalendarDate {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new RangeError("Expected a canonical calendar date.");
  const result = CalendarDate.parse(text);
  if (result.toISO() !== text) throw new RangeError("Expected a canonical calendar date.");
  return result;
}

function basis(text: string | null): string {
  if (typeof text !== "string" || text.trim() === "") throw new RangeError("A depreciation basis is required.");
  return text;
}

export function decodePhysicalModel(row: PhysicalModelColumns): DepreciationModel | null {
  if (row.modelKind === null) {
    if (row.ratePercentScaled !== null || row.floorPercentScaled !== null || row.modelBasis !== null || row.scheduleId !== null) throw new RangeError("Absent model has conflicting fields.");
    return null;
  }
  if (row.modelKind === "SCHEDULE") {
    if (row.scheduleId !== "MOTOR_IDV" || row.ratePercentScaled !== null || row.floorPercentScaled !== null || row.modelBasis !== null) throw new RangeError("Only the shipped MOTOR_IDV schedule can be stored.");
    return MOTOR_IDV_SCHEDULE;
  }
  if (row.scheduleId !== null || row.ratePercentScaled === null) throw new RangeError("Invalid model fields.");
  const rate = Percentage.fromScaled(integer(row.ratePercentScaled));
  if (row.modelKind === "DECLINING") {
    if (row.floorPercentScaled !== null) throw new RangeError("Declining model cannot carry a floor.");
    return new DecliningBalance(rate, basis(row.modelBasis));
  }
  if (row.modelKind === "STRAIGHT" && row.floorPercentScaled !== null) return new StraightLine(rate, Percentage.fromScaled(integer(row.floorPercentScaled)), basis(row.modelBasis));
  throw new RangeError("Unknown or incomplete depreciation model.");
}

export function encodePhysicalModel(spec: PhysicalDepreciationSpec | null): PhysicalModelColumns {
  if (spec === null) return NO_MODEL;
  let row: PhysicalModelColumns;
  switch (spec.kind) {
    case "DECLINING": row = { ...NO_MODEL, modelKind: spec.kind, ratePercentScaled: spec.rate.scaled.toString(), modelBasis: spec.basis }; break;
    case "STRAIGHT": row = { ...NO_MODEL, modelKind: spec.kind, ratePercentScaled: spec.rate.scaled.toString(), floorPercentScaled: spec.floor.scaled.toString(), modelBasis: spec.basis }; break;
    case "SCHEDULE": row = { ...NO_MODEL, modelKind: spec.kind, scheduleId: spec.scheduleId }; break;
    default: throw new RangeError("Unknown depreciation model specification.");
  }
  decodePhysicalModel(row);
  return Object.freeze(row);
}

/** The passed account supplies both identity and currency; owner/live checks belong to the repository. */
export function decodePhysicalAsset(account: Account, row: PhysicalAssetColumns, valuations: readonly PhysicalValuationColumns[]): PhysicalAssetRecord {
  if (row.accountId !== account.id.value) throw new RangeError("Physical account identity mismatch.");
  if ((row.purchaseOn === null) !== (row.purchasePriceMinor === null)) throw new RangeError("Purchase date and price must both be present or absent.");
  const purchase = row.purchaseOn === null ? undefined : { on: date(row.purchaseOn), price: Money.fromMinor(minor(row.purchasePriceMinor!), account.currency) };
  const history = valuations.map((value) => {
    if (!SOURCES.has(value.source)) throw new RangeError("Unknown valuation source.");
    if (value.note !== null && typeof value.note !== "string") throw new RangeError("Invalid valuation note.");
    return { on: date(value.on), value: Money.fromMinor(minor(value.valueMinor), account.currency), source: value.source as ValuationSource, ...(value.note === null ? {} : { note: value.note }) };
  });
  const constructors = { REAL_ESTATE: RealEstate, VEHICLE: Vehicle, OTHER: OtherPhysicalAsset };
  if (!Object.hasOwn(constructors, row.kind)) throw new RangeError("Unsupported physical asset kind.");
  const Constructor = constructors[row.kind as keyof typeof constructors];
  return Object.freeze({ asset: new Constructor(account, history, purchase), model: decodePhysicalModel(row) });
}

export function encodePhysicalAsset(record: PhysicalAssetCreation): { readonly header: PhysicalAssetColumns; readonly valuations: readonly PhysicalValuationColumns[] } {
  const { asset } = record;
  const header = Object.freeze({ accountId: asset.id.value, kind: asset.kind, purchaseOn: asset.purchase?.on.toISO() ?? null, purchasePriceMinor: asset.purchase?.price.minor.toString() ?? null, ...encodePhysicalModel(record.model) });
  const valuations = Object.freeze(asset.valuations.map((value) => Object.freeze({ on: value.on.toISO(), valueMinor: value.value.minor.toString(), source: value.source, note: value.note ?? null })));
  // Revalidate constructors and storage bounds. Never trust a previously constructed mutable object.
  if (asset.purchase && asset.purchase.price.currency.code !== asset.currency.code) throw new RangeError("Purchase currency mismatch.");
  if (asset.valuations.some((value) => value.value.currency.code !== asset.currency.code)) throw new RangeError("Valuation currency mismatch.");
  decodePhysicalAsset(asset.account, header, valuations);
  return Object.freeze({ header, valuations });
}
