import { percentage } from "@/core/format";
import { Percentage } from "@/core/numeric";

/** The DTO carries the unit; labels and indicator names never determine the scale. */
export function formatAnalysisValue(value: number | null | undefined, unit?: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (unit === "RATIO") {
    const points = value * 100;
    const decimal = Number.isFinite(points)
      ? new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 6 }).format(points)
      : null;
    return decimal === null ? "—" : percentage(Percentage.of(decimal));
  }
  // Technical price levels retain UnitPrice's established 1e8 scale internally.
  const display = unit === "PRICE_LEVEL" ? value / 1e8 : value;
  const text = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(display);
  return unit === "PERCENTAGE" ? `${text}%` : text;
}
