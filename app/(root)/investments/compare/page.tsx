import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft } from "lucide-react";
import { CalendarDate, DateRange } from "@/core/time";
import type { Bar } from "@/domain/analysis";
import { Card, PageHeader, Pill } from "@/ui/primitives";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import ComparisonChart, { type ComparisonPoint, type ComparisonSeries } from "./comparison-chart";

export const metadata: Metadata = { title: "Compare holdings" };

/**
 * Two or more holdings against each other and against the market.
 *
 * The whole view is a GET form: the selection lives in the URL, so a comparison
 * is a link the owner can keep, and the page stays a server component with no
 * client state to lose. Submitting is a navigation, which also means it works
 * before JavaScript loads.
 *
 * **Rebasing is done here, on integers.** Each series is divided by its own close
 * on the common start date and multiplied by 10 000, so the number that crosses
 * to the client is an index in hundredths of a point and never a float (C8). The
 * common start date is the **latest** of every series' first stored bar: starting
 * one line earlier than another and calling them comparable is the mistake this
 * chart exists to avoid.
 */

/** The index each side of the market is usually measured by, and when it starts. */
const BENCHMARKS = [
  { id: "^NSEI", label: "NIFTY 50", from: "2007-09-17" },
  { id: "^BSESN", label: "S&P BSE SENSEX", from: "1997-07-01" },
] as const;

/** More marks than this and the lines draw over each other rather than inform. */
const MAX_DRAWN_POINTS = 420;

type CompareSearchParams = {
  ids?: string | string[];
  benchmark?: string | string[];
};

const asList = (value: string | string[] | undefined): readonly string[] =>
  value === undefined ? [] : (Array.isArray(value) ? value : value.split(",")).map((one) => one.trim()).filter(Boolean);

const first = (value: string | string[] | undefined): string | null =>
  value === undefined ? null : (Array.isArray(value) ? value[0] : value) || null;

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<CompareSearchParams>;
}) {
  await connection();

  const params = await searchParams;
  const selectedIds = asList(params.ids);
  const benchmarkId = first(params.benchmark);
  const benchmark = BENCHMARKS.find((one) => one.id === benchmarkId) ?? null;

  const userId = await currentUserId();
  await ensureSeeded(userId);
  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const { repositories } = services();

  const holdings = await repositories.instruments.list(userId, { includeClosed: false });
  const chosen = holdings.filter((instrument) => selectedIds.includes(instrument.id.value));

  /*
   * One window wide enough for anything stored. `coverage` gives the outer
   * bounds per series, and the intersection of those bounds is what can honestly
   * be compared; `findRange` is asked for the full span and the rebase narrows it.
   */
  const window = DateRange.of(CalendarDate.parse(BENCHMARKS[1].from), today);

  const loaded = await Promise.all([
    ...chosen.map(async (instrument) => ({
      id: instrument.id.value,
      label: `${instrument.symbol} — ${instrument.name}`,
      benchmark: false,
      bars: await repositories.bars.findRange(instrument.id.value, "DAY", window),
    })),
    ...(benchmark
      ? [
          {
            id: benchmark.id,
            label: benchmark.label,
            benchmark: true,
            bars: await repositories.bars.findRange(benchmark.id, "DAY", window),
          },
        ]
      : []),
  ]);

  const withBars = loaded.filter((one) => one.bars.length > 0);
  const withoutBars = loaded.filter((one) => one.bars.length === 0);

  /* The common start: the latest first-bar across every series that has one. */
  const baseDate = withBars.length > 0
    ? withBars
        .map((one) => one.bars[0].asOf.toISO())
        .reduce((latest, candidate) => (candidate > latest ? candidate : latest))
    : null;

  const rebased = withBars.map((one) => {
    const closes = new Map<string, bigint>();
    let base: bigint | null = null;
    for (const bar of one.bars as readonly Bar[]) {
      const on = bar.asOf.toISO();
      if (baseDate && on < baseDate) continue;
      if (base === null) base = bar.close.scaled;
      closes.set(on, bar.close.scaled);
    }
    return { ...one, closes, base, firstPoint: one.bars[0].asOf.toISO() };
  });

  /* The union of every date any series has a bar for, inside the window. */
  const axis = Array.from(
    new Set(rebased.flatMap((one) => Array.from(one.closes.keys()))),
  ).sort();
  const stride = Math.max(1, Math.ceil(axis.length / MAX_DRAWN_POINTS));
  const drawnAxis = axis.filter((_, index) => index % stride === 0 || index === axis.length - 1);

  const data: ComparisonPoint[] = drawnAxis.map((on) => {
    const point: ComparisonPoint = { x: on };
    for (const one of rebased) {
      const close = one.closes.get(on);
      if (close === undefined || one.base === null || one.base === 0n) continue;
      /*
       * `close / base * 10 000`, as one integer division on scaled values. The
       * multiply happens first so the only rounding is the final truncation, and
       * the 1e8 scales cancel.
       */
      point[one.id] = Number((close * 10_000n) / one.base);
    }
    return point;
  });

  const series: ComparisonSeries[] = rebased.map((one) => ({
    id: one.id,
    label: one.label,
    benchmark: one.benchmark,
    firstPoint: one.firstPoint,
    points: one.closes.size,
  }));

  const partial = [
    ...rebased
      .filter((one) => baseDate !== null && one.firstPoint > baseDate)
      .map((one) => `${one.label} has no bar before ${one.firstPoint}.`),
    ...withoutBars.map(
      (one) => `${one.label} has no stored daily bars at all and is not drawn.`,
    ),
  ];

  return (
    <>
      <PageHeader
        title="Compare holdings"
        subtitle="Two or more holdings and a market index on one axis, each rebased to 100 at their first shared day."
        badge={<Pill tone="brand">Indexed</Pill>}
        action={
          <Link href="/investments" className="ghost-btn h-10 px-4 text-xs">
            <ArrowLeft className="size-4" aria-hidden />
            Investments
          </Link>
        }
      />

      <Card
        title="Choose what to compare"
        subtitle="The selection lives in the address, so a comparison you like is a link you can keep."
        className="mb-6"
      >
        <form method="get" className="space-y-4">
          <fieldset>
            <legend className="metric-label mb-2">Holdings</legend>
            {holdings.length === 0 ? (
              <p className="rounded-lg border border-gray-600/70 p-3 text-sm text-gray-500">
                No open holdings yet. Add one first and its history will be available here.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {holdings.map((instrument) => (
                  <label
                    key={instrument.id.value}
                    className="flex items-start gap-2 rounded-lg border border-gray-600/70 p-3 text-sm text-gray-300"
                  >
                    <input
                      type="checkbox"
                      name="ids"
                      value={instrument.id.value}
                      defaultChecked={selectedIds.includes(instrument.id.value)}
                      className="mt-0.5 size-4 shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block font-medium text-gray-100">{instrument.symbol}</span>
                      <span className="block text-xs text-gray-500">
                        {instrument.name} · {instrument.currency.code}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend className="metric-label mb-2">Benchmark</legend>
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-2 rounded-lg border border-gray-600/70 px-3 py-2 text-sm text-gray-300">
                <input type="radio" name="benchmark" value="" defaultChecked={benchmark === null} className="size-4" />
                None
              </label>
              {BENCHMARKS.map((option) => (
                <label
                  key={option.id}
                  className="flex items-center gap-2 rounded-lg border border-gray-600/70 px-3 py-2 text-sm text-gray-300"
                >
                  <input
                    type="radio"
                    name="benchmark"
                    value={option.id}
                    defaultChecked={benchmark?.id === option.id}
                    className="size-4"
                  />
                  {option.label}
                  <span className="text-xs text-gray-500">from {option.from}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <button type="submit" className="btn-glow h-10 px-4 text-xs">
            Compare
          </button>
        </form>
      </Card>

      {chosen.length < 2 && (
        <p className="panel mb-6 p-5 text-sm text-gray-500" role="status">
          Pick at least two holdings — one line and an index is a holding page, not a comparison. A benchmark is
          optional and is drawn dashed when chosen.
        </p>
      )}

      <section className="panel p-5" aria-labelledby="comparison-heading">
        <h2 id="comparison-heading" className="sr-only">Indexed comparison</h2>
        <ComparisonChart series={series} data={data} baseDate={baseDate} partial={partial} />
      </section>
    </>
  );
}
