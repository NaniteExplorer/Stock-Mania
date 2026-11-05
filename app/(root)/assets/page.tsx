import type { Metadata } from "next";
import { connection } from "next/server";
import { Money } from "@/core/money";
import { CalendarDate } from "@/core/time";
import { count, rupee, unknown, type Figure } from "@/core/format";
import { Kpi, KpiStrip, Masthead, Page as PageShell, Panel } from "@/components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ActionCell, BadgeCell, FigureCell, TextCell, UnknownCell } from "@/components/ui/data-cell";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { currentUserId, ensureSeeded, services } from "@/infra/container";
import type { AssetAcquisition } from "@/domain/asset-acquisition";
import { DecliningBalance, StraightLine, type DepreciationModel } from "@/domain/depreciation";
import type { Percentage } from "@/core/numeric";
import { removeAssetAction, unlinkAcquisitionAction } from "./actions";
import { AddAssetForm, LinkAcquisitionForm, ModelForm, ValuationForm, type ModelDefaults } from "./asset-forms";

const percentText = (p: Percentage) => p.toFixed(4).replace(/\.?0+$/, "");

/** The stored model as form defaults; any other model is the shipped schedule. */
function modelDefaults(model: DepreciationModel | null): ModelDefaults {
  if (!model) return { model: "NONE", rate: "", floor: "", basis: "" };
  if (model instanceof DecliningBalance) return { model: "DECLINING", rate: percentText(model.rate), floor: "", basis: model.basis };
  if (model instanceof StraightLine) return { model: "STRAIGHT", rate: percentText(model.rate), floor: percentText(model.floor), basis: model.basis };
  return { model: "SCHEDULE", rate: "", floor: "", basis: "" };
}

export const metadata: Metadata = { title: "Assets" };

const KIND_LABELS = { REAL_ESTATE: "Property", VEHICLE: "Vehicle", OTHER: "Other" } as const;
const SOURCE_LABELS = {
  PROFESSIONAL_VALUATION: "Professional valuation",
  MARKET_COMPARABLE: "Market comparable",
  PURCHASE_PRICE: "Purchase price",
  SELF_ASSESSED: "Self-assessed",
} as const;

/**
 * Assets: property, vehicles and other physical purchases, valued by dated,
 * sourced assertion (TASKS 1.4). The modelled (depreciated) figure is shown beside
 * the assertion and labelled a model; it is never stored as a value. An asset
 * nobody has valued shows "unknown", never zero and never the purchase price.
 */
export default async function Page() {
  await connection();
  const userId = await currentUserId();
  await ensureSeeded(userId);

  const today = CalendarDate.parse(new Date().toISOString().slice(0, 10));
  const result = await services().physicalAssets.list.execute({ userId });
  if (!result.ok) throw new Error(result.error.message);
  const records = result.value;

  // 1.8: the acquisition each asset is linked to, and the expense postings a link may name.
  const links = await services().assetAcquisitions();
  const acquisitions = new Map<string, AssetAcquisition>();
  for (const record of records) {
    const found = await links.forAsset.execute({ userId, assetAccountId: record.asset.id.value });
    if (found.ok && found.value) acquisitions.set(record.asset.id.value, found.value);
  }
  const candidateResult = await links.candidates.execute({ userId });
  const candidates = candidateResult.ok
    ? candidateResult.value.map((c) => ({ postingId: c.postingId, label: `${c.on.toISO()} · ${c.description} · ${c.accountName} · ${rupee(c.amount)}` }))
    : [];

  const rows = records.map((record) => ({
    record,
    latest: record.asset.valuationOn(today),
    modelled: record.model ? record.asset.modelledValueOn(today, record.model) : null,
  }));
  const valued = rows.flatMap((row) => (row.latest ? [row.latest.valuation.value] : []));
  const total = valued.length > 0 ? Money.total(valued) : null;
  const stale = rows.filter((row) => row.latest?.isStale).length;
  const lastRevalued = rows
    .flatMap((row) => (row.latest ? [row.latest.valuation.on] : []))
    .sort((a, b) => b.compareTo(a))[0];

  return (
    <PageShell>
      <Masthead
        title="Assets"
        subtitle="Property, vehicles and other purchases, valued by dated assertion rather than by a market quote."
        hero={total ? rupee(total) : unknown("No asset has a valuation yet")}
      />

      <KpiStrip>
        <Kpi label="Asserted value" value={total ? rupee(total) : unknown("Nothing valued")} detail="Latest valuation of each asset" />
        <Kpi label="Assets" value={count(records.length)} detail={`${count(records.length - valued.length)} not yet valued`} />
        <Kpi label="Stale valuations" value={count(stale)} detail="Older than their source's shelf life" />
        <Kpi label="Last revalued" value={lastRevalued ? (lastRevalued.toISO() as Figure) : unknown("Never")} detail="Most recent assertion" />
      </KpiStrip>

      {records.length === 0 ? (
        <Banner title="No assets yet">
          <p>Add a flat, a vehicle or another major purchase below. Its value is whatever was last asserted, with the source and date beside it.</p>
        </Banner>
      ) : (
        <Panel title="Your assets" flush>
          <Table aria-label="Physical assets with kind, latest valuation, source, modelled value and actions">
            <TableHeader>
              <TableRow>
                <TableHead>Asset</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Valued on</TableHead>
                <TableHead>Source</TableHead>
                <TableHead align="right">Value</TableHead>
                <TableHead align="right">Model says</TableHead>
                <TableHead align="right">Manage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ record, latest, modelled }) => {
                const id = record.asset.id.value;
                return (
                  <TableRow key={id}>
                    <TextCell secondary={record.asset.purchase ? `Bought ${record.asset.purchase.on.toISO()} for ${rupee(record.asset.purchase.price)}` : undefined}>
                      {record.asset.displayName}
                    </TextCell>
                    <TextCell>{KIND_LABELS[record.asset.kind]}</TextCell>
                    <TextCell className="tabular-nums">{latest ? latest.valuation.on.toISO() : "—"}</TextCell>
                    {latest
                      ? <BadgeCell tone={latest.isStale ? "warning" : "outline"}>{SOURCE_LABELS[latest.valuation.source]}{latest.isStale ? " (stale)" : ""}</BadgeCell>
                      : <TextCell>—</TextCell>}
                    {latest
                      ? <FigureCell value={latest.valuation.value} />
                      : <UnknownCell reason="Nobody has valued this asset yet" reasonId={`unvalued-${id}`} />}
                    {modelled
                      ? <FigureCell value={modelled.value} title={`${modelled.model}: ${modelled.terms}. ${modelled.basis}`} />
                      : <TextCell className="text-right">—</TextCell>}
                    <ActionCell className="text-right">
                      <form action={removeAssetAction}>
                        <input type="hidden" name="accountId" value={id} />
                        <Button type="submit" variant="ghost" size="sm" aria-label={`Remove ${record.asset.displayName}`}>Remove</Button>
                      </form>
                    </ActionCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Panel>
      )}

      {records.map((record) => {
        const id = record.asset.id.value;
        const acquisition = acquisitions.get(id);
        return (
          <Panel key={id} title={`Manage ${record.asset.displayName}`} description="A new valuation is a dated assertion; earlier ones are kept as history.">
            <div className="grid gap-6">
              <ValuationForm accountId={id} name={record.asset.displayName} />
              <section aria-label={`Purchase link for ${record.asset.displayName}`} className="grid gap-2">
                <h3 className="text-sm font-medium">Purchase</h3>
                {acquisition ? (
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <p>
                      Paid by <span className="font-medium">{acquisition.description}</span> on{" "}
                      <span className="tabular-nums">{acquisition.on.toISO()}</span> for{" "}
                      <span className="tabular-nums">{rupee(acquisition.cost)}</span>.
                    </p>
                    <form action={unlinkAcquisitionAction}>
                      <input type="hidden" name="accountId" value={id} />
                      <Button type="submit" variant="ghost" size="sm" aria-label={`Unlink the purchase of ${record.asset.displayName}`}>Unlink</Button>
                    </form>
                  </div>
                ) : (
                  <LinkAcquisitionForm accountId={id} name={record.asset.displayName} candidates={candidates} />
                )}
              </section>
              <section aria-label={`Depreciation model for ${record.asset.displayName}`} className="grid gap-2">
                <h3 className="text-sm font-medium">Depreciation model</h3>
                <ModelForm accountId={id} name={record.asset.displayName} defaults={modelDefaults(record.model)} />
              </section>
            </div>
          </Panel>
        );
      })}

      <Panel title="Add an asset" description="Opens a ledger account for it. A valuation is an assertion, not a posting.">
        <AddAssetForm />
      </Panel>
    </PageShell>
  );
}
