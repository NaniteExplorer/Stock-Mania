import { ArrowUpRight, Landmark, LineChart, Building2 } from "lucide-react";

/**
 * Lightweight, dependency-free hero visual — a stylised "net worth" card with a
 * CSS allocation donut and an SVG sparkline. Replaces the old three.js orb to
 * fit the INDmoney-clean aesthetic and keep the bundle small.
 */
const HeroVisual = () => {
  const donut =
    "conic-gradient(var(--chart-1) 0% 46%, var(--chart-3) 46% 70%, var(--chart-2) 70% 86%, var(--chart-4) 86% 100%)";

  return (
    <div className="relative aspect-square w-full max-w-[520px]">
      {/* soft glow halo */}
      <div className="absolute inset-10 rounded-full bg-[radial-gradient(circle,rgba(124,108,255,0.28),transparent_70%)] blur-2xl" />

      {/* main net-worth card */}
      <div className="panel animate-float-slow absolute left-1/2 top-1/2 w-[88%] max-w-[420px] -translate-x-1/2 -translate-y-1/2 p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-gray-500">Total net worth</p>
            <p className="mt-1 text-3xl font-bold tracking-tight text-gray-100 tnum">
              ₹24,82,400
            </p>
          </div>
          <span className="chip chip-pos">
            <ArrowUpRight className="h-3.5 w-3.5" />
            +2.4%
          </span>
        </div>

        {/* sparkline */}
        <svg viewBox="0 0 320 90" className="mt-4 h-20 w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="hv-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0 70 L40 60 L80 64 L120 44 L160 50 L200 30 L240 36 L280 18 L320 10"
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M0 70 L40 60 L80 64 L120 44 L160 50 L200 30 L240 36 L280 18 L320 10 L320 90 L0 90 Z"
            fill="url(#hv-fill)"
          />
        </svg>

        {/* allocation donut + legend */}
        <div className="mt-4 flex items-center gap-4 rounded-xl border border-gray-600 bg-gray-700/40 p-4">
          <div
            className="relative h-16 w-16 shrink-0 rounded-full"
            style={{ background: donut }}
          >
            <div className="absolute inset-[22%] rounded-full bg-gray-800" />
          </div>
          <ul className="flex-1 space-y-1.5 text-xs">
            <li className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-gray-400">
                <span className="h-2 w-2 rounded-full" style={{ background: "var(--chart-1)" }} />
                Investments
              </span>
              <span className="font-semibold text-gray-100 tnum">46%</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-gray-400">
                <span className="h-2 w-2 rounded-full" style={{ background: "var(--chart-3)" }} />
                Cash &amp; Bank
              </span>
              <span className="font-semibold text-gray-100 tnum">24%</span>
            </li>
            <li className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-gray-400">
                <span className="h-2 w-2 rounded-full" style={{ background: "var(--chart-2)" }} />
                ESOPs
              </span>
              <span className="font-semibold text-gray-100 tnum">16%</span>
            </li>
          </ul>
        </div>
      </div>

      {/* floating mini-cards */}
      <div className="panel animate-float-slow absolute -left-2 top-6 hidden items-center gap-2 p-3 sm:flex [animation-delay:-2s]">
        <span className="icon-chip h-9 w-9">
          <Landmark className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[10px] text-gray-500">Accounts</p>
          <p className="text-sm font-bold text-gray-100 tnum">₹5.9L</p>
        </div>
      </div>

      <div className="panel animate-float-slow absolute -right-2 bottom-10 hidden items-center gap-2 p-3 sm:flex [animation-delay:-4s]">
        <span className="icon-chip h-9 w-9">
          <Building2 className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[10px] text-gray-500">ESOPs vested</p>
          <p className="text-sm font-bold text-gray-100 tnum">₹3.9L</p>
        </div>
      </div>

      <div className="panel animate-float-slow absolute -bottom-2 left-10 hidden items-center gap-2 p-3 md:flex [animation-delay:-1s]">
        <span className="icon-chip h-9 w-9">
          <LineChart className="h-4 w-4" />
        </span>
        <div>
          <p className="text-[10px] text-gray-500">Today</p>
          <p className="text-sm font-bold text-green-500 tnum">+₹42.6K</p>
        </div>
      </div>
    </div>
  );
};

export default HeroVisual;
