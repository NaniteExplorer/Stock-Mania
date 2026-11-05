"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { AccountId } from "@/domain/accounts";
import type { PhysicalDepreciationSpec } from "@/domain/physical-asset-store";
import { ensureSeeded, services } from "@/infra/container";

export interface AssetActionState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

const AMOUNT = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 850000.00");
const PERCENT = z.string().trim().regex(/^\d+(\.\d{1,4})?$/, "Enter a percentage like 15");
const DATE = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const SOURCE = z.enum(["PROFESSIONAL_VALUATION", "MARKET_COMPARABLE", "PURCHASE_PRICE", "SELF_ASSESSED"]);
const optional = <T extends z.ZodType>(schema: T) => schema.optional().or(z.literal(""));

const createSchema = z
  .object({
    name: z.string().trim().min(1, "Give the asset a name.").max(120),
    kind: z.enum(["REAL_ESTATE", "VEHICLE", "OTHER"]),
    purchaseOn: optional(DATE),
    purchasePrice: optional(AMOUNT),
    model: z.enum(["NONE", "DECLINING", "STRAIGHT", "SCHEDULE"]),
    rate: optional(PERCENT),
    floor: optional(PERCENT),
    basis: z.string().trim().max(200).optional(),
    valuedOn: optional(DATE),
    value: optional(AMOUNT),
    source: SOURCE,
    note: z.string().trim().max(200).optional(),
  })
  .refine((v) => Boolean(v.purchaseOn) === Boolean(v.purchasePrice), { message: "Give both the purchase date and price, or neither.", path: ["purchasePrice"] })
  .refine((v) => Boolean(v.valuedOn) === Boolean(v.value), { message: "Give both the valuation date and value, or neither.", path: ["value"] })
  .refine((v) => v.model === "NONE" || v.model === "SCHEDULE" || Boolean(v.rate), { message: "This model needs a rate.", path: ["rate"] })
  .refine((v) => v.model !== "STRAIGHT" || Boolean(v.floor), { message: "Straight line needs a floor.", path: ["floor"] })
  .refine((v) => v.model === "NONE" || v.model === "SCHEDULE" || Boolean(v.basis), { message: "Say where the rate comes from.", path: ["basis"] });

const valuationSchema = z.object({
  accountId: z.string().uuid(),
  valuedOn: DATE,
  value: AMOUNT,
  source: SOURCE,
  note: z.string().trim().max(200).optional(),
});

function invalid(error: z.ZodError): AssetActionState {
  const flattened = z.flattenError(error);
  return { ok: false, message: flattened.formErrors[0] ?? "Check the form.", fieldErrors: flattened.fieldErrors as Record<string, string[]> };
}

/** Parses a well-formed date that may still not exist (2026-02-30); null when it does not. */
function dateOf(text: string): CalendarDate | null {
  try { return CalendarDate.parse(text); } catch { return null; }
}

const badDate = (field: string): AssetActionState => ({ ok: false, message: "Check the form.", fieldErrors: { [field]: ["Pick a valid calendar date."] } });

function refresh(): void {
  revalidatePath("/assets");
  revalidatePath("/accounts");
  revalidatePath("/dashboard");
}

const modelSchema = z
  .object({
    accountId: z.string().uuid(),
    model: z.enum(["NONE", "DECLINING", "STRAIGHT", "SCHEDULE"]),
    rate: optional(PERCENT),
    floor: optional(PERCENT),
    basis: z.string().trim().max(200).optional(),
  })
  .refine((v) => v.model === "NONE" || v.model === "SCHEDULE" || Boolean(v.rate), { message: "This model needs a rate.", path: ["rate"] })
  .refine((v) => v.model !== "STRAIGHT" || Boolean(v.floor), { message: "Straight line needs a floor.", path: ["floor"] })
  .refine((v) => v.model === "NONE" || v.model === "SCHEDULE" || Boolean(v.basis), { message: "Say where the rate comes from.", path: ["basis"] });

const linkSchema = z.object({ accountId: z.string().uuid(), postingId: z.string().trim().min(1, "Choose the posting that paid for the asset.").max(64) });

type ModelFields = Pick<z.infer<typeof createSchema>, "model" | "rate" | "floor" | "basis">;

function modelOf(input: ModelFields): PhysicalDepreciationSpec | null {
  switch (input.model) {
    case "NONE": return null;
    case "SCHEDULE": return { kind: "SCHEDULE", scheduleId: "MOTOR_IDV" };
    case "DECLINING": return { kind: "DECLINING", rate: Percentage.of(input.rate!), basis: input.basis! };
    case "STRAIGHT": return { kind: "STRAIGHT", rate: Percentage.of(input.rate!), floor: Percentage.of(input.floor!), basis: input.basis! };
  }
}

/** Opens the asset's ledger account and stores the asset in audited writes. */
export async function createAssetAction(_previous: AssetActionState | null, formData: FormData): Promise<AssetActionState> {
  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;
  const purchaseOn = input.purchaseOn ? dateOf(input.purchaseOn) : null;
  if (input.purchaseOn && !purchaseOn) return badDate("purchaseOn");
  const valuedOn = input.valuedOn ? dateOf(input.valuedOn) : null;
  if (input.valuedOn && !valuedOn) return badDate("valuedOn");
  const writes = await services().physicalAssets.writes();
  await ensureSeeded(writes.userId);
  let model: PhysicalDepreciationSpec | null;
  try {
    model = modelOf(input);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  const result = await writes.create.execute({
    userId: writes.userId,
    name: input.name,
    kind: input.kind,
    purchase: purchaseOn && input.purchasePrice ? { on: purchaseOn, price: Money.fromRupees(input.purchasePrice) } : undefined,
    model,
    firstValuation: valuedOn && input.value
      ? { on: valuedOn, value: Money.fromRupees(input.value), source: input.source, ...(input.note ? { note: input.note } : {}) }
      : undefined,
  });
  if (!result.ok) return { ok: false, message: result.error.message };
  refresh();
  return { ok: true, message: `${input.name} added.` };
}

/** Records a dated, sourced valuation. Never edits an earlier one. */
export async function assertValuationAction(_previous: AssetActionState | null, formData: FormData): Promise<AssetActionState> {
  const parsed = valuationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const input = parsed.data;
  const on = dateOf(input.valuedOn);
  if (!on) return badDate("valuedOn");
  const writes = await services().physicalAssets.writes();
  const result = await writes.assertValuation.execute({
    userId: writes.userId,
    accountId: AccountId.from(input.accountId),
    on,
    value: Money.fromRupees(input.value),
    source: input.source,
    note: input.note || undefined,
  });
  if (!result.ok) return { ok: false, message: result.error.message };
  refresh();
  return { ok: true, message: "Valuation recorded." };
}

/** Replaces the asset's depreciation model. The model is labelled a model; it never becomes a stored value. */
export async function replaceModelAction(_previous: AssetActionState | null, formData: FormData): Promise<AssetActionState> {
  const parsed = modelSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  let model: PhysicalDepreciationSpec | null;
  try {
    model = modelOf(parsed.data);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  const writes = await services().physicalAssets.writes();
  const result = await writes.replaceModel.execute({ userId: writes.userId, accountId: AccountId.from(parsed.data.accountId), model });
  if (!result.ok) return { ok: false, message: result.error.message };
  refresh();
  return { ok: true, message: model ? "Depreciation model saved." : "Depreciation model cleared." };
}

/** Names an expense posting as the asset's acquisition (1.8); the rules refuse with a reason. */
export async function linkAcquisitionAction(_previous: AssetActionState | null, formData: FormData): Promise<AssetActionState> {
  const parsed = linkSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return invalid(parsed.error);
  const links = await services().assetAcquisitions();
  const result = await links.link.execute({ userId: links.userId, assetAccountId: parsed.data.accountId, postingId: parsed.data.postingId });
  if (!result.ok) return { ok: false, message: result.error.message };
  refresh();
  return { ok: true, message: `Linked to ${result.value.description}.` };
}

/** Tombstones the asset's acquisition link. */
export async function unlinkAcquisitionAction(formData: FormData): Promise<void> {
  const accountId = z.string().uuid().parse(formData.get("accountId"));
  const links = await services().assetAcquisitions();
  const result = await links.unlink.execute({ userId: links.userId, assetAccountId: accountId });
  if (!result.ok) throw new Error(result.error.message);
  refresh();
}

/** Tombstones the asset and its valuations; restorable, never deleted. */
export async function removeAssetAction(formData: FormData): Promise<void> {
  const accountId = z.string().uuid().parse(formData.get("accountId"));
  const writes = await services().physicalAssets.writes();
  const result = await writes.remove.execute({ userId: writes.userId, accountId: AccountId.from(accountId) });
  if (!result.ok) throw new Error(result.error.message);
  refresh();
}
