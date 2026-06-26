import Link from "next/link";
import HeroVisual from "@/components/landing/HeroVisual";
import TradingViewWidget from "@/components/TradingViewWidgets";
import { getCurrentSession } from "@/lib/better-auth/auth";
import {
  TICKER_TAPE_WIDGET_CONFIG,
  MARKET_OVERVIEW_WIDGET_CONFIG,
  HEATMAP_WIDGET_CONFIG,
  INDIA_HEATMAP_WIDGET_CONFIG,
  MARKET_DATA_WIDGET_CONFIG,
  TOP_STORIES_WIDGET_CONFIG,
} from "@/lib/constants";
import {
  ArrowRight,
  BarChart3,
  Building2,
  Gem,
  Landmark,
  LineChart,
  Lock,
  Newspaper,
  Sparkles,
  WalletCards,
  Zap,
} from "lucide-react";

const TV = "https://s3.tradingview.com/external-embedding/embed-widget-";

const stats = [
  { value: "NASDAQ + NSE/BSE", label: "Markets covered" },
  { value: "Real-time", label: "Quotes & charts" },
  { value: "AI", label: "Signal engine" },
];

const wealthFeatures = [
  {
    icon: LineChart,
    title: "Complete net worth",
    body: "Accounts, investments, ESOPs and assets roll up into one live number — beautifully visualised.",
  },
  {
    icon: Landmark,
    title: "All your accounts",
    body: "Track bank balances, cash, wallets and deposits side by side in one place.",
  },
  {
    icon: Building2,
    title: "ESOPs & equity",
    body: "Model your grants and instantly see the in-the-money value of your vested startup equity.",
  },
  {
    icon: Zap,
    title: "AI market signals",
    body: "Plain-language summaries and signal candidates for your watchlist — never advice, always context.",
  },
];

const assetClasses = [
  { label: "Accounts", icon: Landmark },
  { label: "Investments", icon: LineChart },
  { label: "ESOPs", icon: Building2 },
  { label: "Assets", icon: Gem },
  { label: "Brokerage", icon: WalletCards },
  { label: "Markets", icon: BarChart3 },
];

const Landing = async () => {
  const session = await getCurrentSession();
  const isAuthed = Boolean(session?.user);
  const primaryHref = isAuthed ? "/dashboard" : "/sign-up";
  const primaryLabel = isAuthed ? "Open dashboard" : "Start for free";

  return (
    <>
      {/* ───────────── Live ticker ───────────── */}
      <div className="border-b border-gray-600 bg-gray-800/60 pt-[92px] backdrop-blur">
        <div className="tv-site-widget--bg_none">
          <TradingViewWidget
            scriptUrl={`${TV}ticker-tape.js`}
            config={TICKER_TAPE_WIDGET_CONFIG}
            height={52}
          />
        </div>
      </div>

      {/* ───────────── Hero ───────────── */}
      <section className="grid-overlay relative overflow-hidden">
        <div className="container relative grid items-center gap-12 pb-14 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:pb-20 lg:pt-20">
          <div className="animate-fade-up">
            <span className="eyebrow">
              <Sparkles className="h-3.5 w-3.5" />
              Markets + complete wealth
            </span>
            <h1 className="mt-6 max-w-2xl text-4xl font-bold leading-[1.08] tracking-tight text-gray-100 sm:text-5xl md:text-6xl">
              Track the markets.{" "}
              <span className="gradient-text">Grow your net worth.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-gray-400 md:text-lg">
              Live NASDAQ and Indian markets, heatmaps, charts and news — free and
              open. Sign in to bring your accounts, stocks, ETFs, ESOPs and assets
              into one elegant net-worth workspace.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href={primaryHref} className="gold-glow-btn">
                {primaryLabel}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#markets" className="ghost-btn">
                Explore live markets
              </a>
            </div>

            <dl className="mt-12 grid max-w-lg grid-cols-3 gap-6">
              {stats.map((s) => (
                <div key={s.label}>
                  <dt className="text-lg font-bold text-gray-100 md:text-xl">{s.value}</dt>
                  <dd className="mt-1 text-xs text-gray-500">{s.label}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="flex justify-center lg:justify-end">
            <HeroVisual />
          </div>
        </div>
      </section>

      {/* ───────────── Live markets ───────────── */}
      <section id="markets" className="container scroll-mt-24 py-16 md:py-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">Live markets</span>
          <h2 className="section-title mt-5">Global &amp; Indian markets, in real time</h2>
          <p className="mt-4 text-gray-400">
            Powered by TradingView — no login required to watch the tape.
          </p>
        </div>

        <div className="mt-12 grid gap-5">
          {/* Market overview (tabs incl. India) */}
          <div className="panel p-4">
            <TradingViewWidget
              title="Market overview"
              scriptUrl={`${TV}market-overview.js`}
              config={MARKET_OVERVIEW_WIDGET_CONFIG}
              className="custom-chart"
              height={440}
            />
          </div>

          {/* US + India heatmaps */}
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="panel p-4">
              <TradingViewWidget
                title="US heatmap · S&P 500"
                scriptUrl={`${TV}stock-heatmap.js`}
                config={HEATMAP_WIDGET_CONFIG}
                className="custom-chart"
                height={460}
              />
            </div>
            <div className="panel p-4">
              <TradingViewWidget
                title="India heatmap · SENSEX"
                scriptUrl={`${TV}stock-heatmap.js`}
                config={INDIA_HEATMAP_WIDGET_CONFIG}
                className="custom-chart"
                height={460}
              />
            </div>
          </div>

          {/* Quotes + News */}
          <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <div className="panel p-4">
              <TradingViewWidget
                title="Market quotes"
                scriptUrl={`${TV}market-quotes.js`}
                config={MARKET_DATA_WIDGET_CONFIG}
                className="custom-chart"
                height={460}
              />
            </div>
            <div className="panel p-4">
              <div className="mb-3 flex items-center gap-2">
                <Newspaper className="h-4 w-4 text-yellow-500" />
                <h3 className="text-base font-semibold text-gray-100">Top stories</h3>
              </div>
              <TradingViewWidget
                scriptUrl={`${TV}timeline.js`}
                config={TOP_STORIES_WIDGET_CONFIG}
                className="custom-chart"
                height={420}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ───────────── Wealth pitch ───────────── */}
      <section id="features" className="container scroll-mt-24 py-16 md:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <span className="eyebrow">After you sign in</span>
          <h2 className="section-title mt-5">A complete wealth workspace</h2>
          <p className="mt-4 text-gray-400">
            Everything above, plus your entire financial life — organised and always current.
          </p>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {wealthFeatures.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="glass-card group p-6 transition-transform duration-300 hover:-translate-y-1"
            >
              <span className="icon-chip h-12 w-12 transition-colors group-hover:border-yellow-500/40">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-5 text-lg font-semibold text-gray-100">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───────────── Asset classes ───────────── */}
      <section id="assets" className="container scroll-mt-24 pb-8">
        <div className="glass-card overflow-hidden">
          <div className="grid gap-10 p-8 md:p-12 lg:grid-cols-[1fr_1fr] lg:items-center">
            <div>
              <span className="eyebrow">Complete wealth</span>
              <h2 className="section-title mt-5">Every asset class, one net worth.</h2>
              <p className="mt-4 max-w-lg text-gray-400">
                Bank accounts, manual investments, ESOPs, real assets and your live
                brokerage portfolio — unified into a single, always-current view of
                everything you own.
              </p>
              <Link
                href={primaryHref}
                className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-yellow-500 hover:brightness-110"
              >
                {isAuthed ? "Go to dashboard" : "Start tracking free"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {assetClasses.map(({ label, icon: Icon }) => (
                <div key={label} className="rounded-2xl border border-gray-600 bg-gray-700/50 p-4">
                  <span className="icon-chip h-9 w-9">
                    <Icon className="h-4 w-4" />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-gray-100">{label}</p>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-green-500">
                    Live
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ───────────── Intelligence + Security ───────────── */}
      <section className="container grid scroll-mt-24 gap-5 py-8 md:grid-cols-2">
        <div id="intelligence" className="glass-card scroll-mt-24 p-8">
          <span className="icon-chip h-12 w-12 text-green-500">
            <LineChart className="h-6 w-6" />
          </span>
          <h3 className="mt-5 text-xl font-semibold text-gray-100">
            Intelligence that respects your judgement
          </h3>
          <p className="mt-3 text-sm leading-6 text-gray-400">
            AI summaries, signal candidates and risk flags give you context at a
            glance. Every surface is informational — you stay in control of the decision.
          </p>
        </div>
        <div id="security" className="glass-card scroll-mt-24 p-8">
          <span className="icon-chip h-12 w-12 text-blue-500">
            <Lock className="h-6 w-6" />
          </span>
          <h3 className="mt-5 text-xl font-semibold text-gray-100">
            Private and secure by design
          </h3>
          <p className="mt-3 text-sm leading-6 text-gray-400">
            Secure authentication and a privacy-first posture mean your financial
            picture stays yours.
          </p>
        </div>
      </section>

      {/* ───────────── CTA ───────────── */}
      <section className="container py-16 md:py-24">
        <div className="glass-card relative overflow-hidden p-10 text-center md:p-16">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(40rem_20rem_at_50%_-20%,rgba(124,108,255,0.20),transparent_60%)]" />
          <div className="relative">
            <span className="icon-chip mx-auto h-12 w-12">
              <WalletCards className="h-6 w-6" />
            </span>
            <h2 className="section-title mx-auto mt-6 max-w-2xl">
              See your whole net worth today
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-gray-400">
              Join stockMania and bring your accounts, investments, ESOPs, assets
              and markets into one elegant workspace.
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
