import type { UserId } from "@/core/kernel";
import { CalendarDate, DateRange } from "@/core/time";
import { formatCpiIndex } from "@/domain/cpi-series";
import { services } from "@/infra/container";
import { buildNetWorthAgeView, historyFromSeries, HISTORY_MONTHS, type Basis, type CpiSeries, type NetWorthAgeView } from "./net-worth-age-model";
import { NetWorthAgeError, NetWorthAgePanel } from "./net-worth-age-view";

/** Reads the inputs and builds the view. Throws on a failed read; the caller renders the error state. */
async function loadView(userId: UserId, today: CalendarDate, requested: Basis): Promise<NetWorthAgeView> {
  const { reports, repositories, projection, cpiSeries } = services();
  const firstMonth = today.startOfMonth().plusMonths(-(HISTORY_MONTHS - 1));
  const [series, flows, profile, cpiPoints] = await Promise.all([
    reports.netWorthSeries.execute({ userId, months: HISTORY_MONTHS, asOf: today }),
    repositories.balances.monthlyFlows(userId, DateRange.of(firstMonth, today)),
    projection().then(({ userId: owner, load }) => load.execute({ userId: owner })),
    cpiSeries.load.execute({ userId }),
  ]);
  if (!series.ok) throw new Error(series.error.message);
  if (!profile.ok) throw new Error(profile.error.message);

  if (!cpiPoints.ok) throw new Error(cpiPoints.error.message);

  // The owner-entered CPI Urban series. None recorded: real is unknown and nominal only is drawn.
  // No linking factor is stored, so a history across Jan 2026 draws two "not comparable" segments.
  const cpi: CpiSeries | null =
    cpiPoints.value.length === 0
      ? null
      : { months: cpiPoints.value.map((p) => ({ month: p.month, base: p.base, index: formatCpiIndex(p.indexScaled) })), linking: null };
  return buildNetWorthAgeView({
    history: historyFromSeries(series.value.series),
    expenses: flows.map((flow) => ({ month: flow.month, expense: flow.expense })),
    bornOn: profile.value.bornOn,
    today,
    cpi,
    requested,
  });
}

/**
 * Net worth against age for the signed-in owner (DESIGN §8.1).
 *
 * Streamed behind a Suspense boundary on /dashboard, so a slow or failed load
 * shows this panel's loading or error state without holding up the page.
 */
export async function NetWorthAgeSection({ userId, today, requested }: { userId: UserId; today: CalendarDate; requested: Basis }) {
  let view: NetWorthAgeView | null = null;
  try {
    view = await loadView(userId, today, requested);
  } catch (error) {
    console.error("net worth against age failed to load", error);
  }
  if (view === null) return <NetWorthAgeError reason="Net worth history could not be read just now. Nothing was changed." />;
  return <NetWorthAgePanel view={view} />;
}
