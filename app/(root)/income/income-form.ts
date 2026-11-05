/**
 * Parses the add-stream form into domain fields. Pure, so it is testable without
 * a request. Amounts stay strings until `Money.fromRupees`: no float ever exists.
 * A blank expected amount is an unknown price step (null), never zero.
 */
import { z } from "zod";
import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence } from "@/core/recurrence";
import { CalendarDate } from "@/core/time";
import { Days } from "@/core/units";
import type { IncomeStreamFields } from "@/domain/income";

const schema = z.object({
  name: z.string().trim().min(1, "Give the stream a name.").max(120),
  kind: z.enum(["SALARY", "FREELANCE", "BONUS", "RENT", "INTEREST", "OTHER"]),
  payer: z.string().trim().max(120).optional().or(z.literal("")),
  currency: z.enum(["INR", "USD"]),
  cadence: z.enum(["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL"]),
  anchor: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the first due date."),
  expected: z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Enter an amount like 100000 or leave it blank.").optional().or(z.literal("")),
  grace: z.string().trim().regex(/^\d{1,3}$/, "Whole days, 0 to 999."),
});

export type ParsedIncomeForm =
  | { readonly ok: true; readonly fields: Omit<IncomeStreamFields, "id"> }
  | { readonly ok: false; readonly fieldErrors: Record<string, string[]> };

export function parseIncomeForm(formData: FormData): ParsedIncomeForm {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  const input = parsed.data;
  let anchor: CalendarDate;
  try { anchor = CalendarDate.parse(input.anchor); } catch { return { ok: false, fieldErrors: { anchor: ["That date does not exist."] } }; }
  const currency = Currency.of(input.currency);
  try {
    return {
      ok: true,
      fields: {
        name: input.name,
        kind: input.kind,
        payer: input.payer || null,
        currency,
        schedule: new Recurrence({ cadence: input.cadence, anchor, endsOn: null, cancelNotice: null }),
        expected: new PriceSteps([{ from: anchor, amount: input.expected ? Money.fromRupees(input.expected, currency) : null }]),
        grace: Days(Number(input.grace)),
      },
    };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, fieldErrors: { form: [error.message] } };
    throw error;
  }
}
