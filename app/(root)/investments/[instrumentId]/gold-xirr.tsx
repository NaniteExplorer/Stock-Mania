import type { Xirr } from "@/domain/portfolio";
import { formatPercent } from "@/ui/format";

/**
 * A money-weighted return, or the reason there isn't one.
 *
 * `30-CALCULATIONS.md` §4.1 exists because v1 rendered an undefined rate as
 * `0%` — a claim that the investment broke even. It did not; we simply cannot
 * say. So the failure branch renders the solver's own `because` string and
 * never a number, a dash, or a blank.
 */
export function XirrValue({ value, size = "md" }: { value: Xirr; size?: "sm" | "md" }) {
  if (value.ok) {
    const percent = value.rate.percent;
    const tone = percent.isNegative ? "text-red-500" : "text-green-500";
    return (
      <span className={`tnum font-semibold ${tone} ${size === "sm" ? "text-sm" : "text-xl"}`}>
        {formatPercent(percent)}
        <span className="sr-only"> per annum, money-weighted</span>
      </span>
    );
  }
  return (
    <span className={`text-gray-400 ${size === "sm" ? "text-xs" : "text-xs"}`}>
      <span className="sr-only">No return could be computed. </span>
      {value.because}
    </span>
  );
}

/** The provenance the numbers were computed against. Never optional. */
export function AsOfStamp({ asOf, source }: { asOf: string; source: string }) {
  return (
    <span className="text-xs text-gray-500">
      as of {asOf} · {source}
    </span>
  );
}
