import { Kpi, KpiStrip, Masthead, Page, Panel } from "../../../components/ui/page-shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { UnknownFigure } from "../../../components/ui/data-cell";
import { Banner } from "../../../components/ui/banner";
import type { FigureValue } from "@/core/format";
import { AXIS_STATUS_LABEL, DATA_STATE_LABEL, PROVENANCE_STATUS_LABEL, type StandingView } from "./standing-model";
import { GuessFirst } from "./guess-first";
import { PlacementPanel, type PlacementRow } from "./placement-section";
import styles from "./standing.module.css";

function Value({ value, reasonId }: { value: FigureValue; reasonId: string }) {
  return typeof value === "string" ? <>{value}</> : <UnknownFigure value={value} reasonId={reasonId} />;
}

function Measures({ view }: { view: StandingView }) {
  return <>
    <KpiStrip>
      <Kpi label="Coverage" value={view.coverage} detail="Share of indicators measured" />
      <Kpi label="Range" value={view.range} detail={view.rangeDetail} />
    </KpiStrip>
    <Panel title="Pillars" description="A pillar with any unknown indicator is unknown; it is never counted as zero.">
      <ul className={styles.list}>
        {view.pillars.map((p) => <li key={p.pillar}>{p.label}: <span className={styles.figure}><Value value={p.score} reasonId={`pillar-${p.pillar}`} /></span></li>)}
      </ul>
    </Panel>
    <Panel flush title="Indicators" description="Every threshold shows where it comes from.">
      <Table>
        <TableHeader><TableRow><TableHead>Indicator</TableHead><TableHead>Pillar</TableHead><TableHead>Data state</TableHead><TableHead>Score</TableHead><TableHead>Threshold</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
        <TableBody>
          {view.indicators.map((row) => <TableRow key={row.id}>
            <TableCell>{row.name}<br /><span className={styles.note}>{row.formula}</span></TableCell>
            <TableCell>{row.pillar}</TableCell>
            <TableCell>{DATA_STATE_LABEL[row.state]}</TableCell>
            <TableCell><Value value={row.score} reasonId={`indicator-${row.id}`} /></TableCell>
            <TableCell>{row.threshold}</TableCell>
            <TableCell>{row.sourceUrl ? <a href={row.sourceUrl}>{row.source}</a> : row.source}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </Panel>
    <Panel title="Benchmark disagreements" description="How much each disputed benchmark moves the score.">
      <ul className={styles.list}>
        {view.axes.map((axis, i) => <li key={axis.label}>{axis.label} ({AXIS_STATUS_LABEL[axis.status]}): <span className={styles.figure}><Value value={axis.range} reasonId={`axis-${i}`} /></span> <span className={styles.note}>{axis.note}</span></li>)}
      </ul>
    </Panel>
    <Panel flush title="Tier rules" description="Every threshold the tier reads, and where it comes from.">
      <Table>
        <TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>Value</TableHead><TableHead>Status</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
        <TableBody>
          {view.thresholds.map((row) => <TableRow key={row.id}>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.shown}</TableCell>
            <TableCell>{PROVENANCE_STATUS_LABEL[row.status]}</TableCell>
            <TableCell>{row.sourceUrl ? <a href={row.sourceUrl}>{row.source}</a> : row.source}</TableCell>
          </TableRow>)}
        </TableBody>
      </Table>
    </Panel>
    <Panel title="Limitations" description="What these measurements knowingly leave out.">
      <ul className={styles.list}>
        {view.limitations.length === 0
          ? <li>None stated.</li>
          : view.limitations.map((text) => <li key={text}>{text}</li>)}
      </ul>
    </Panel>
  </>;
}

/** Pending owner decisions in use: shown before any guess, and they reveal nothing about the tier. */
function Pending({ view }: { view: StandingView }) {
  if (view.pending.length === 0) return null;
  return <Banner tone="warning" title="Pending owner decision, not confirmed">
    <ul className={styles.list}>{view.pending.map((text) => <li key={text}>{text}</li>)}</ul>
  </Banner>;
}

export function StandingScreen({ view, placement = [] }: { view: StandingView; placement?: readonly PlacementRow[] }) {
  const c = view.composite;
  return <Page>
    <Masthead title="Standing" />
    {view.stale && <Banner tone="warning" title="Stale input">{view.stale}</Banner>}
    <Pending view={view} />
    {c.state === "refused"
      ? <>
        <Banner tone="info" title={c.reason}>
          <p>{c.action}</p>
        </Banner>
        <KpiStrip><Kpi label="Composite" value={c.hero} detail="Refused, not zero" /></KpiStrip>
        <Measures view={view} />
        {placement.length > 0 && <PlacementPanel rows={placement} revealed={false} />}
      </>
      : <GuessFirst options={view.guessOptions} actual={c.tier}>
        <KpiStrip>
          <Kpi label="Composite" value={c.hero} detail={c.tierLabel} />
        </KpiStrip>
        <p className={styles.line}>{c.next}</p>
        {c.held && <p className={styles.line}>{c.held}</p>}
        {view.change && <p className={styles.line}>{view.change}</p>}
        <Measures view={view} />
        {placement.length > 0 && <PlacementPanel rows={placement} revealed />}
      </GuessFirst>}
  </Page>;
}

export function StandingEmpty() {
  return <Page>
    <Masthead title="Standing" />
    <Banner title="Nothing to measure yet. Add accounts and statements to start measuring." />
  </Page>;
}
