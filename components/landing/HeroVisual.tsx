"use client";

import dynamic from "next/dynamic";
import { Component, type ReactNode } from "react";

const Hero3D = dynamic(() => import("@/components/landing/Hero3D"), {
  ssr: false,
  loading: () => <GlowFallback pulse />,
});

/** Soft brand glow shown while the 3D scene loads or if WebGL is unavailable. */
function GlowFallback({ pulse = false }: { pulse?: boolean }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div
        className={`h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(124,108,255,0.45),transparent_70%)] blur-2xl ${
          pulse ? "animate-pulse" : ""
        }`}
      />
    </div>
  );
}

/** Never let a WebGL error take down the page — fall back to the glow. */
class GLBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const HeroVisual = () => {
  return (
    <div className="relative aspect-square w-full max-w-[560px]" role="img" aria-label="A portfolio model where tower height represents allocation and liabilities extend below the asset plane">
      <div className="absolute inset-12 rounded-full bg-[radial-gradient(circle,rgba(124,108,255,0.22),transparent_70%)] blur-3xl" />
      <GLBoundary fallback={<GlowFallback />}>
        <Hero3D />
      </GLBoundary>
      <div className="pointer-events-none absolute left-[44%] top-[56%] grid h-10 w-10 place-items-center rounded-full border border-purple-400/40 bg-gray-950/85 text-lg font-bold text-purple-300 shadow-[0_0_24px_rgba(124,108,255,.35)]">₹</div>
      <div className="pointer-events-none absolute inset-x-2 bottom-5 rounded-2xl border border-gray-600 bg-gray-950/80 p-3 backdrop-blur-md">
        <div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.16em] text-gray-500">Sample capital model</span><span className="text-xs font-semibold text-green-500">Assets − debt = net worth</span></div>
        <div className="mt-2 grid grid-cols-5 gap-1 text-center text-[9px] font-semibold text-gray-400">
          <span className="rounded bg-purple-500/10 py-1 text-purple-400">Equity 38%</span><span className="rounded bg-blue-500/10 py-1 text-blue-400">Cash 22%</span><span className="rounded bg-yellow-500/10 py-1 text-yellow-400">Property 26%</span><span className="rounded bg-teal-500/10 py-1 text-teal-400">ESOP 14%</span><span className="rounded bg-red-500/10 py-1 text-red-400">Debt ↓</span>
        </div>
      </div>
    </div>
  );
};

export default HeroVisual;
