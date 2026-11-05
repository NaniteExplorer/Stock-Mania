"use server";

import { revalidatePath } from "next/cache";
import { services } from "@/infra/container";
import { fail, ok, type ActionState } from "@/ui/action-state";
import { scaledShare, sharesFromForm, sleevesToSubmit, totalOf } from "./allocation-model";

function revalidate() {
  revalidatePath("/settings/allocation");
  revalidatePath("/signals");
}

/** Replaces the whole target allocation. The domain refuses anything not exactly 100%. */
export async function recordAllocationAction(_previous: ActionState | null, formData: FormData): Promise<ActionState> {
  const entries = sharesFromForm(formData.entries());
  const total = totalOf(entries);
  if (total.kind === "invalid") {
    return fail("Check the shares.", Object.fromEntries(total.ids.map((id) => [`share:${id}`, ["Enter a percent such as 40 or 12.5 (at most six decimals)."]])));
  }
  const sleeves = sleevesToSubmit(entries);
  if (sleeves.length === 0) return fail("Give at least one holding a target share.");
  if (!total.complete) return fail(`Targets must add up to exactly 100%. They add up to ${total.text}%.`);
  try {
    const { userId, record } = await services().targetAllocation.writes();
    const result = await record.execute({ userId, sleeves });
    if (!result.ok) return fail(result.error.message);
  } catch (error) {
    console.error("recordAllocationAction failed", error);
    return fail("Not saved — the target allocation could not be stored. Nothing was changed; try again.");
  }
  revalidate();
  return ok("Target allocation saved.");
}

/** Tombstones the stored allocation (class B). */
export async function removeAllocationAction(_previous: ActionState | null, _formData: FormData): Promise<ActionState> {
  try {
    const { userId, remove } = await services().targetAllocation.writes();
    const result = await remove.execute({ userId });
    if (!result.ok) return fail(result.error.message);
  } catch (error) {
    console.error("removeAllocationAction failed", error);
    return fail("Not removed — nothing was changed; try again.");
  }
  revalidate();
  return ok("Target allocation cleared.");
}

/** Records the owner's band. No default: both figures are typed; the domain enforces the floor. */
export async function recordBandAction(_previous: ActionState | null, formData: FormData): Promise<ActionState> {
  const absolute = String(formData.get("absolute") ?? "").trim();
  const relative = String(formData.get("relative") ?? "").trim();
  const fieldErrors: Record<string, string[]> = {};
  if (scaledShare(absolute) === null) fieldErrors.absolute = ["Enter percentage points, e.g. 6 or 7.5."];
  if (scaledShare(relative) === null) fieldErrors.relative = ["Enter a percent, e.g. 30."];
  if (Object.keys(fieldErrors).length > 0) return fail("Check the band.", fieldErrors);
  try {
    const { userId, record } = await services().rebalancingBand.writes();
    const result = await record.execute({ userId, absolute, relative });
    if (!result.ok) return fail(result.error.message);
  } catch (error) {
    console.error("recordBandAction failed", error);
    return fail("Not saved — the band could not be stored. Nothing was changed; try again.");
  }
  revalidate();
  return ok("Rebalancing band saved.");
}

/** Tombstones the band; the board returns to UNKNOWN. */
export async function removeBandAction(_previous: ActionState | null, _formData: FormData): Promise<ActionState> {
  try {
    const { userId, remove } = await services().rebalancingBand.writes();
    const result = await remove.execute({ userId });
    if (!result.ok) return fail(result.error.message);
  } catch (error) {
    console.error("removeBandAction failed", error);
    return fail("Not removed — nothing was changed; try again.");
  }
  revalidate();
  return ok("Rebalancing band cleared.");
}
