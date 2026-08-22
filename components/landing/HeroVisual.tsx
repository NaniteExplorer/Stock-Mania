import { Money } from "@/core/money";
import { formatMoneyCompact } from "@/ui/format";

/**
 * Static, zero-dependency hero visual: a layered "wealth cockpit" preview —
 * net-worth card, allocation bar, sparkline — floating on a soft glow.
 * Server-rendered, no WebGL, no client JS.
 */

const ALLOCATION = [
  { label: "Equity", pct: 38, cls: "bg-purple-400" },
  { label: "Cash", pct: 22, cls: "bg-blue-400" },
  { label: "Property", pct: 26, cls: "bg-yellow-500" },
  { label: "ESOPs", pct: 14, cls: "bg-teal-400" },
];

// Illustrative growth curve (viewBox 0 0 100 40, y inverted).
const SPARK = "0,34 9,32 18,33 27,28 36,26 45,27 54,22 63,20 72,16 81,14 90,9 100,6";

const HeroVisual = () => (
  <div
    className="relative w-full max-w-[560px] select-none"
    role="img"
    aria-label="Preview of the wealth dashboard: net worth, growth trend and asset allocation"
  >
    {/* Ambient glow */}
    <div className="absolute inset-8 rounded-full bg-[radial-gradient(circle,rgba(124,108,255,0.28),transparent_70%)] blur-3xl" />

    {/* Main card */}
    <div className="relative rounded-3xl border border-gray-600 bg-gray-950/80 p-6 shadow-[0_40px_120px_-40px_rgba(0,0,0,.9)] backdrop-blur-xl sm:p-8">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[.18em] text-gray-500">
          Net worth
        </span>
        <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-[10px] font-semibold text-green-500">
          +14.2% this year
        </span>
      </div>
      <p className="mt-2 font-mono text-4xl font-bold tracking-tight text-gray-100 sm:text-5xl">
        {formatMoneyCompact(Money.fromRupees(24_800_000))}
      </p>

      {/* Sparkline */}
      <svg viewBox="0 0 100 40" className="mt-6 h-24 w-full" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="hero-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(124,108,255,.35)" />
            <stop offset="100%" stopColor="rgba(124,108,255,0)" />
          </linearGradient>
        </defs>
        <polygon points={`0,40 ${SPARK} 100,40`} fill="url(#hero-fill)" />
        <polyline
          points={SPARK}
          fill="none"
          stroke="#7c6cff"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Allocation bar */}
      <div className="mt-6">
        <div className="flex h-2 w-full overflow-hidden rounded-full">
          {ALLOCATION.map((a) => (
            <span key={a.label} className={`${a.cls} h-full`} style={{ width: `${a.pct}%` }} />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] font-medium text-gray-400">
          {ALLOCATION.map((a) => (
            <span key={a.label} className="inline-flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${a.cls}`} />
              {a.label} {a.pct}%
            </span>
          ))}
        </div>
      </div>
    </div>

    {/* Floating accent cards */}
    <div className="absolute -left-3 -top-5 hidden rounded-2xl border border-gray-600 bg-gray-950/90 px-4 py-3 shadow-[0_20px_60px_-24px_rgba(0,0,0,.8)] backdrop-blur-md sm:block">
      <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-gray-500">XIRR</p>
      <p className="mt-0.5 font-mono text-lg font-bold text-green-500">18.4%</p>
    </div>
    <div className="absolute -bottom-5 -right-3 hidden rounded-2xl border border-gray-600 bg-gray-950/90 px-4 py-3 shadow-[0_20px_60px_-24px_rgba(0,0,0,.8)] backdrop-blur-md sm:block">
      <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-gray-500">
        This month
      </p>
      <p className="mt-0.5 font-mono text-lg font-bold text-gray-100">
        +{formatMoneyCompact(Money.fromRupees(342_000))}
      </p>
    </div>
  </div>
);

export default HeroVisual;
