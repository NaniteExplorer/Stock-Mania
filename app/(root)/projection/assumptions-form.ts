/**
 * Parses the projection assumptions form into AssumptionChange values. Pure.
 *
 * Every field is a string. An empty field means "unknown" and is saved as null —
 * never as zero. Percentages are entered as percent and stored as fractions,
 * rounded to six places so a typed 6.5 is not stored as 0.065000000001.
 */
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { Count, Ratio, Years } from "@/core/units";
import type { AssumptionChange } from "@/app/projection.usecases";
import type { AssumptionKey } from "@/domain/projection/assumptions";

type Kind = "years" | "percent" | "rupees" | "count";

export const FORM_FIELDS: readonly { readonly key: AssumptionKey; readonly kind: Kind; readonly regulatory?: boolean }[] = Object.freeze([
  { key: "retirementAge", kind: "years" },
  { key: "horizonAge", kind: "years" },
  { key: "inflation", kind: "percent" },
  { key: "withdrawalRate", kind: "percent" },
  { key: "monthlyContribution", kind: "rupees" },
  { key: "equityShare", kind: "percent" },
  { key: "blockYears", kind: "count" },
  { key: "npsAnnuityShareNonGovt", kind: "percent", regulatory: true },
  { key: "npsAnnuityShareGovt", kind: "percent", regulatory: true },
]);

export const NPS_VERIFIED_FIELD = "npsVerifiedOn";

const NUMBER = /^-?\d+(\.\d+)?$/;
const RUPEES = /^\d+(\.\d{1,2})?$/;

export type ParsedAssumptions =
  | { readonly ok: true; readonly changes: readonly AssumptionChange[] }
  | { readonly ok: false; readonly fieldErrors: Record<string, string[]> };

export function parseAssumptionsForm(form: Readonly<Record<string, unknown>>): ParsedAssumptions {
  const errors: Record<string, string[]> = {};
  const text = (name: string): string => {
    const value = form[name];
    if (value != null && typeof value !== "string") errors[name] = ["Enter a text value."];
    return typeof value === "string" ? value.trim() : "";
  };

  let verifiedOn: CalendarDate | null = null;
  const verifiedText = text(NPS_VERIFIED_FIELD);
  if (verifiedText) {
    try {
      verifiedOn = CalendarDate.parse(verifiedText);
    } catch {
      errors[NPS_VERIFIED_FIELD] = ["Enter a date like 2026-10-30."];
    }
  }

  const changes: AssumptionChange[] = [];
  for (const field of FORM_FIELDS) {
    const raw = text(field.key);
    if (raw === "") {
      changes.push({ key: field.key, value: null });
      continue;
    }
    try {
      changes.push({ key: field.key, value: convert(field.kind, raw) as never, verifiedOn: field.regulatory ? verifiedOn : null });
    } catch (error) {
      errors[field.key] = [(error as Error).message];
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, fieldErrors: errors } : { ok: true, changes: Object.freeze(changes) };
}

function convert(kind: Kind, raw: string): unknown {
  if (kind === "rupees") {
    if (!RUPEES.test(raw)) throw new RangeError("Enter an amount like 25000 or 25000.50.");
    return Money.fromRupees(raw);
  }
  if (!NUMBER.test(raw)) throw new RangeError("Enter a number.");
  const n = Number(raw);
  if (kind === "percent") return Ratio(Number((n / 100).toFixed(6)));
  if (kind === "count") return Count(n);
  return Years(n);
}

/** The form's display value for a stored ratio: 0.065 → "6.5". */
export function percentText(value: number | null): string {
  return value === null ? "" : String(Number((value * 100).toFixed(4)));
}
