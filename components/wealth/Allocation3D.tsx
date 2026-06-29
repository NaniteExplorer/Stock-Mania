"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import AllocationDonut, { type DonutSlice } from "./AllocationDonut";
import { formatINRCompact } from "@/lib/utils";

const Scene = dynamic(() => import("./AllocationScene3D"), {
  ssr: false,
  loading: () => <div className="h-[240px] w-full animate-pulse rounded-2xl bg-gray-700/30" />,
});

// Fixed brand hexes (three.js materials can't read CSS vars). Readable on both themes.
const HEX: Record<string, string> = {
  accounts: "#6ea8ff",
  investments: "#7c6cff",
  brokerage: "#34d399",
  esops: "#a78bff",
  assets: "#f0b34d",
};
const HREF: Record<string, string> = {
  accounts: "/accounts",
  investments: "/investments",
  brokerage: "/portfolio",
  esops: "/esops",
  assets: "/assets",
};
const colorOf = (key: string) => HEX[key] ?? "#7c6cff";

/** If WebGL throws, silently fall back to the flat CSS donut. */
class GLBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function Allocation3D({
  slices,
  centerLabel,
  centerValue,
}: {
  slices: DonutSlice[];
  centerLabel: string;
  centerValue: string;
}) {
  const router = useRouter();

  return (
    <GLBoundary
      fallback={
        <AllocationDonut slices={slices} centerLabel={centerLabel} centerValue={centerValue} />
      }
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="w-full sm:w-[55%]">
          <Scene
            slices={slices}
            colorOf={colorOf}
            centerLabel={centerLabel}
            centerValue={centerValue}
            onSelect={(key) => {
              const href = HREF[key];
              if (href) router.push(href);
            }}
          />
        </div>
        <ul className="flex w-full flex-col gap-2.5 sm:w-[45%]">
          {slices.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(s.key) }} />
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
            </li>
          ))}
        </ul>
      </div>
    </GLBoundary>
  );
}
