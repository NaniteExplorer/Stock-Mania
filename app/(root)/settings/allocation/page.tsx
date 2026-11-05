import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { CalendarDate } from "@/core/time";
import { currentUserId, services } from "@/infra/container";
import { Page as Shell, Masthead, Panel, Section } from "../../../../components/ui/page-shell";
import { Banner } from "../../../../components/ui/banner";
import { AllocationForm, BandForm } from "./allocation-form";
import { recordAllocationAction, recordBandAction, removeAllocationAction, removeBandAction } from "./actions";
import { buildSleeveRows, formatScaled } from "./allocation-model";
import styles from "./allocation.module.css";

export const metadata: Metadata = { title: "Target allocation" };

/**
 * Owner entry for the target allocation and rebalancing band (financial-health-scoring.md
 * § 3.6 follow-up). Neither has a default; until both are stored the signals board is UNKNOWN.
 * A failed read throws to this segment's error.tsx.
 */
export default async function Page() {
  await connection();
  const userId = await currentUserId();
  const { clock, investing, targetAllocation, rebalancingBand } = services();
  const [stored, band, valuation] = await Promise.all([
    targetAllocation.load.execute({ userId }),
    rebalancingBand.load.execute({ userId }),
    investing.valuePortfolio.execute({ userId, asOf: CalendarDate.parse(clock.today()) }),
  ]);
  if (!stored.ok) throw new Error(stored.error.message);
  if (!band.ok) throw new Error(band.error.message);
  if (!valuation.ok) throw new Error(valuation.error.message);

  const storedShares = (stored.value?.shares ?? []).map((s) => ({ id: s.id, share: formatScaled(s.share.scaled) }));
  const holdings = valuation.value.valued.map((p) => ({ id: p.instrumentId.value, name: p.label }));
  const rows = buildSleeveRows(holdings, storedShares);
  const initialBand = band.value ? { absolute: formatScaled(band.value.absolute.scaled), relative: formatScaled(band.value.relative.scaled) } : null;

  return <Shell>
    <Masthead title="Target allocation" />
    <p className={styles.note}>
      Set the share you want each holding to have and the band it may drift within. Nothing is pre-filled and no rule is assumed;
      the <Link href="/signals">Signals</Link> board measures your holdings only once both are stored.
    </p>
    <Section heading="Target shares" />
    {rows.length === 0
      ? <Banner title="No holdings yet"><p>Add holdings under <Link href="/investments">Investments</Link>; each one appears here to receive a target share.</p></Banner>
      : <Panel title="Target allocation" description="Shares must add up to exactly 100%. Leave a holding blank to give it no target. Saving replaces the whole allocation.">
        <AllocationForm rows={rows} action={recordAllocationAction} removeAction={removeAllocationAction} hasStored={stored.value !== null} />
      </Panel>}
    <Section heading="Rebalancing band" />
    <Panel title="Rebalancing band" description={initialBand ? "Your stored band. Saving replaces it." : "No band is stored. The board stays unknown until you record one."}>
      <BandForm initial={initialBand} action={recordBandAction} removeAction={removeBandAction} />
    </Panel>
  </Shell>;
}
