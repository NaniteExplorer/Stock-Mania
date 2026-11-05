import { Currency, Money } from "@/core/money";
import { PriceSteps, Recurrence, type Cadence } from "@/core/recurrence";
import { CalendarDate } from "@/core/time";
import { Days } from "@/core/units";
import type { CoverKind, InsurancePolicyFields } from "@/domain/insurance";

/**
 * The add-policy form, parsed without a single float.
 *
 * Amounts stay decimal strings until `Money.fromRupees`; excess decimals are refused
 * here because `fromRupees` would round them. Blank sum insured, premium and notice
 * are **unknown (null)**, never zero. Only whitelisted fields are read.
 */
export type PolicyFormResult =
  | { readonly ok: true; readonly fields: Omit<InsurancePolicyFields, "id"> }
  | { readonly ok: false; readonly message: string; readonly fieldErrors: Record<string, string[]> };

export const COVER_KINDS: readonly CoverKind[] = ["HEALTH", "TERM_LIFE", "PERSONAL_ACCIDENT", "MOTOR", "HOME", "OTHER"];
export const CADENCES: readonly Cadence[] = ["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ANNUAL"];
const CURRENCIES = ["INR", "USD"] as const;
const AMOUNT = /^\d+(\.\d+)?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePolicyForm(form: FormData): PolicyFormResult {
  const errors: Record<string, string[]> = {};
  const fail = (field: string, message: string) => { (errors[field] ??= []).push(message); };

  const text = (name: string): string => {
    const values = form.getAll(name);
    if (values.length > 1) { fail(name, "Sent more than once."); return ""; }
    const value = values[0];
    if (value === undefined) return "";
    if (typeof value !== "string") { fail(name, "Must be text."); return ""; }
    return value.trim();
  };
  const oneOf = <T extends string>(name: string, allowed: readonly T[], message: string): T | null => {
    const value = text(name);
    if ((allowed as readonly string[]).includes(value)) return value as T;
    fail(name, message);
    return null;
  };
  const date = (name: string, required: boolean, label: string): CalendarDate | null => {
    const value = text(name);
    if (!value) { if (required) fail(name, `Enter ${label}.`); return null; }
    if (!ISO_DATE.test(value)) { fail(name, "Use a date like 2026-04-01."); return null; }
    try { return CalendarDate.parse(value); } catch { fail(name, "Not a real date."); return null; }
  };

  const kind = oneOf("kind", COVER_KINDS, "Pick a kind of cover.");
  const insurer = text("insurer");
  if (!insurer) fail("insurer", "Name the insurer.");
  else if (insurer.length > 120) fail("insurer", "Keep it under 120 characters.");
  const insured = text("insured");
  if (!insured) fail("insured", "Say whom it covers, e.g. Self + spouse.");
  else if (insured.length > 120) fail("insured", "Keep it under 120 characters.");
  const currencyCode = oneOf("currency", CURRENCIES, "Pick a currency.");
  const currency = currencyCode ? Currency.of(currencyCode) : null;
  const cadence = oneOf("cadence", CADENCES, "Pick how often the premium is due.");
  const startsOn = date("startsOn", true, "the day cover started");
  const endsOn = date("endsOn", false, "an end date");
  if (startsOn && endsOn && endsOn.isBefore(startsOn)) fail("endsOn", "Cover cannot end before it starts.");

  const money = (name: string, positive: boolean): Money | null => {
    const value = text(name);
    if (!value || !currency) return null;
    const decimals = value.split(".")[1]?.length ?? 0;
    if (!AMOUNT.test(value) || decimals > currency.exponent) {
      fail(name, `Enter an amount like 12500.50, at most ${currency.exponent} decimals.`);
      return null;
    }
    const amount = Money.fromRupees(value, currency);
    if (positive && !amount.isPositive) { fail(name, "When entered, it must be more than zero."); return null; }
    return amount;
  };
  const sumInsured = money("sumInsured", true);
  const premium = money("premium", false);

  let notice: Days | null = null;
  const noticeText = text("cancelNoticeDays");
  if (noticeText) {
    if (!/^\d{1,4}$/.test(noticeText)) fail("cancelNoticeDays", "Whole days, 0 to 9999.");
    else notice = Days(Number(noticeText));
  }

  if (Object.keys(errors).length > 0 || !kind || !currency || !cadence || !startsOn) {
    return { ok: false, message: "Check the highlighted fields.", fieldErrors: errors };
  }
  try {
    const premiumSchedule = new Recurrence({ cadence, anchor: startsOn, endsOn: null, cancelNotice: notice });
    return {
      ok: true,
      fields: {
        kind, insurer, insured, sumInsured, currency, premiumSchedule, endsOn,
        premium: new PriceSteps([{ from: startsOn, amount: premium }]),
      },
    };
  } catch (error) {
    if (error instanceof RangeError) return { ok: false, message: error.message, fieldErrors: {} };
    throw error;
  }
}
