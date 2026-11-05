"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { FinancialYear } from "@/core/time";
import { parseBornOn } from "./dob";
import { currentUserId, ensureSeeded, services } from "@/infra/container";

export interface SettingsActionState {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Every number arrives as a string.
 *
 * `z.coerce.number()` on a slab rate would hand the domain a float, and a slab
 * rate is applied to every rupee of interest, dividend and F&O profit in the
 * year — the one place a rounding artefact compounds across an entire return.
 * `Percentage.of("30")` parses exactly.
 */
const AMOUNT = z
  .string()
  .trim()
  .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 125000.00");

const PERCENT = z
  .string()
  .trim()
  .regex(/^\d{1,2}(\.\d{1,2})?$/, "Enter a rate like 30 or 5.5");

const schema = z.object({
  financialYear: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}$/, "A financial year looks like 2026-27."),
  regimeKey: z.enum(["india-fy2025", "india-fy2024"]),
  marginalSlabPercent: PERCENT,
  ltcgExemption: AMOUNT,
  usesNewRegime: z.string().optional(),
});

/**
 * Saves the tax settings for one financial year.
 *
 * Per year, not per user, and that is the whole design: reprinting last year's
 * report must produce last year's number, so this year's slab rate cannot
 * overwrite the rate last year's return was filed at. A year with no row is
 * reported as an assumption on screen rather than silently defaulted.
 */
export async function saveTaxSettingsAction(
  _previous: SettingsActionState | null,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return {
      ok: false,
      message: "Check the form.",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const userId = await currentUserId();
  await ensureSeeded(userId);

  let year: FinancialYear;
  try {
    year = FinancialYear.parse(parsed.data.financialYear);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }

  await services().repositories.taxSettings.save(userId, {
    financialYear: year.label,
    regimeKey: parsed.data.regimeKey,
    marginalSlabRate: Percentage.of(parsed.data.marginalSlabPercent),
    ltcgExemption: Money.fromRupees(parsed.data.ltcgExemption),
    usesNewRegime: parsed.data.usesNewRegime === "on",
    // Not stored: both are per-assessment inputs rather than settings, and the
    // report says so where it uses them.
    totalIncome: Money.zero(),
    residentStatus: "RESIDENT",
  });

  // The tax panel on the history screen reads this row, so it has to be
  // invalidated with the settings page itself.
  revalidatePath("/settings");
  revalidatePath("/history");
  return {
    ok: true,
    message: `Saved for ${year.label}. The tax panel now computes at ${parsed.data.marginalSlabPercent}%.`,
  };
}

/**
 * Saves (or clears) the date of birth (task 4.1). Optional: with none, the
 * projection's current age stays unknown and nothing is guessed. The owner comes
 * from the session inside `projection()`.
 */
export async function saveDateOfBirthAction(
  _previous: SettingsActionState | null,
  formData: FormData,
): Promise<SettingsActionState> {
  const parsed = parseBornOn(formData.get("bornOn"));
  if (!parsed.ok) return { ok: false, message: "Check the form.", fieldErrors: { bornOn: [parsed.message] } };

  const { userId, setDateOfBirth } = await services().projection();
  const result = await setDateOfBirth.execute({ userId, bornOn: parsed.bornOn });
  if (!result.ok) {
    const fieldErrors = "fieldErrors" in result.error ? (result.error.fieldErrors as Record<string, string[]>) : undefined;
    return { ok: false, message: result.error.userMessage, fieldErrors };
  }
  revalidatePath("/settings");
  revalidatePath("/projection");
  return { ok: true, message: parsed.bornOn ? "Date of birth saved." : "Date of birth cleared; your age is now unknown." };
}
