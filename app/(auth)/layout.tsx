import Link from "next/link";
import { BrandMark } from "@/components/Logo";
import { getCurrentSession } from "@/lib/better-auth/auth";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, Landmark, LineChart, ShieldCheck, Sparkles, Star } from "lucide-react";
import HeroVisual from "@/components/landing/HeroVisual";

const highlights = [
  { icon: LineChart, label: "Net worth", desc: "Every asset in one view" },
  { icon: Landmark, label: "Accounts", desc: "Bank, cash & deposits" },
  { icon: Star, label: "Watchlists", desc: "Track what matters" },
  { icon: Sparkles, label: "AI signals", desc: "Context, not advice" },
];

const Layout = async ({ children }: { children: React.ReactNode }) => {
  await connection();

  const session = await getCurrentSession();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="aurora-bg grid min-h-screen lg:grid-cols-[1fr_1fr]">
      {/* Left — form */}
      <section className="relative z-10 flex flex-col px-6 py-8 sm:px-10 lg:px-16 lg:py-12">
        <div className="flex items-center justify-between">
          <Link href="/">
            <BrandMark logoClassName="h-10 w-10" wordmarkClassName="text-xl" />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 transition-colors hover:text-gray-100"
          >
            <ArrowLeft className="h-4 w-4" />
            Home
          </Link>
        </div>

        <div className="flex flex-1 items-center py-10">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </section>

      {/* Right — elegant 3D showcase */}
      <section className="relative hidden overflow-hidden border-l border-gray-600 bg-gray-800/50 lg:flex lg:flex-col lg:justify-center lg:px-14">
        <div className="grid-overlay pointer-events-none absolute inset-0" />

        <div className="relative z-10 mx-auto flex w-full max-w-lg flex-col items-center text-center">
          <HeroVisual />

          <span className="eyebrow mt-2">
            <ShieldCheck className="h-3.5 w-3.5" />
            Broker-ready architecture
          </span>
          <h2 className="mt-5 text-3xl font-bold tracking-tight text-gray-100 xl:text-4xl">
            Your whole <span className="gradient-text">net worth</span>, in one place
          </h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-gray-400">
            Bank accounts, stocks, ETFs, ESOPs and assets — tracked beautifully
            alongside live markets and AI signals.
          </p>

          <div className="mt-9 grid w-full grid-cols-2 gap-3">
            {highlights.map(({ icon: Icon, label, desc }) => (
              <div
                key={label}
                className="enterprise-card p-4 text-left"
              >
                <Icon className="h-5 w-5 text-yellow-400" />
                <p className="mt-3 text-sm font-semibold text-gray-100">{label}</p>
                <p className="mt-0.5 text-xs text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
};

export default Layout;
