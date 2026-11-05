"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence } from "@/core/recurrence";
import { CalendarDate } from "@/core/time";
import { Days } from "@/core/units";
import { services } from "@/infra/container";
import { fail, ok, type ActionState } from "@/ui/action-state";

const DATE = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const schema = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(120),
  kind: z.enum(["STREAMING", "MOBILE", "BROADBAND", "EDUCATION", "MEMBERSHIP", "SOFTWARE", "OTHER"]),
  cadence: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL"]),
  startsOn: DATE,
  // A string, never a coerced number: the amount goes straight to Money.fromRupees.
  // Blank means "not known yet" and is stored as an unknown price, never as zero.
  price: z.string().trim().regex(/^(\d+(\.\d{1,2})?)?$/, "Enter an amount like 649 or 649.00"),
  cancelNoticeDays: z.string().trim().regex(/^(\d{1,3})?$/, "Whole days, or leave blank if not known"),
  endsOn: DATE.optional().or(z.literal("")),
  autoRenews: z.literal("on").optional(),
});

/** Creates a commitment for the signed-in owner. The owner comes from the session, never the form. */
export async function createCommitmentAction(_previous: ActionState | null, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse({
    name: formData.get("name") ?? "", kind: formData.get("kind") ?? "", cadence: formData.get("cadence") ?? "",
    startsOn: formData.get("startsOn") ?? "", price: formData.get("price") ?? "",
    cancelNoticeDays: formData.get("cancelNoticeDays") ?? "", endsOn: formData.get("endsOn") ?? "",
    autoRenews: formData.get("autoRenews") ?? undefined,
  });
  if (!parsed.success) return fail("Check the form.", z.flattenError(parsed.error).fieldErrors as Record<string, string[]>);
  const input = parsed.data;
  const currency = Currency.reporting;

  try {
    const { userId, createCommitment } = await services().manualFinance();
    let anchor: CalendarDate;
    let endsOn: CalendarDate | null = null;
    try { anchor = CalendarDate.parse(input.startsOn); }
    catch { return fail("Check the form.", { startsOn: ["Pick a valid calendar date."] }); }
    if (input.endsOn) {
      try { endsOn = CalendarDate.parse(input.endsOn); }
      catch { return fail("Check the form.", { endsOn: ["Pick a valid calendar date."] }); }
    }
    const result = await createCommitment.execute({
      userId,
      fields: {
        name: input.name, kind: input.kind, currency,
        schedule: new Recurrence({
          cadence: input.cadence, anchor, endsOn: null,
          cancelNotice: input.cancelNoticeDays === "" ? null : Days(Number(input.cancelNoticeDays)),
        }),
        price: new PriceSteps([{ from: anchor, amount: input.price === "" ? null : Money.fromRupees(input.price, currency) }]),
        autoRenews: input.autoRenews === "on",
        endsOn,
      },
    });
    if (!result.ok) return fail(result.error.message);
  } catch (error) {
    // A domain refusal arrives as a Result above. Anything else is unexpected: log
    // it and say it was not saved (the write is atomic), rather than letting the
    // route's error boundary claim that the *read* failed.
    if (error instanceof RangeError) return fail(error.message);
    console.error("createCommitmentAction failed", error);
    return fail("Not saved — the commitment could not be stored. Nothing was changed; try again.");
  }

  revalidatePath("/commitments");
  return ok(`${input.name} added.`);
}
