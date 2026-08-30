import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { groupLabel, groupOf } from "@/domain/asset-groups";
import { institutionKindLabel, type InstitutionKind } from "@/domain/institutions";
import { Card, EmptyState, MoneyText, PageHeader, Pill, Stat } from "@/ui/primitives";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import AddPlatformForm from "./add-platform-form";
import PlatformRowActions from "./platform-row-actions";

export const metadata: Metadata = { title: "Platforms" };

/**
 * The portfolio, by where it is held.
 *
 * The plan's Phase 9f said of this screen: "the data exists; the view does not."
 * That was half true — the data did not exist either, because a platform was a
 * free-text string on a lease and the shape of an account code everywhere else.
 * Now it is a row, and this screen is a pure rollup over it: every number here
 * is the same `ValuePortfolio` output the investments screen renders, grouped by
 * a different key. Nothing is stored twice, so the two screens cannot disagree.
 *
 * **Unassigned is a platform.** Holdings with no platform recorded get their own
 * row rather than being dropped, because a per-platform total that silently
 * omits a third of the portfolio is worse than one that says where the gap is.
 *
 * Archived platforms are listed separately and keep their history. A broker you
 * closed still owns every trade you placed there; hiding it from the picker is
 * the point, hiding it from the record is not.
 */
export default async function Page() {
  await connection();

  const userId = await currentUserId();
  await ensureSeeded(userId);

  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const { investing, repositories } = services();

  const [portfolio, all] = await Promise.all([
    investing.valuePortfolio.execute({ userId, asOf: today }),
    repositories.platforms.list(userId, { includeArchived: true }),
  ]);
  if (!portfolio.ok) throw new Error(portfolio.error.message);

  const positions = portfolio.value.valued;
  const byPlatform = Map.groupBy(
    positions,
    (position) => position.instrument.institutionId?.value ?? UNASSIGNED,
  );

  const sum = (values: readonly (Money | null)[]): Money | null =>
    values.some((value) => value === null)
      ? null
      : Money.total(values as readonly Money[], Money.zero().currency);

  const rowFor = (
    key: string,
    name: string,
    kindLabel: string | null,
    isArchived: boolean,
    kind: InstitutionKind = "OTHER",
    sellSpread = "0",
  ) => {
    const members = byPlatform.get(key) ?? [];
    const invested = sum(members.map((position) => position.reportingCostBasis));
    const value = sum(members.map((position) => position.reportingMarketValue));
    const realised = sum(members.map((position) => position.reportingRealisedGain));
    const unrealised = invested && value ? value.minus(invested) : null;
    return {
      key,
      name,
      kindLabel,
      kind,
      sellSpread,
      isArchived,
      count: members.length,
      invested,
      value,
      unrealised,
      realised,
      // Return on what is still invested. Realised gains are in the numerator
      // because money already taken out of a platform is still money it made.
      returnPercent:
        invested && !invested.isZero && value && realised
          ? Percentage.ratio(value.plus(realised).minus(invested), invested)
          : null,
      unpriced: members.filter((position) => position.reportingMarketValue === null).length,
      groups: [...new Set(members.map((position) => groupLabel(groupOf(position.instrument))))].sort(),
    };
  };

  const live = all
    .filter((platform) => !platform.isArchived)
    .map((platform) =>
      rowFor(
        platform.id.value,
        platform.name,
        institutionKindLabel(platform.kind),
        false,
        platform.kind,
        platform.sellSpread.toFixed(2),
      ),
    );
  const archived = all
    .filter((platform) => platform.isArchived)
    .map((platform) =>
      rowFor(
        platform.id.value,
        platform.name,
        institutionKindLabel(platform.kind),
        true,
        platform.kind,
        platform.sellSpread.toFixed(2),
      ),
    );
  const unassigned = byPlatform.has(UNASSIGNED)
    ? rowFor(UNASSIGNED, "Unassigned", null, false)
    : null;

  /*
   * A seeded platform holding nothing is noise: the catalogue ships thirty of
   * them so the picker is useful, and listing thirty empty cards would bury the
   * three the user actually holds. They stay one click away under "Not in use".
   */
  const inUse = live.filter((row) => row.count > 0);
  const idle = live.filter((row) => row.count === 0);
  const rows = unassigned ? [...inUse, unassigned] : inUse;
  rows.sort((a, b) => Number(b.value?.minor ?? 0n) - Number(a.value?.minor ?? 0n));

  const totalValue = sum(rows.map((row) => row.value));

  return (
    <>
      <PageHeader
        title="Platforms"
        subtitle="The same holdings as the investments screen, grouped by where they are held. Every figure is a rollup — nothing here is stored a second time."
        badge={<Pill tone="brand">{inUse.length} in use</Pill>}
      />

      {rows.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Platforms in use" value={<span className="tnum">{inUse.length}</span>} hint={`${idle.length} registered but empty`} />
          <Stat label="Holdings" value={<span className="tnum">{positions.length}</span>} hint="Across every platform" />
          <Stat label="Market value" value={totalValue} hint="At the latest resolved price" />
          <Stat
            label="Unattributed"
            value={<span className="tnum">{unassigned?.count ?? 0}</span>}
            hint={
              unassigned
                ? "Holdings with no platform recorded — set one on the holding"
                : "Every holding has a platform"
            }
          />
        </div>
      )}

      <section className="panel mb-6 p-0">
        {rows.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="Nothing held anywhere yet"
            body="Register a holding on the investments screen and choose its platform. This page groups what you own by broker, app or vault — and shows what each one has actually made you."
          />
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <caption className="sr-only">
                Platforms with invested amount, market value, unrealised and realised gain
              </caption>
              <thead>
                <tr className="border-b border-gray-600">
                  <th scope="col" className="metric-label px-4 py-3 text-left">Platform</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Holdings</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Invested</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Value</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Unrealised</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Realised</th>
                  <th scope="col" className="metric-label px-4 py-3 text-right">Return</th>
                  <th scope="col" className="metric-label px-4 py-3 text-left">Do</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-b border-gray-600/50 last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-100">{row.name}</span>
                      <p className="text-xs text-gray-500">
                        {row.kindLabel ?? "No platform recorded"}
                        {row.groups.length > 0 && ` · ${row.groups.join(", ")}`}
                      </p>
                      {row.unpriced > 0 && (
                        <p className="text-xs text-amber-500">
                          {row.unpriced} unpriced, so the totals are blank rather than light
                        </p>
                      )}
                    </td>
                    <td className="tnum px-4 py-3 text-right text-gray-300">{row.count}</td>
                    <td className="px-4 py-3 text-right">
                      <MoneyText value={row.invested} tone="neutral" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MoneyText value={row.value} tone="neutral" />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MoneyText value={row.unrealised} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <MoneyText value={row.realised} />
                    </td>
                    <td className="tnum px-4 py-3 text-right text-gray-300">
                      {row.returnPercent ? `${row.returnPercent.toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {row.key === UNASSIGNED ? (
                        <span className="text-xs text-gray-600">—</span>
                      ) : (
                        <PlatformRowActions
                          platformId={row.key}
                          name={row.name}
                          kind={row.kind}
                          sellSpread={row.sellSpread}
                          isArchived={row.isArchived}
                          canDelete={row.count === 0}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {idle.length > 0 && (
        <Card
          title="Registered, holding nothing"
          subtitle="Shipped with the app so the picker is useful on day one. Archive the ones you do not use — it hides them from every form and changes nothing else."
          className="mb-6"
        >
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {idle.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between gap-3 rounded-xl border border-gray-600 px-3 py-2"
              >
                <span>
                  <span className="block text-sm text-gray-200">{row.name}</span>
                  <span className="block text-xs text-gray-500">{row.kindLabel}</span>
                </span>
                <PlatformRowActions
                  platformId={row.key}
                  name={row.name}
                  kind={row.kind}
                  sellSpread={row.sellSpread}
                  isArchived={false}
                  canDelete
                  compact
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {archived.length > 0 && (
        <Card
          title="Archived"
          subtitle="Hidden from every picker, and still holding everything they ever held."
          className="mb-6"
        >
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between gap-3 rounded-xl border border-gray-600 px-3 py-2"
              >
                <span>
                  <span className="block text-sm text-gray-300">{row.name}</span>
                  <span className="block text-xs text-gray-500">
                    {row.kindLabel} · {row.count} holding{row.count === 1 ? "" : "s"}
                  </span>
                </span>
                <PlatformRowActions
                  platformId={row.key}
                  name={row.name}
                  kind={row.kind}
                  sellSpread={row.sellSpread}
                  isArchived
                  canDelete={row.count === 0}
                  compact
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Add a platform"
        subtitle="Anything that holds an investment for you — a broker, an app, a bullion vault. It holds no money of its own; the value stays in the holdings underneath it."
      >
        <AddPlatformForm />
      </Card>
    </>
  );
}

/** The bucket for holdings with no platform recorded. Not a real id. */
const UNASSIGNED = "__unassigned__";
