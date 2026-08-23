import { cn } from "@/lib/utils";

/**
 * A utilisation gauge.
 *
 * Hand-authored SVG rather than a chart library: it is one arc, and the chart kit
 * exists for series data. The **number arrives as a string** and the arc geometry
 * as a separate already-computed number, because `Percentage` cannot cross into a
 * client component and formatting is `ui/format`'s job — this component only
 * positions.
 *
 * The colour band is a judgement worth stating: under 30% reads as healthy, 30–70%
 * as neutral, above 70% as a warning. Issuers score utilisation above 30%
 * unfavourably, so the first threshold is the one that matters to the user rather
 * than a round number.
 */
export default function UtilisationGauge({
  percentText,
  percentValue,
}: {
  percentText: string;
  percentValue: number;
}) {
  const clamped = Math.max(0, Math.min(100, percentValue));
  const circumference = 2 * Math.PI * 42;
  const filled = (clamped / 100) * circumference;

  const tone =
    percentValue > 70 ? "text-red-500" : percentValue > 30 ? "text-amber-500" : "text-green-500";

  return (
    <div className="flex items-center gap-3">
      <svg viewBox="0 0 100 100" className="h-20 w-20 -rotate-90" role="img" aria-label={`Utilisation ${percentText}%`}>
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          strokeWidth="8"
          className="stroke-gray-600"
        />
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className={cn("stroke-current", tone)}
        />
      </svg>
      <div>
        <p className="metric-label">Utilisation</p>
        <p className={cn("tnum text-xl font-semibold", tone)}>{percentText}%</p>
        {percentValue > 100 && <p className="text-xs text-red-500">Over the limit</p>}
      </div>
    </div>
  );
}
