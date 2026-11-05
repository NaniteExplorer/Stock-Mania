import { UserId } from "@/core/kernel";
import { Currency, Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { Account, AccountCode, AccountType } from "@/domain/accounts";
import { OtherPhysicalAsset, RealEstate, Vehicle } from "@/domain/assets";
import { AgeSchedule, MOTOR_IDV_SCHEDULE, StraightLine } from "@/domain/depreciation";
import { Months } from "@/core/units";
import type { PhysicalDepreciationSpec } from "@/domain/physical-asset-store";
import { decodePhysicalAsset, decodePhysicalModel, encodePhysicalAsset, encodePhysicalModel } from "@/infra/physical-asset-codec";
import { check, done, section, throws } from "./harness";

const d = CalendarDate.parse;
const account = (currency: "INR" | "USD") => Account.open({ userId: UserId.from("physical-codec-owner"), name: "Item", type: AccountType.ASSET, code: AccountCode.parse("Assets:Physical:Item"), currency: Currency.of(currency) });

section("all kinds preserve exact assertions, account currency and unknowns");
for (const currency of ["INR", "USD"] as const) for (const Constructor of [RealEstate, Vehicle, OtherPhysicalAsset]) {
  const a = account(currency);
  const input = new Constructor(a, [{ on: d("2026-02-28"), value: Money.fromMinor(9007199254740993n, a.currency), source: "PROFESSIONAL_VALUATION", note: "Exact" }], { on: d("2025-01-01"), price: Money.fromMinor(9223372036854775807n, a.currency) });
  const encoded = encodePhysicalAsset({ asset: input, model: null });
  const decoded = decodePhysicalAsset(a, encoded.header, encoded.valuations);
  check("kind survives", decoded.asset.kind, input.kind);
  check("purchase signed64 max survives", decoded.asset.purchase?.price.minor, 9223372036854775807n);
  check("assertion above JS safe range survives", decoded.asset.valueOn(d("2026-03-01"))?.minor, 9007199254740993n);
  check("currency from authoritative account", decoded.asset.currency.code, currency);
  check("model remains absent", decoded.model, null);
  const unknown = encodePhysicalAsset({ asset: new Constructor(a, []), model: null });
  check("unknown purchase remains absent", decodePhysicalAsset(a, unknown.header, []).asset.purchase, undefined);
  check("unknown value never becomes purchase/model", decodePhysicalAsset(a, unknown.header, []).asset.valueOn(d("2026-01-01")), null);
  const zero = encodePhysicalAsset({ asset: new Constructor(a, [{ on: d("2026-01-01"), value: Money.zero(a.currency), source: "SELF_ASSESSED" }]), model: null });
  check("known zero survives", decodePhysicalAsset(a, zero.header, zero.valuations).asset.valueOn(d("2026-01-01"))?.minor, 0n);
}

section("models keep full scaled percentages and shipped identity");
const huge = Percentage.fromScaled(123456789012345678901234567890n);
const models: PhysicalDepreciationSpec[] = [
  { kind: "DECLINING", rate: Percentage.of("15.123456"), basis: "Owner assumption" },
  { kind: "STRAIGHT", rate: huge, floor: Percentage.of("0.123456"), basis: "Owner assumption" },
  { kind: "SCHEDULE", scheduleId: "MOTOR_IDV" },
];
for (const model of models) {
  const row = encodePhysicalModel(model);
  const decoded = decodePhysicalModel(row);
  check("model basis survives", decoded?.basis, model.kind === "SCHEDULE" ? MOTOR_IDV_SCHEDULE.basis : model.basis);
  if (model.kind !== "SCHEDULE") check("rate serialized exactly", row.ratePercentScaled, model.rate.scaled.toString());
}
const straight = decodePhysicalModel(encodePhysicalModel(models[1]!));
check("huge straight rate rehydrates", straight instanceof StraightLine ? straight.rate.scaled : null, huge.scaled);
check("fractional floor rehydrates", straight instanceof StraightLine ? straight.floor.scaled : null, 123456n);
check("shipped schedule comes from code", decodePhysicalModel(encodePhysicalModel(models[2]!)), MOTOR_IDV_SCHEDULE);
throws("custom schedule id refused", () => encodePhysicalModel({ kind: "SCHEDULE", scheduleId: "CUSTOM" } as unknown as PhysicalDepreciationSpec), "shipped");
const customSchedule = new AgeSchedule(MOTOR_IDV_SCHEDULE.name, [{ underMonths: Months(12), off: Percentage.of(99) }], MOTOR_IDV_SCHEDULE.basis);
throws("custom class with shipped name cannot be mistaken for shipped schedule", () => encodePhysicalModel(customSchedule as unknown as PhysicalDepreciationSpec), "specification");
throws("blank model basis refused", () => encodePhysicalModel({ kind: "DECLINING", rate: Percentage.of(10), basis: "\u00a0" }), "basis");
throws("zero straight rate refused", () => encodePhysicalModel({ kind: "STRAIGHT", rate: Percentage.of(0), floor: Percentage.of(0), basis: "Owner" }), "above zero");
throws("100 declining rate refused", () => encodePhysicalModel({ kind: "DECLINING", rate: Percentage.of(100), basis: "Owner" }), "100%");
const noModel = encodePhysicalModel(null);
throws("absent model cannot hide fields", () => decodePhysicalModel({ ...noModel, modelBasis: "Owner" }), "conflicting");
for (const value of ["01", "-1", "1.0", "1e6", " 1", "+1"]) throws("noncanonical rate refused", () => decodePhysicalModel({ ...noModel, modelKind: "DECLINING", ratePercentScaled: value, modelBasis: "Owner" }), "canonical");

section("corrupt persisted facts refuse without fabrication");
const a = account("INR");
const encoded = encodePhysicalAsset({ asset: new Vehicle(a, []), model: null });
throws("foreign identity refused", () => decodePhysicalAsset(account("INR"), encoded.header, []), "identity");
throws("unsupported kind refused", () => decodePhysicalAsset(a, { ...encoded.header, kind: "PHYSICAL_GOLD" }, []), "Unsupported");
throws("partial purchase refused", () => decodePhysicalAsset(a, { ...encoded.header, purchaseOn: "2026-01-01" }, []), "both");
throws("impossible date refused", () => decodePhysicalAsset(a, { ...encoded.header, purchaseOn: "2026-02-30", purchasePriceMinor: "1" }, []), "range");
throws("zero purchase refused", () => decodePhysicalAsset(a, { ...encoded.header, purchaseOn: "2026-01-01", purchasePriceMinor: "0" }, []), "positive");
throws("overflow money refused", () => decodePhysicalAsset(a, { ...encoded.header, purchaseOn: "2026-01-01", purchasePriceMinor: "9223372036854775808" }, []), "signed64");
throws("write rejects overflow too", () => encodePhysicalAsset({ asset: new Vehicle(a, [], { on: d("2026-01-01"), price: Money.fromMinor(9223372036854775808n, a.currency) }), model: null }), "signed64");
const observation = { on: "2026-01-01", valueMinor: "0", source: "SELF_ASSESSED", note: null };
throws("unknown source refused", () => decodePhysicalAsset(a, encoded.header, [{ ...observation, source: "MODEL" }]), "source");
throws("duplicate date refused", () => decodePhysicalAsset(a, encoded.header, [observation, observation]), "one asserted");
throws("prepurchase observation refused", () => decodePhysicalAsset(a, { ...encoded.header, purchaseOn: "2026-02-01", purchasePriceMinor: "1" }, [observation]), "predate");
throws("negative assertion refused", () => decodePhysicalAsset(a, encoded.header, [{ ...observation, valueMinor: "-1" }]), "canonical");
throws("unsafe numeric assertion refused", () => decodePhysicalAsset(a, encoded.header, [{ ...observation, valueMinor: 12 as unknown as string }]), "canonical");
done();
