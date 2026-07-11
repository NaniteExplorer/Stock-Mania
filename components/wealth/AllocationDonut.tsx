"use client";

import Link from "next/link";
import { formatINRCompact } from "@/lib/utils";

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  percent: number;
  color: string;
}

const AllocationDonut = ({
  slices,
  centerLabel,
  centerValue,
  size = 188,
  links,
}: {
  slices: DonutSlice[];
  centerLabel: string;
  centerValue: string;
  size?: number;
  /** Optional slice-key → route map; legend rows become links when provided. */
  links?: Record<string, string>;
}) => {
  let acc = 0;
  const stops = slices
    .map((s) => {
      const start = acc;
      acc += s.percent;
      return `${s.color} ${start.toFixed(2)}% ${acc.toFixed(2)}%`;
    })
    .join(", ");

  const gradient =
    slices.length > 0
      ? `conic-gradient(${stops})`
      : "conic-gradient(var(--gray-600) 0% 100%)";

  return (
    <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:gap-8">
      <div
        className="relative shrink-0 rounded-full"
        style={{ width: size, height: size, background: gradient }}
        role="img"
        aria-label="Asset allocation"
      >
        <div className="absolute inset-[16%] flex flex-col items-center justify-center rounded-full bg-gray-800 text-center">
          <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
            {centerLabel}
          </span>
          <span className="mt-0.5 text-lg font-bold tracking-tight text-gray-100 tnum">
            {centerValue}
          </span>
        </div>
      </div>

      <ul className="flex w-full flex-col gap-1">
        {slices.map((s) => {
          const href = links?.[s.key];
          const row = (
            <>
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: s.color }}
                />
                <span className="truncate text-sm text-gray-400">{s.label}</span>
              </span>
              <span className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-sm font-semibold text-gray-100 tnum">
                  {formatINRCompact(s.value)}
                </span>
                <span className="w-11 text-right text-xs text-gray-500 tnum">
                  {s.percent.toFixed(1)}%
                </span>
              </span>
            </>
          );
          return (
            <li key={s.key}>
              {href ? (
                <Link
                  href={href}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-gray-700/40"
                >
                  {row}
                </Link>
              ) : (
                <span className="flex items-center justify-between gap-3 px-2 py-1.5">
                  {row}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default AllocationDonut;
