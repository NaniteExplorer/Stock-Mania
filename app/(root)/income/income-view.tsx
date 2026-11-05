import type { ReactNode } from "react";
import { Kpi, KpiStrip, Masthead, MastFigure, Page, Panel, Section } from "../../../components/ui/page-shell";
import { UnknownFigure } from "../../../components/ui/data-cell";
import { Banner } from "../../../components/ui/banner";
import { Button } from "../../../components/ui/button";
import type { FigureValue } from "@/core/format";
import { countFigure, type CellView, type IncomeView, type StreamView } from "./income-model";
import styles from "./income.module.css";

export const LINK_DISABLED_REASON = "Linking a payment is not available yet: receipts cannot be recorded until the receipt writer ships.";

function Amount({ value }: { value: FigureValue }) {
  return typeof value === "string" ? <>{value}</> : <UnknownFigure value={value} />;
}

/** One occurrence. Three treatments only; a missing one is never ₹0 or blank. */
export function OccurrenceCell({ cell, reasonId }: { cell: CellView; reasonId: string }) {
  return <li className={styles.cell} data-state={cell.state}>
    <span className={styles.sr}>{cell.text}</span>
    <span className={styles.due} aria-hidden="true">{cell.due}</span>
    {cell.state === "received" && <>
      <span className={styles.figure} aria-hidden="true">{cell.amount}</span>
      <span className={styles.note} aria-hidden="true">Received {cell.receivedOn}</span>
      {cell.difference !== null && <span className={styles.note}>vs expected <Amount value={cell.difference} /></span>}
    </>}
    {cell.state === "missing" && <>
      <span className={styles.missing} aria-hidden="true">Missing</span>
      <span className={styles.note}>Expected <span className={styles.figure}><Amount value={cell.expected} /></span></span>
      <span className={styles.note} aria-hidden="true">{cell.lateBy} {cell.lateBy === 1 ? "day" : "days"} late</span>
      <Button type="button" variant="link" size="xs" disabled aria-describedby={reasonId}>Link a payment</Button>
    </>}
    {cell.state === "pending" && <span className={`${styles.figure} ${styles.muted}`}><Amount value={cell.expected} /></span>}
  </li>;
}

export function StreamPanel({ stream }: { stream: StreamView }) {
  const reasonId = `link-reason-${stream.id}`;
  const hasMissing = stream.cells.some((c) => c.state === "missing");
  return <Panel title={stream.name} description={stream.description}>
    {stream.cells.length === 0
      ? <p className={styles.empty}>Nothing was due in the last 12 months.</p>
      : <ol className={styles.row} aria-label={`${stream.name}, occurrences in the last 12 months`}>
          {stream.cells.map((cell) => <OccurrenceCell key={cell.key} cell={cell} reasonId={reasonId} />)}
        </ol>}
    {hasMissing && <p id={reasonId} className={styles.note}>{LINK_DISABLED_REASON} Nothing is ever matched automatically.</p>}
  </Panel>;
}

export function IncomeScreen({ view, form }: { view: IncomeView; form: ReactNode }) {
  const s = view.summary;
  return <Page>
    <Masthead title="Income" hero={s.receivedThisMonth} side={<>
      <MastFigure label="Expected this month" value={s.expectedThisMonth} />
      <MastFigure label="Missing" value={countFigure(s.missingThisMonth)} />
    </>} />
    <KpiStrip>
      <Kpi label="Received" value={s.receivedFy} detail={`${s.fyLabel} to date`} />
      <Kpi label="Expected" value={s.expectedFy} detail={`${s.fyLabel} to date`} />
      <Kpi label="Missing" value={countFigure(s.missingFy)} detail={s.missingFy > 0 ? <span className={styles.warn}>Past due and not received</span> : "None past due"} />
      <Kpi label="Pending" value={countFigure(s.pendingFy)} detail="Due, not yet late" />
    </KpiStrip>
    <Section heading="Streams" />
    <div className={styles.stack}>{view.streams.map((stream) => <StreamPanel key={stream.id} stream={stream} />)}</div>
    <Panel title="Add an income stream" description="Salary, rent, a retainer: anything you expect to be paid again. Leave the amount blank if you do not know it; it stays unknown, never zero.">{form}</Panel>
  </Page>;
}

export function IncomeEmpty({ form }: { form: ReactNode }) {
  return <Page>
    <Masthead title="Income" />
    <Banner title="No income streams yet. Add your salary or any regular inflow." />
    <Panel title="Add an income stream" description="Leave the amount blank if you do not know it; it stays unknown, never zero.">{form}</Panel>
  </Page>;
}
