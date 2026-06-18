import Link from "next/link";
import HeroVisual from "@/components/landing/HeroVisual";
import { getCurrentSession } from "@/lib/better-auth/auth";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  CircleDollarSign,
  Landmark,
  LineChart,
  Lock,
  PieChart,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  WalletCards,
  Zap,
} from "lucide-react";

const stats = [
  { value: "12K+", label: "Symbols tracked" },
  { value: "Real-time", label: "Market data" },
  { value: "AI", label: "Signal engine" },
];

const ticker = [
  "NIFTY 50  +0.84%",
  "SENSEX  +0.71%",
  "NASDAQ  +1.12%",
  "RELIANCE  +1.9%",
  "TCS  +0.6%",
  "NVDA  +2.4%",
  "BANK NIFTY  +0.5%",
  "AAPL  +0.9%",
  "INFY  +1.3%",
];

const features = [
  {
    icon: Activity,
    title: "Live market intelligence",
    body: "Real-time quotes, advanced charts, heatmaps and curated stories — all in one calm, fast workspace.",
  },
  {
    icon: Star,
    title: "Smart watchlists",
    body: "Curate the symbols that matter and surface their moves the moment they happen.",
  },
  {
    icon: Bell,
    title: "Price & event alerts",
    body: "Set thresholds once and let stockMania watch the tape so you don't have to.",
  },
  {
    icon: Zap,
    title: "AI signal queue",
    body: "Plain-language summaries and signal candidates ready for your review — never advice, always context.",
  },
  {
    icon: BarChart3,
    title: "Portfolio cockpit",
    body: "Track net worth, day P&L and invested capital across a single, broker-ready surface.",
  },
  {
    icon: ShieldCheck,
    title: "Built to scale",
    body: "An architecture ready for brokers, mutual funds, EPF, PPF and complete wealth tracking.",
  },
];

const assets = [
  { label: "Stocks", icon: BarChart3, status: "Live", tone: "text-green-400" },
  { label: "Mutual Funds", icon: PieChart, status: "Soon", tone: "text-yellow-400" },
  { label: "EPF", icon: Building2, status: "Soon", tone: "text-blue-400" },
  { label: "PPF", icon: Landmark, status: "Soon", tone: "text-purple-400" },
  { label: "Cash", icon: CircleDollarSign, status: "Soon", tone: "text-teal-400" },
];

const Landing = async () => {
  const session = await getCurrentSession();
  const isAuthed = Boolean(session?.user);
  const primaryHref = isAuthed ? "/dashboard" : "/sign-up";
  const primaryLabel = isAuthed ? "Open dashboard" : "Start for free";

  return (
    <>
      {/* ───────────── Hero ───────────── */}
      <section className="grid-overlay relative overflow-hidden">
        <div className="container relative grid items-center gap-12 pb-16 pt-36 lg:grid-cols-[1.05fr_0.95fr] lg:pb-28 lg:pt-44">
          <div className="animate-fade-up">
            <span className="eyebrow">
              <Sparkles className="h-3.5 w-3.5" />
              Wealth operating system
            </span>
            <h1 className="mt-6 max-w-2xl text-4xl font-bold leading-[1.08] tracking-tight text-gray-100 sm:text-5xl md:text-6xl">
              Track markets.{" "}
              <span className="gradient-text">Spot signals.</span>{" "}
              Trade with conviction.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-gray-400 md:text-lg">
              stockMania brings real-time markets, intelligent watchlists, AI
              summaries and a broker-ready portfolio cockpit into one elegant,
              lightning-fast workspace.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href={primaryHref} className="gold-glow-btn">
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#features" className="ghost-btn">
                Explore the platform
              </a>
            </div>

            <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="text-2xl font-bold text-gray-100 md:text-3xl">
                    {s.value}
                  </dt>
                  <dd className="mt-1 text-xs text-gray-500">{s.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="flex justify-center lg:justify-end">
            <HeroVisual />
          </div>
        </div>

        {/* Ticker marquee */}
        <div className="relative border-y border-gray-600 bg-gray-800/60 py-3 backdrop-blur">
          <div className="flex w-max animate-marquee gap-10 whitespace-nowrap px-5 text-sm font-medium text-gray-400">
            {[...ticker, ...ticker].map((t, i) => (
              <span key={i} className="inline-flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-green-400" />
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ───────────── Features ───────────── */}
      <section id="features" className="container scroll-mt-24 py-20 md:py-28">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Platform</span>
          <h2 className="section-title mt-5">
            Everything you need to read the market
          </h2>
          <p className="mt-4 text-gray-400">
            A focused toolkit designed for clarity — not clutter.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="glass-card group p-6 transition-transform duration-300 hover:-translate-y-1"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-yellow-500/25 bg-yellow-500/10 text-yellow-400 transition-colors group-hover:bg-yellow-500/20">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-gray-100">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────── Assets / complete wealth ───────────── */}
      <section id="assets" className="container scroll-mt-24 py-20 md:py-28">
        <div className="glass-card overflow-hidden">
          <div className="grid gap-10 p-8 md:p-12 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div>
              <span className="eyebrow">Complete wealth</span>
              <h2 className="section-title mt-5">
                Stocks today. Your entire net worth tomorrow.
              </h2>
              <p className="mt-4 max-w-lg text-gray-400">
                Start with live equities and scale into a unified view across
                mutual funds, EPF, PPF, ETFs and cash — without ever leaving
                your workspace.
              </p>
              <Link
                href={primaryHref}
                className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-yellow-400 hover:text-yellow-300"
              >
                {isAuthed ? "Go to dashboard" : "Create your cockpit"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
              {assets.map(({ label, icon: Icon, status, tone }) => (
                <div
                  key={label}
                  className="rounded-2xl border border-gray-600 bg-gray-700/60 p-4"
                >
                  <div className="flex items-center justify-between">
                    <Icon className={`h-8 w-8 rounded-lg border border-gray-600 bg-gray-800 p-1.5 ${tone}`} />
                    <span className="rounded-full bg-gray-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                      {status}
                    </span>
                  </div>
                  <p className="mt-4 text-sm font-semibold text-gray-100">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ───────────── Intelligence + Security split ───────────── */}
      <section className="container grid scroll-mt-24 gap-5 py-8 md:grid-cols-2">
        <div id="intelligence" className="glass-card scroll-mt-24 p-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-green-500/25 bg-green-500/10 text-green-400">
            <LineChart className="h-6 w-6" />
          </span>
          <h3 className="mt-5 text-xl font-semibold text-gray-100">
            Intelligence that respects your judgement
          </h3>
          <p className="mt-3 text-sm leading-6 text-gray-400">
            AI summaries, signal candidates and risk flags give you context at a
            glance. Every surface is informational — you stay in control of the
            decision.
          </p>
        </div>
        <div id="security" className="glass-card scroll-mt-24 p-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-blue-500/25 bg-blue-500/10 text-blue-400">
            <Lock className="h-6 w-6" />
          </span>
          <h3 className="mt-5 text-xl font-semibold text-gray-100">
            Private and secure by design
          </h3>
          <p className="mt-3 text-sm leading-6 text-gray-400">
            Secure authentication, a broker-ready architecture and a privacy-first
            posture mean your workspace stays yours.
          </p>
        </div>
      </section>

      {/* ───────────── CTA band ───────────── */}
      <section className="container py-20 md:py-28">
        <div className="glass-card relative overflow-hidden p-10 text-center md:p-16">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_20rem_at_50%_-20%,rgba(245,158,11,0.18),transparent_60%)]" />
          <div className="relative">
            <WalletCards className="mx-auto h-10 w-10 text-yellow-400" />
            <h2 className="section-title mx-auto mt-6 max-w-2xl">
              Build your unified portfolio cockpit
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-gray-400">
              Join stockMania and bring markets, watchlists, signals and wealth
              tracking into one elegant workspace.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href={primaryHref} className="gold-glow-btn">
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              {!isAuthed && (
                <Link href="/sign-in" className="ghost-btn">
                  I already have an account
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default Landing;
