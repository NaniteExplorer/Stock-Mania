"use client";

import { useState } from "react";
import type { SnapshotTimelinePoint } from "@/features/tracking/tracking.types";
import { formatINRCompact } from "@/lib/utils";

/**
 * Single-series net-worth-over-time line. One measure → one hue (the app's
 * --chart-3 token), no legend (the heading names it), a direct label on the
 * latest point, recessive grid, and a crosshair tooltip on hover.
 */
export default function NetWorthTimeline({ points }: { points: SnapshotTimelinePoint[] }) {
  const [active, setActive] = useState<number | null>(null);
  const [monthlyContribution, setMonthlyContribution] = useState(0);
  const [annualReturn, setAnnualReturn] = useState(8);

  if (points.length < 1) {
    return (
      <div className="flex h-full min-h-44 flex-col items-center justify-center text-center">
        <p className="text-sm font-semibold text-gray-200">
          Your timeline starts with the next snapshot
        </p>
        <p className="mt-1 max-w-md text-xs leading-5 text-gray-500">
          Capture a snapshot (or import your history) to plot net worth and scenarios.
        </p>
      </div>
    );
  }

  const W = 640;
  const H = 220;
  const padX = 12;
  const padTop = 16;
  const padBottom = 28;
  const forecastMonths = 24;
  const monthlyRate = Math.pow(1 + Math.max(-0.99, annualReturn / 100), 1 / 12) - 1;
  const forecast = Array.from({ length: forecastMonths + 1 }, (_, index) => {
    let value = points[points.length - 1].netWorth;
    for (let month = 0; month < index; month++) value = value * (1 + monthlyRate) + monthlyContribution;
    return value;
  });
  const values = [...points.map((p) => p.netWorth), ...forecast];
  const min = Math.min(...values, 0);
  const max = Math.max(...values);
  const span = max - min || 1;

  const historicalSpan = points.length - 1;
  const totalSpan = Math.max(1, historicalSpan + forecastMonths);
  const x = (i: number) => padX + (i / totalSpan) * (W - padX * 2);
  const y = (v: number) => padTop + (1 - (v - min) / span) * (H - padTop - padBottom);

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${(H - padBottom).toFixed(1)} L${x(0).toFixed(1)},${(H - padBottom).toFixed(1)} Z`;
  const forecastPath = forecast.map((value, i) => `${i === 0 ? "M" : "L"}${x(historicalSpan + i).toFixed(1)},${y(value).toFixed(1)}`).join(" ");

  const gridLines = 4;
  const last = points[points.length - 1];
  const shown = active ?? points.length - 1;
  const shownPoint = points[shown];

  return (
    <figure className="relative m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`Net worth from ${points[0].periodKey} to ${last.periodKey}`}
        preserveAspectRatio="none"
        onMouseLeave={() => setActive(null)}
      >
        {/* Recessive horizontal grid */}
        {Array.from({ length: gridLines + 1 }, (_, g) => {
          const gy = padTop + (g / gridLines) * (H - padTop - padBottom);
          return <line key={g} x1={padX} x2={W - padX} y1={gy} y2={gy} stroke="var(--border)" strokeWidth={1} opacity={0.5} />;
        })}

        <defs>
          <linearGradient id="nw-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0} />
          </linearGradient>
        </defs>

        <path d={areaPath} fill="url(#nw-area)" />
        <path d={linePath} fill="none" stroke="var(--chart-3)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <path d={forecastPath} fill="none" stroke="var(--chart-3)" strokeWidth={2} strokeDasharray="7 6" strokeLinecap="round" opacity={0.8} />

        {/* Crosshair + marker for the active/last point */}
        <line x1={x(shown)} x2={x(shown)} y1={padTop} y2={H - padBottom} stroke="var(--chart-3)" strokeWidth={1} opacity={0.35} />
        <circle cx={x(shown)} cy={y(shownPoint.netWorth)} r={4} fill="var(--chart-3)" stroke="var(--background)" strokeWidth={2} />

        {/* Invisible hit targets — bigger than the marks */}
        {points.map((p, i) => (
          <rect
            key={p.periodKey}
            x={x(i) - (W - padX * 2) / totalSpan / 2}
            y={0}
            width={(W - padX * 2) / totalSpan}
            height={H}
            fill="transparent"
            onMouseEnter={() => setActive(i)}
          />
        ))}
      </svg>

      <figcaption className="mt-1 flex items-center justify-between text-[11px] text-gray-500 tnum">
        <span>{points[0].periodKey}</span>
        <span className="font-semibold text-gray-300">
          {shownPoint.periodKey} · {formatINRCompact(shownPoint.netWorth)}
        </span>
        <span>+24 months · {formatINRCompact(forecast[forecast.length - 1])}</span>
      </figcaption>
      <div className="mt-4 grid gap-3 border-t border-gray-700/70 pt-4 sm:grid-cols-2">
        <label className="text-xs text-gray-500">
          Monthly amount invested
          <input type="number" min="0" step="1000" value={monthlyContribution} onChange={(event) => setMonthlyContribution(Number(event.target.value) || 0)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 tnum" />
        </label>
        <label className="text-xs text-gray-500">
          Expected annual return (%)
          <input type="number" min="-99" max="100" step="0.5" value={annualReturn} onChange={(event) => setAnnualReturn(Number(event.target.value) || 0)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 tnum" />
        </label>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-gray-600">Dotted values are a scenario, not a prediction or verified balance. They assume monthly compounding and the contribution entered above.</p>
    </figure>
  );
}
