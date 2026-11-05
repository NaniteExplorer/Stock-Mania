import type { Metadata } from "next";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { Percentage } from "@/core/numeric";
import { CalendarDate } from "@/core/time";
import { groupLabel, groupOf } from "@/domain/asset-groups";
import { institutionKindLabel, type InstitutionKind } from "@/domain/institutions";
import { rupee, unknown, type Figure } from "@/core/format";
import { Kpi, KpiStrip, Masthead, Page as PageShell, Panel } from "@/components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionCell, FigureCell, TextCell, UnknownCell } from "@/components/ui/data-cell";
import { Banner } from "@/components/ui/banner";
import { InstitutionMark } from "@/ui/provider-picker";
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
    <PageShell>
      <Masthead title="Platforms" hero={rows.length > 0 ? (totalValue ? rupee(totalValue) : unknown(UNPRICED_REASON)) : undefined} />
      <p className="text-sm text-(--fg-secondary)">
        The same holdings as the investments screen, grouped by where they are held. Every figure is a rollup — nothing here is stored a second time.{" "}
        <span className="text-(--fg-muted)">{inUse.length} in use</span>
      </p>

      {rows.length > 0 && (
        <KpiStrip>
          <Kpi label="Platforms in use" value={String(inUse.length) as Figure} detail={`${idle.length} registered but empty`} />
          <Kpi label="Holdings" value={String(positions.length) as Figure} detail="Across every platform" />
          <Kpi label="Market value" value={totalValue ? rupee(totalValue) : unknown(UNPRICED_REASON)} detail="At the latest resolved price" />
          <Kpi
            label="Unattributed"
            value={String(unassigned?.count ?? 0) as Figure}
            detail={
              unassigned
                ? "Holdings with no platform recorded — set one on the holding"
                : "Every holding has a platform"
            }
          />
        </KpiStrip>
      )}

      {rows.length === 0 ? (
        <Banner title="Nothing held anywhere yet">
          <p>Register a holding on the investments screen and choose its platform. This page groups what you own by broker, app or vault — and shows what each one has actually made you.</p>
        </Banner>
      ) : (
        <Panel title="Where your holdings are" flush>
          <Table aria-label="Platforms with invested amount, market value, unrealised and realised gain">
            <TableHeader>
              <TableRow>
                <TableHead>Platform</TableHead>
                <TableHead className="text-right">Holdings</TableHead>
                <TableHead className="text-right">Invested</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Unrealised</TableHead>
                <TableHead className="text-right">Realised</TableHead>
                <TableHead className="text-right">Return</TableHead>
                <TableHead>Do</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {/* "Unassigned" is a bucket, not a platform, so it gets no mark. */}
                      <InstitutionMark institution={row.key === UNASSIGNED ? null : row.name} />
                      <div>
                        <span className="font-medium text-(--fg)">{row.name}</span>
                        <p className="text-xs text-(--fg-muted)">
                          {row.kindLabel ?? "No platform recorded"}
                          {row.groups.length > 0 && ` · ${row.groups.join(", ")}`}
                        </p>
                        {row.unpriced > 0 && (
                          <p className="text-xs text-(--warn)">
                            {row.unpriced} unpriced, so the totals are blank rather than light
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TextCell className="text-right tabular-nums">{row.count}</TextCell>
                  <MoneyCell value={row.invested} id={`${row.key}-invested`} />
                  <MoneyCell value={row.value} id={`${row.key}-value`} />
                  <MoneyCell value={row.unrealised} id={`${row.key}-unrealised`} toned />
                  <MoneyCell value={row.realised} id={`${row.key}-realised`} toned />
                  <TextCell className="text-right tabular-nums">
                    {row.returnPercent ? `${row.returnPercent.toFixed(2)}%` : "—"}
                  </TextCell>
                  <ActionCell>
                    {row.key === UNASSIGNED ? (
                      <span className="text-xs text-(--fg-disabled)">—</span>
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
                  </ActionCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}

      {idle.length > 0 && (
        <Panel
          title="Registered, holding nothing"
          description="Shipped with the app so the picker is useful on day one. Archive the ones you do not use — it hides them from every form and changes nothing else."
        >
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {idle.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between gap-3 rounded-xl border border-(--border) px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <InstitutionMark institution={row.name} />
                  <span>
                    <span className="block text-sm text-(--fg)">{row.name}</span>
                    <span className="block text-xs text-(--fg-muted)">{row.kindLabel}</span>
                  </span>
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
        </Panel>
      )}

      {archived.length > 0 && (
        <Panel
          title="Archived"
          description="Hidden from every picker, and still holding everything they ever held."
        >
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map((row) => (
              <li
                key={row.key}
                className="flex items-center justify-between gap-3 rounded-xl border border-(--border) px-3 py-2"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <InstitutionMark institution={row.name} />
                  <span>
                    <span className="block text-sm text-(--fg-secondary)">{row.name}</span>
                    <span className="block text-xs text-(--fg-muted)">
                      {row.kindLabel} · {row.count} holding{row.count === 1 ? "" : "s"}
                    </span>
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
        </Panel>
      )}

      <Panel
        title="Add a platform"
        description="Anything that holds an investment for you — a broker, an app, a bullion vault. It holds no money of its own; the value stays in the holdings underneath it."
      >
        <AddPlatformForm />
      </Panel>
    </PageShell>
  );
}

const UNPRICED_REASON = "Unpriced holdings, so the total is blank rather than light";

/**
 * A money figure that may be unknown (an unpriced holding). Library gap
 * (F.7 Recompose A): FigureCell has no gain/loss tone, so `toned` applies it here.
 */
function MoneyCell({ value, id, toned = false }: { value: Money | null; id: string; toned?: boolean }) {
  if (value === null) return <UnknownCell reason={UNPRICED_REASON} reasonId={`platform-${id}`} />;
  const tone = !toned ? undefined : value.isNegative ? "text-(--loss)" : value.isPositive ? "text-(--gain)" : undefined;
  return <FigureCell value={value} className={tone} />;
}

/** The bucket for holdings with no platform recorded. Not a real id. */
const UNASSIGNED = "__unassigned__";
