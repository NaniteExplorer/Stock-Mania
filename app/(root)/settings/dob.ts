import { CalendarDate } from "@/core/time";

/** Parses the optional date of birth: empty clears it, anything else must be YYYY-MM-DD. Pure. */
export function parseBornOn(raw: unknown): { ok: true; bornOn: CalendarDate | null } | { ok: false; message: string } {
  if (raw != null && typeof raw !== "string") return { ok: false, message: "Enter a date like 1990-04-15." };
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text === "") return { ok: true, bornOn: null };
  try {
    return { ok: true, bornOn: CalendarDate.parse(text) };
  } catch {
    return { ok: false, message: "Enter a date like 1990-04-15." };
  }
}
